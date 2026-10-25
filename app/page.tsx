"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceDetector } from "@mediapipe/tasks-vision";
import { measure, score, directions, smooth, type Box, type Metrics, type Scores, type Direction } from "../lib/lighting/analyze";
import { COLORS, DEFAULT_LIGHT } from "../lib/lighting/light";
import { relightFrame } from "../lib/lighting/relight";
import { drawDebugOverlay } from "../lib/lighting/visualize";
import { DEFAULT_AIM, aimToLight, findBestAim, lightToAim, scoreWithLight, type LightAim } from "../lib/lighting/optimize";
import type { VirtualLight } from "../lib/lighting/type";
import { englishVoices, phrase, pickVoice } from "../lib/voice";
import WhyTab from "./why-tab";

const LOCAL_MODEL = "/mediapipe/blaze_face_short_range.tflite";
const REMOTE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const CENTER_BOX: Box = { x: 0.35, y: 0.2, w: 0.3, h: 0.45 };
const AW = 160; // analysis size: small is fast and plenty for lighting
const AH = 120;
const RW = 640; // display render width

async function loadDetector(): Promise<FaceDetector | null> {
  try {
    const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    for (const modelAssetPath of [LOCAL_MODEL, REMOTE_MODEL]) {
      try {
        return await FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath, delegate: "CPU" },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5,
        });
      } catch {
        // try the next model location
      }
    }
  } catch {
    // face tracking unavailable; we fall back to the center of the frame
  }
  return null;
}

const LABELS: [keyof Scores, string][] = [
  ["brightness", "Face brightness"],
  ["backlight", "No glare behind you"],
  ["evenness", "Even light on both sides"],
  ["notBlown", "Not washed out"],
    ["framing", "Framing"],
];

// Short headline for each instruction. Shown big; the full sentence is shown below it and spoken.
const HEADLINES: Record<string, string> = {
  noface: "Can't see your face",
  backlit: "Bright light behind you",
  dark: "Your face is too dark",
  blown: "Your face is too bright",
  "uneven-left": "Brighter on your left side",
  "uneven-right": "Brighter on your right side",
  closer: "Move a little closer",
  back: "Lean back a little",
  "go-left": "Move a little left",
  "go-right": "Move a little right",
  "tilt-down": "Tilt your screen toward you",
  "tilt-back": "Tilt your screen back",
  good: "You look great",
  almost: "Almost there",
};


type Settings = {
  autoLight: boolean; // the app picks the light position/strength for the best score
  lightOn: boolean;
  colorName: string;
  showModel: boolean; // head model + light ray
  manualIntensity: number;
  manualDistance: number;
  manualSoftness: number;
};

const DEFAULT_SETTINGS: Settings = {
  autoLight: true,
  lightOn: true,
  colorName: "Warm",
  showModel: true,
  manualIntensity: DEFAULT_LIGHT.intensity,
  manualDistance: DEFAULT_LIGHT.distance,
  manualSoftness: DEFAULT_LIGHT.softness,
};

