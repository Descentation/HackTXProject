"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceDetector } from "@mediapipe/tasks-vision";
import { measure, score, directions, smooth, type Box, type Metrics, type Scores, type Direction } from "../lib/lighting/analyze";
import { COLORS, DEFAULT_LIGHT, realWorldAdvice } from "../lib/lighting/light";
import { relightFrame } from "../lib/lighting/relight";
import { drawDebugOverlay } from "../lib/lighting/visualize";
import { DEFAULT_AIM, aimToLight, findBestAim, lightToAim, scoreWithLight, type LightAim } from "../lib/lighting/optimize";
import type { VirtualLight } from "../lib/lighting/type";

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

const scoreColor = (t: number | null) => (t === null ? "#999" : t >= 80 ? "#2e7d32" : t >= 50 ? "#c77700" : "#c62828");
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export default function Coach() {
  const [tab, setTab] = useState<"coach" | "settings">("coach");
  const [running, setRunning] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [mode, setMode] = useState<"off" | "loading" | "face" | "center">("off");
  const [scores, setScores] = useState<Scores | null>(null);
  const [virtualTotal, setVirtualTotal] = useState<number | null>(null);
  const [dirs, setDirs] = useState<Direction[]>([]);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [lightView, setLightView] = useState<VirtualLight>(DEFAULT_LIGHT);
  const [showOriginal, setShowOriginal] = useState(false);
  const [advice, setAdvice] = useState("");

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
  const showOriginalRef = useRef(false);
  const dragging = useRef(false);

  useEffect(() => {
    voiceRef.current = voiceOn;
    if (!voiceOn) window.speechSynthesis?.cancel();
  }, [voiceOn]);
  useEffect(() => {
    showOriginalRef.current = showOriginal;
  }, [showOriginal]);

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
    u.rate = 1.05;
    synth.speak(u);
  }

  async function start() {
    setError("");
    // Speaking inside the click lets browsers allow audio later.
    if (voiceRef.current) say("Lighting coach started.");
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
    if (showOriginalRef.current) {
      rctx.putImageData(frame, 0, 0);
    } else {
      if (!outImg.current) outImg.current = rctx.createImageData(W, H);
      relightFrame(frame.data, outImg.current.data, W, H, face, lightRef.current);
      rctx.putImageData(outImg.current, 0, 0);
    }

    const octx = over.getContext("2d")!;
    octx.clearRect(0, 0, W, H);
    const show = settingsRef.current.showModel;
    if (!showOriginalRef.current) drawDebugOverlay(octx, W, H, face, lightRef.current, show, show, ema.current);
  }

  // Speak one instruction at a time, then tell the user if what they're doing is helping.
  function maybeSpeak(d: Direction[], s: Scores | null, now: number) {
    const top = d[0];
    if (top.key !== candidate.current.key) candidate.current = { key: top.key, since: now };
    if (!voiceRef.current || window.speechSynthesis?.speaking) return;

    const a = active.current;
    const cur = top.factor && s ? s[top.factor] : 0;

    // Still working on the same problem: give progress feedback.
    if (a && a.key === top.key) {
      if (top.factor && now - a.time > 4000) {
        const delta = cur - a.value;
        if (delta > 0.12) return speakNow("Better. Keep going.", top, cur, now);
        if (delta < -0.12) return speakNow("That made it worse. Go back the other way.", top, cur, now);
      }
      if (top.key !== "good" && now - a.time > 12000) speakNow(top.text, top, cur, now);
      return;
    }

    // A new top problem: wait until it's stable so we don't react to flicker.
    if (now - candidate.current.since < 1200) return;
    if (a && now - a.time < 2500) return;
    const fixed = a && a.key !== "noface" && !d.some((x) => x.key === a.key);
    speakNow(fixed && top.key !== "good" ? `That's fixed. ${top.text}` : top.text, top, cur, now);
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
    setAdvice("");
  }

  function explainForReal() {
    const text = realWorldAdvice(lightRef.current, faceRef.current, settingsRef.current.colorName);
    setAdvice(text);
    if (voiceRef.current) say(text);
    spoken.current = { text, time: performance.now() };
  }

  const real = scores?.total ?? null;
  const auto = settings.autoLight;

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>Light Coach</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        A live lighting check before your video interview. A virtual light sets itself for the best possible score, and the voice tells you how to
        improve your real lighting even more.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button style={tab === "coach" ? tabOn : tabOff} onClick={() => setTab("coach")}>
          Coach
        </button>
        <button style={tab === "settings" ? tabOn : tabOff} onClick={() => setTab("settings")}>
          Settings
        </button>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 480px", maxWidth: 640, alignSelf: "flex-start" }}>
          {/* The raw camera sits underneath; the relit view is drawn on top. Mirrored like a selfie camera. */}
          <video ref={videoRef} playsInline muted style={{ width: "100%", borderRadius: 12, background: "#222", transform: "scaleX(-1)", display: "block" }} />
          <canvas ref={relitRef} style={{ ...layer, borderRadius: 12, pointerEvents: "none", visibility: running ? "visible" : "hidden" }} />
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
            <div style={{ position: "absolute", left: 10, bottom: 10, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 12, padding: "4px 8px", borderRadius: 6, pointerEvents: "none" }}>
              {showOriginal ? "Original camera" : !settings.lightOn ? "Virtual light off" : auto ? "Auto light: tuning for the best score" : "Manual light: drag to move it"}
            </div>
          )}
          {!running && (
            <button onClick={start} style={{ ...button, position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", fontSize: 18 }}>
              Start camera
            </button>
          )}
        </div>

        <div style={{ flex: "1 1 280px", ...card }}>
          {tab === "coach" ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span id="score" data-score={virtualTotal ?? ""} style={{ fontSize: 64, fontWeight: 700, color: scoreColor(virtualTotal) }}>
                  {virtualTotal ?? "--"}
                </span>
                <span style={{ opacity: 0.7 }}>/ 100 {settings.lightOn ? "with virtual light" : "lighting score"}</span>
              </div>
              {settings.lightOn && (
                <div style={{ marginTop: -6, fontSize: 15 }}>
                  Camera alone:{" "}
                  <strong id="real-score" data-score={real ?? ""} style={{ color: scoreColor(real) }}>
                    {real ?? "--"}
                  </strong>
                </div>
              )}

              <p id="instruction" style={{ fontSize: 20, fontWeight: 600, minHeight: 56 }}>
                {running ? dirs[0]?.text ?? "Looking..." : "Press Start camera."}
              </p>

              {dirs.length > 1 && (
                <ul style={{ marginTop: 0, paddingLeft: 18, opacity: 0.8 }}>
                  {dirs.slice(1).map((d) => (
                    <li key={d.key}>{d.text}</li>
                  ))}
                </ul>
              )}

              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Your real setup</div>
              {LABELS.map(([k, label]) => (
                <div key={k} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 13 }}>{label}</div>
                  <div style={{ background: "#eee3c8", borderRadius: 6, height: 10 }}>
                    <div
                      style={{
                        width: `${Math.round((scores?.[k] ?? 0) * 100)}%`,
                        height: "100%",
                        borderRadius: 6,
                        background: (scores?.[k] ?? 0) >= 0.7 ? "#2e7d32" : "#c77700",
                        transition: "width 0.2s",
                      }}
                    />
                  </div>
                </div>
              ))}

              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button
                  style={{ ...button, background: "#7a6a4f" }}
                  onPointerDown={() => setShowOriginal(true)}
                  onPointerUp={() => setShowOriginal(false)}
                  onPointerLeave={() => setShowOriginal(false)}
                >
                  Hold to see original
                </button>
                <button style={button} onClick={explainForReal} disabled={!running}>
                  How do I get this for real?
                </button>
              </div>
              {advice && <p style={{ fontSize: 15, fontWeight: 600 }}>{advice}</p>}
            </>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>Settings</h3>

              <Toggle label="Virtual light" on={settings.lightOn} onChange={(v) => updateSettings({ lightOn: v })} />
              <Toggle label="Auto light (best score)" on={auto} onChange={(v) => updateSettings({ autoLight: v })} />
              <Toggle label="Show how it works (head model, light ray)" on={settings.showModel} onChange={(v) => updateSettings({ showModel: v })} />
              <Toggle label="Voice directions" on={voiceOn} onChange={setVoiceOn} />

              <p style={{ fontSize: 12, opacity: 0.7, margin: "4px 0 8px" }}>
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

              <div style={{ fontSize: 13, margin: "4px 0" }}>Light color</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                {COLORS.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => updateSettings({ colorName: c.name })}
                    style={{
                      flex: 1,
                      padding: "6px 0",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: c.css,
                      border: settings.colorName === c.name ? "2px solid #3b2f1d" : "1px solid #e4d9bd",
                      fontSize: 12,
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>

              <button
                style={{ ...button, background: "#7a6a4f" }}
                onClick={() => {
                  aimRef.current = DEFAULT_AIM;
                  updateSettings({ ...DEFAULT_SETTINGS });
                  setVoiceOn(true);
                }}
              >
                Reset to defaults
              </button>
            </>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button style={button} onClick={() => setVoiceOn((v) => !v)}>
              {voiceOn ? "Voice: on" : "Voice: off"}
            </button>
            {running && (
              <button style={{ ...button, background: "#7a6a4f" }} onClick={stop}>
                Stop
              </button>
            )}
          </div>

          <p style={{ fontSize: 12, opacity: 0.7 }}>
            {mode === "loading" && "Loading face tracking..."}
            {mode === "face" && "Face tracking on."}
            {mode === "center" && "Face tracking unavailable, so I'm checking the center of the frame. Framing tips are off."}
          </p>
          {error && <p style={{ color: "#c62828" }}>{error}</p>}
        </div>
      </div>

      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 16 }}>
        Video stays on your computer and is never uploaded. The score measures relative light in the camera image, so treat it as a guide. The
        virtual light is a 2D preview using a simple head model, not a physically accurate relight. The voice directions are about your real
        lighting.
      </p>
    </main>
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
    <label style={{ display: "block", marginBottom: 8, fontSize: 13, opacity: disabled ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>
          {label}
          {disabled ? " (auto)" : ""}
        </span>
        <span style={{ opacity: 0.6 }}>{value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} style={{ width: "100%", accentColor: "#3b2f1d" }} />
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, marginBottom: 8, cursor: "pointer" }}>
      <span>{label}</span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: "#3b2f1d" }} />
    </label>
  );
}

const layer: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", transform: "scaleX(-1)" };
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e4d9bd", borderRadius: 12, padding: 16 };
const button: React.CSSProperties = {
  background: "#3b2f1d",
  color: "#fff",
  padding: "10px 16px",
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
};
const tabOn: React.CSSProperties = { ...button, padding: "8px 16px" };
const tabOff: React.CSSProperties = { ...button, padding: "8px 16px", background: "transparent", color: "#3b2f1d", border: "1px solid #c9b88f" };