// Soft Aero colors: leaf green, sunny amber, coral.
const scoreColor = (t: number | null) => (t === null ? "#8fb3c9" : t >= 80 ? "#3cb043" : t >= 50 ? "#f2a71b" : "#ef5b5b");
const fillGradient = (v: number) =>
  v >= 0.7 ? "linear-gradient(180deg, #9be870, #3cb043)" : v >= 0.4 ? "linear-gradient(180deg, #ffd66b, #f2a71b)" : "linear-gradient(180deg, #ff9a8a, #ef5b5b)";
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export default function Coach() {
  const [tab, setTab] = useState<"coach" | "settings" | "why">("coach");
  const [running, setRunning] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [mode, setMode] = useState<"off" | "loading" | "face" | "center">("off");
  const [scores, setScores] = useState<Scores | null>(null);
  const [virtualTotal, setVirtualTotal] = useState<number | null>(null);
  const [dirs, setDirs] = useState<Direction[]>([]);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [lightView, setLightView] = useState<VirtualLight>(DEFAULT_LIGHT);
  const [voiceName, setVoiceName] = useState(""); // "" = pick the most natural voice automatically
  const [voiceRate, setVoiceRate] = useState(1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const relitRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const work = useRef<HTMLCanvasElement | null>(null);
  const full = useRef<HTMLCanvasElement | null>(null);
  const outImg = useRef<ImageData | null>(null);
  const detector = useRef<FaceDetector | null>(null);
  const ema = useRef<Metrics | null>(null);
  const virtualEma = useRef<number | null>(null);
  const faceRef = useRef<Box | null>(null);
  const voiceRef = useRef(true);
  const spoken = useRef({ text: "", time: 0 });
  const candidate = useRef({ key: "", since: 0 });
  // The instruction we're currently coaching on, and its score when we said it.
  const active = useRef<{ key: string; factor?: Direction["factor"]; value: number; time: number } | null>(null);
  const lastFace = useRef<{ box: Box; time: number } | null>(null);
  const raf = useRef(0);
  // Virtual light: where we want it (relative to the face) and where it is drawn right now.
  const aimRef = useRef<LightAim>(DEFAULT_AIM);
  const needFullSearch = useRef(true);
  const lightRef = useRef<VirtualLight>(DEFAULT_LIGHT);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const voiceNameRef = useRef("");
  const voiceRateRef = useRef(1);
  const dragging = useRef(false);

  useEffect(() => {
    voiceRef.current = voiceOn;
    if (!voiceOn) window.speechSynthesis?.cancel();
  }, [voiceOn]);
  useEffect(() => {
    voiceNameRef.current = voiceName;
    voiceRateRef.current = voiceRate;
  }, [voiceName, voiceRate]);
  // Voices load in the background, so refresh the list when they arrive.
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const load = () => setVoices(englishVoices());
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, []);

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function updateSettings(patch: Partial<Settings>) {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    if (patch.autoLight) needFullSearch.current = true;
    if (patch.autoLight === false) {
      // Switching to manual: keep the light where auto had it.
      next.manualIntensity = aimRef.current.intensity;
      next.manualDistance = aimRef.current.distance;
      next.manualSoftness = aimRef.current.softness;
      setSettings({ ...next });
    }
    if (!next.autoLight)
      aimRef.current = { ...aimRef.current, intensity: next.manualIntensity, distance: next.manualDistance, softness: next.manualSoftness };
  }

  function say(text: string) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(voiceNameRef.current);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.rate = voiceRateRef.current;
    u.pitch = 1.05;
    synth.speak(u);
  }

  async function start() {
    setError("");
    // Speaking inside the click lets browsers allow audio later.
    if (voiceRef.current) say(phrase.start());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
    } catch {
      setError("Couldn't open the camera. Allow camera access in your browser and try again.");
      return;
    }
    setRunning(true);
    const forceCenter = new URLSearchParams(window.location.search).has("center");
    setMode("loading");
    detector.current = forceCenter ? null : await loadDetector();
    setMode(detector.current ? "face" : "center");
    work.current = document.createElement("canvas");
    work.current.width = AW;
    work.current.height = AH;
    ema.current = null;
    virtualEma.current = null;
    needFullSearch.current = true;
    loop();
  }

  function stop() {
    cancelAnimationFrame(raf.current);
    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
    window.speechSynthesis?.cancel();
    setRunning(false);
    setMode("off");
  }

  function loop() {
    let last = 0;
    const tick = () => {
      const now = performance.now();
      render();
      if (now - last > 150) {
        last = now;
        analyze(now);
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  // The light settings that don't come from the search (color, on/off).
  function baseLight(): VirtualLight {
    const st = settingsRef.current;
    const color = COLORS.find((c) => c.name === st.colorName)?.color ?? DEFAULT_LIGHT.color;
    return { ...lightRef.current, color, enabled: st.lightOn };
  }

  function analyze(now: number) {
    const video = videoRef.current;
    const canvas = work.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;

    // 1. Find the face (or assume the center if tracking is unavailable).
    const trackFace = !!detector.current;
    let face: Box | null = CENTER_BOX;
    if (detector.current) {
      const res = detector.current.detectForVideo(video, now);
      const best = res.detections
        .map((d) => d.boundingBox)
        .filter((b): b is NonNullable<typeof b> => !!b)
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
      face = best
        ? {
            x: best.originX / video.videoWidth,
            y: best.originY / video.videoHeight,
            w: best.width / video.videoWidth,
            h: best.height / video.videoHeight,
          }
        : null;
      // Hold the last position for a second so a blink or head turn doesn't reset everything.
      if (face) lastFace.current = { box: face, time: now };
      else if (lastFace.current && now - lastFace.current.time < 1000) face = lastFace.current.box;
    }
    if (!face) needFullSearch.current = true; // re-tune from scratch when you come back
    faceRef.current = face;

    // 2. Measure the REAL lighting (camera alone) on a small copy of the frame.
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, AW, AH);
    const px = ctx.getImageData(0, 0, AW, AH).data;

    let s: Scores | null = null;
    let d: Direction[];
    if (face) {
      ema.current = smooth(ema.current, measure(px, AW, AH, face));
      s = score(ema.current, trackFace);
      d = directions(ema.current, s, true, trackFace);
    } else {
      d = directions({} as Metrics, {} as Scores, false, trackFace);
    }

    // 3. Auto light: search for the light that gives the best score, and keep re-tuning as you move.
    const st = settingsRef.current;
    if (face && st.lightOn) {
      if (st.autoLight) {
        const fullSearch = needFullSearch.current;
        const r = findBestAim(px, AW, AH, face, aimRef.current, baseLight(), trackFace, fullSearch);
        // Only move if it's clearly better, so the light doesn't wander back and forth.
        if (fullSearch || r.total >= r.currentTotal + 2) aimRef.current = r.aim;
        needFullSearch.current = false;
      }
      const shown = scoreWithLight(px, AW, AH, face, aimToLight(aimRef.current, face, baseLight()), trackFace);
      virtualEma.current = virtualEma.current === null ? shown : lerp(virtualEma.current, shown, 0.4);
      setVirtualTotal(Math.round(virtualEma.current));
    } else {
      virtualEma.current = null;
      setVirtualTotal(s ? s.total : null);
    }

    setScores(s);
    setDirs(d);
    setLightView(lightRef.current);
    maybeSpeak(d, s, now);
  }

  // Draw the relit camera and the light rig every animation frame.
  function render() {
    const video = videoRef.current;
    const relit = relitRef.current;
    const over = overlayRef.current;
    if (!video || !relit || !over || video.readyState < 2 || !video.videoWidth) return;

    const W = RW;
    const H = Math.round((RW * video.videoHeight) / video.videoWidth);
    if (!full.current) full.current = document.createElement("canvas");
    const f = full.current;
    if (f.width !== W || f.height !== H) {
      f.width = relit.width = over.width = W;
      f.height = relit.height = over.height = H;
      outImg.current = null;
    }

    // Glide the drawn light toward its target so it moves smoothly and follows your face.
    const face = faceRef.current;
    if (face) {
      const goal = aimToLight(aimRef.current, face, baseLight());
      const cur = lightRef.current;
      lightRef.current = {
        ...goal,
        x: lerp(cur.x, goal.x, 0.15),
        y: lerp(cur.y, goal.y, 0.15),
        intensity: lerp(cur.intensity, goal.intensity, 0.15),
        distance: lerp(cur.distance, goal.distance, 0.15),
        softness: lerp(cur.softness, goal.softness, 0.15),
      };
    } else {
      lightRef.current = baseLight();
    }

    const fctx = f.getContext("2d", { willReadFrequently: true })!;
    fctx.drawImage(video, 0, 0, W, H);
    const frame = fctx.getImageData(0, 0, W, H);
    const rctx = relit.getContext("2d")!;
    if (!outImg.current) outImg.current = rctx.createImageData(W, H);
    relightFrame(frame.data, outImg.current.data, W, H, face, lightRef.current);
    rctx.putImageData(outImg.current, 0, 0);

    const octx = over.getContext("2d")!;
    octx.clearRect(0, 0, W, H);
    const show = settingsRef.current.showModel;
    drawDebugOverlay(octx, W, H, face, lightRef.current, show, show, ema.current);
  }

  // Speak one instruction at a time, then tell the user if what they're doing is helping.
  function maybeSpeak(d: Direction[], s: Scores | null, now: number) {
    const top = d[0];
    if (top.key !== candidate.current.key) candidate.current = { key: top.key, since: now };
        if (!voiceRef.current) return;
    // Chrome sometimes reports "still speaking" forever, which would silence the coach. Reset it.
    if (window.speechSynthesis?.speaking) {
      if (now - spoken.current.time > 10000) window.speechSynthesis.cancel();
      return;
    }

    const a = active.current;
    const cur = top.factor && s ? s[top.factor] : 0;

    // Still working on the same problem: give progress feedback.
    if (a && a.key === top.key) {
      if (top.factor && now - a.time > 4000) {
        const delta = cur - a.value;
        if (delta > 0.12) return speakNow(phrase.better(), top, cur, now);
        if (delta < -0.12) return speakNow(phrase.worse(), top, cur, now);
      }
      if (top.key !== "good" && now - a.time > 12000) speakNow(top.text, top, cur, now);
      return;
    }

    // A new top problem: wait until it's stable so we don't react to flicker.
    if (now - candidate.current.since < 1200) return;
    if (a && now - a.time < 2500) return;
    const fixed = a && a.key !== "noface" && !d.some((x) => x.key === a.key);
    speakNow(fixed && top.key !== "good" ? `${phrase.fixed()} ${top.text}` : top.text, top, cur, now);
  }

  function speakNow(text: string, top: Direction, value: number, now: number) {
    say(text);
    active.current = { key: top.key, factor: top.factor, value, time: now };
    spoken.current = { text, time: now };
  }

  // Dragging the light switches to manual. The view is mirrored, so flip X back to raw camera coordinates.
  function moveLight(e: React.PointerEvent<HTMLCanvasElement>) {
    const face = faceRef.current;
    if (!face) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = 1 - (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (settingsRef.current.autoLight) updateSettings({ autoLight: false });
    const st = settingsRef.current;
    aimRef.current = lightToAim({ ...lightRef.current, x, y, intensity: st.manualIntensity, distance: st.manualDistance, softness: st.manualSoftness }, face);
  }

    const real = scores?.total ?? null;
  const auto = settings.autoLight;

  return (
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 20px 48px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
        <Orb size={54} />
        <div>
          <h1 className="aero-title">Light Coach</h1>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 16 }}>
            Your virtual light finds your best look. Your coach helps you get it for real.
          </p>
        </div>
      </header>

      <nav className="aero-tabs" style={{ margin: "14px 0 20px" }}>
        <button className={`aero-tab ${tab === "coach" ? "active" : ""}`} onClick={() => setTab("coach")}>
          Coach
        </button>
        <button className={`aero-tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
          Settings
        </button>
        <button className={`aero-tab ${tab === "why" ? "active" : ""}`} onClick={() => setTab("why")}>
          The Big Why??
        </button>
      </nav>

      {tab === "why" && <WhyTab />}

      {/* Hidden (not removed) on the Why tab, so the camera keeps running. */}
      <div style={{ display: tab === "why" ? "none" : "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div className="aero-frame" style={{ flex: "1 1 480px", maxWidth: 660 }}>
          <div style={{ position: "relative" }}>
            {/* The raw camera sits underneath; the relit view is drawn on top. Mirrored like a selfie camera. */}
            <video
              ref={videoRef}
              playsInline
              muted
              style={{
                width: "100%",
                aspectRatio: running ? undefined : "4 / 3", // keep the camera's real shape once it's on, so overlays line up
                borderRadius: 18,
                background: "radial-gradient(circle at 50% 35%, #2c86c4, #0b3a5c)",
                transform: "scaleX(-1)",
                display: "block",
              }}
            />
            <canvas ref={relitRef} style={{ ...layer, borderRadius: 18, pointerEvents: "none", visibility: running ? "visible" : "hidden" }} />
            <canvas
              ref={overlayRef}
              style={{ ...layer, cursor: "crosshair", touchAction: "none", pointerEvents: running ? "auto" : "none" }}
              onPointerDown={(e) => {
                dragging.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                moveLight(e);
              }}
              onPointerMove={(e) => dragging.current && moveLight(e)}
              onPointerUp={() => (dragging.current = false)}
              onPointerCancel={() => (dragging.current = false)}
            />
            {running && (
              <div
                style={{
                  position: "absolute",
                  left: 12,
                  bottom: 12,
                  color: "#fff",
                  fontSize: 12,
                  padding: "5px 12px",
                  borderRadius: 999,
                  pointerEvents: "none",
                  background: "rgba(10, 60, 100, 0.45)",
                  border: "1px solid rgba(255,255,255,0.4)",
                  backdropFilter: "blur(6px)",
                }}
              >
                {!settings.lightOn ? "Virtual light off" : auto ? "✨ Auto light: tuning for your best look" : "Manual light: drag to move it"}
              </div>
            )}
                        {running && mode === "loading" && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  textAlign: "center",
                  color: "#fff",
                  borderRadius: 18,
                  background: "rgba(10, 60, 100, 0.35)",
                  pointerEvents: "none",
                }}
              >
                <div>
                  <div className="aero-spinner" style={{ margin: "0 auto 10px" }} />
                  <div style={{ textShadow: "0 1px 3px rgba(0,40,80,0.6)" }}>Finding your face…</div>
                </div>
              </div>
            )}
            {!running && (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", color: "#fff" }}>
                <div>
                  <Orb size={86} />
                  <div style={{ margin: "10px 0 16px", fontSize: 17, textShadow: "0 1px 3px rgba(0,40,80,0.6)" }}>Ready when you are</div>
                  <button className="aero-btn big" onClick={start}>
                    Start camera
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="glass" style={{ flex: "1 1 300px", padding: 22 }}>
          {tab === "coach" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <ScoreRing value={virtualTotal} />
                                <div>
                  <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 6 }}>
                    {settings.lightOn ? "Your best possible look" : "Your lighting score"}
                  </div>
                  {settings.lightOn && (
                    // Before -> after, so it's obvious what the virtual light adds.
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-soft)" }}>
                      <div style={{ textAlign: "center" }}>
                        <strong id="real-score" data-score={real ?? ""} style={{ display: "block", color: scoreColor(real), fontSize: 24 }}>
                          {real ?? "--"}
                        </strong>
                        your camera
                      </div>
                      <span style={{ fontSize: 20, color: "var(--aqua)" }}>→</span>
                      <div style={{ textAlign: "center" }}>
                        <strong style={{ display: "block", color: scoreColor(virtualTotal), fontSize: 24 }}>{virtualTotal ?? "--"}</strong>
                        with light
                      </div>
                    </div>
                  )}
                </div>
              </div>

                            <div style={{ margin: "18px 0 10px", minHeight: 70 }}>
                <div style={{ fontSize: 21, fontWeight: 700 }}>
                  {running ? (dirs[0] ? HEADLINES[dirs[0].key] ?? "Next step" : "Looking for you…") : "Press Start camera to begin"}
                </div>
                {running && dirs[0] && (
                  <p id="instruction" style={{ fontSize: 15, lineHeight: 1.5, margin: "4px 0 0", color: "var(--ink-soft)" }}>
                    {dirs[0].text}
                  </p>
                )}
              </div>

              {dirs.length > 1 && (
                <ul style={{ marginTop: 0, paddingLeft: 18, color: "var(--ink-soft)", fontSize: 14 }}>
                  {dirs.slice(1).map((d) => (
                    <li key={d.key}>{d.text}</li>
                  ))}
                </ul>
              )}

              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--ink-soft)", margin: "14px 0 8px" }}>
                Your real setup
              </div>
                            {/* Framing can't be measured without face tracking, so hide it instead of showing a fake 100%. */}
              {LABELS.filter(([k]) => k !== "framing" || mode !== "center").map(([k, label]) => {
                const v = scores?.[k] ?? 0;
                return (
                  <div key={k} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span>{label}</span>
                      <span style={{ color: "var(--ink-soft)" }}>{Math.round(v * 100)}%</span>
                    </div>
                    <div className="aero-track">
                      <div className="aero-fill" style={{ width: `${Math.round(v * 100)}%`, background: fillGradient(v) }} />
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <>
              <h3 style={{ marginTop: 0, fontSize: 20 }}>Settings</h3>

              <Toggle label="Virtual light" on={settings.lightOn} onChange={(v) => updateSettings({ lightOn: v })} />
              <Toggle label="Auto light (best score)" on={auto} onChange={(v) => updateSettings({ autoLight: v })} />
              <Toggle label="Show how it works (head model, light ray)" on={settings.showModel} onChange={(v) => updateSettings({ showModel: v })} />
              <Toggle label="Voice directions" on={voiceOn} onChange={setVoiceOn} />

              <label style={{ display: "block", fontSize: 13, margin: "12px 0 8px" }}>
                Voice
                <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4 }}>
                  <option value="">Auto (most natural: {pickVoice("")?.name ?? "default"})</option>
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <Slider label="Voice speed" value={voiceRate} min={0.7} max={1.4} step={0.05} onChange={setVoiceRate} />
              <button
                className="aero-btn silver"
                style={{ marginBottom: 14 }}
                onClick={() => {
                  voiceNameRef.current = voiceName;
                  voiceRateRef.current = voiceRate;
                  say("Hi! This is how I'll sound while I help with your lighting.");
                }}
              >
                🔊 Test voice
              </button>

              <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "4px 0 8px" }}>
                {auto
                  ? "Auto light is choosing the position, intensity, distance, and softness. Turn it off or drag the light to adjust them yourself."
                  : "Manual: drag the light on the video, and use the sliders."}
              </p>

              <Slider
                label="Intensity"
                value={auto ? lightView.intensity : settings.manualIntensity}
                min={0}
                max={2}
                step={0.05}
                disabled={auto}
                onChange={(v) => updateSettings({ manualIntensity: v })}
              />
              <Slider
                label="Distance"
                value={auto ? lightView.distance : settings.manualDistance}
                min={0}
                max={1}
                step={0.05}
                disabled={auto}
                onChange={(v) => updateSettings({ manualDistance: v })}
              />
              <Slider
                label="Softness"
                value={auto ? lightView.softness : settings.manualSoftness}
                min={0}
                max={1}
                step={0.05}
                disabled={auto}
                onChange={(v) => updateSettings({ manualSoftness: v })}
              />

              <div style={{ fontSize: 13, margin: "6px 0" }}>Light color</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {COLORS.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => updateSettings({ colorName: c.name })}
                    title={c.name}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: 999,
                      cursor: "pointer",
                      font: "inherit",
                      fontSize: 12,
                      color: "var(--ink)",
                      background: `radial-gradient(circle at 35% 25%, #fff 0%, ${c.css} 45%, ${c.css} 100%)`,
                      border: settings.colorName === c.name ? "2px solid var(--aqua)" : "1px solid rgba(80,140,180,0.35)",
                      boxShadow: settings.colorName === c.name ? "0 0 0 3px rgba(30,155,224,0.2)" : "none",
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>

              <button
                className="aero-btn silver"
                onClick={() => {
                  aimRef.current = DEFAULT_AIM;
                  updateSettings({ ...DEFAULT_SETTINGS });
                  setVoiceOn(true);
                  setVoiceName("");
                  setVoiceRate(1);
                }}
              >
                Reset to defaults
              </button>
            </>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            <button className={`aero-btn ${voiceOn ? "" : "silver"}`} onClick={() => setVoiceOn((v) => !v)}>
              {voiceOn ? "🔊 Voice on" : "🔇 Voice off"}
            </button>
            {running && (
              <button className="aero-btn silver" onClick={stop}>
                Stop
              </button>
            )}
          </div>

          <p style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 0 }}>
            {mode === "loading" && "Loading face tracking..."}
            {mode === "face" && "● Face tracking on"}
            {mode === "center" && "Face tracking unavailable, so I'm checking the center of the frame. Framing tips are off."}
          </p>
          {error && <p style={{ color: "#d64545" }}>{error}</p>}
        </div>
      </div>

      <p
        className="glass"
        style={{ fontSize: 12, color: "var(--ink)", marginTop: 20, textAlign: "center", padding: "10px 16px", borderRadius: 16 }}
      >        Video stays on your computer and is never uploaded. The virtual light is a 2D preview using a simple head model, not a physically accurate
        relight. The voice directions are about your real lighting.
      </p>
    </main>
  );
}

// Glossy sphere logo, Frutiger Aero style.
function Orb({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: "drop-shadow(0 6px 10px rgba(0,80,140,0.35))", flexShrink: 0 }}>
      <defs>
        <radialGradient id="orbBody" cx="50%" cy="60%" r="60%">
          <stop offset="0" stopColor="#bff0ff" />
          <stop offset="0.55" stopColor="#36aef0" />
          <stop offset="1" stopColor="#0a6fb3" />
        </radialGradient>
        <radialGradient id="orbSun" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fffbe0" />
          <stop offset="0.6" stopColor="#ffd84d" />
          <stop offset="1" stopColor="#ffb300" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="orbShine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="url(#orbBody)" stroke="rgba(255,255,255,0.8)" strokeWidth="2" />
      <circle cx="62" cy="60" r="20" fill="url(#orbSun)" />
      <ellipse cx="50" cy="28" rx="32" ry="18" fill="url(#orbShine)" />
    </svg>
  );
}

// Round glossy score gauge.
function ScoreRing({ value }: { value: number | null }) {
  const pct = value ?? 0;
  const color = scoreColor(value);
  return (
    <div
      style={{
        width: 128,
        height: 128,
        borderRadius: "50%",
        padding: 9,
        flexShrink: 0,
        background: `conic-gradient(${color} ${pct * 3.6}deg, rgba(255,255,255,0.55) 0deg)`,
        boxShadow: "0 8px 22px rgba(0,80,140,0.22), inset 0 0 0 1px rgba(255,255,255,0.9)",
        transition: "background 0.3s",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: "radial-gradient(circle at 35% 25%, #ffffff 0%, #eaf8ff 45%, #cfeefc 100%)",
          boxShadow: "inset 0 -6px 14px rgba(0,100,170,0.15)",
        }}
      >
        <div style={{ textAlign: "center", lineHeight: 1 }}>
          <span id="score" data-score={value ?? ""} style={{ fontSize: 42, fontWeight: 700, color }}>
            {value ?? "--"}
          </span>
          <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>/ 100</div>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "block", marginBottom: 10, fontSize: 13, opacity: disabled ? 0.55 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>
          {label}
          {disabled ? " (auto)" : ""}
        </span>
        <span style={{ opacity: 0.6 }}>{value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} style={{ width: "100%" }} />
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.7)", cursor: "pointer" }}>
      <span>{label}</span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18 }} />
    </label>
  );
}

const layer: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", transform: "scaleX(-1)" };