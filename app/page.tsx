"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceDetector } from "@mediapipe/tasks-vision";
import { measure, score, directions, smooth, type Box, type Metrics, type Scores, type Direction } from "../lib/lighting/analyze";
import { COLORS, DEFAULT_LIGHT, realWorldAdvice, updateLightFromPointer } from "../lib/lighting/light";
import { relightFrame } from "../lib/lighting/relight";
import { drawDebugOverlay } from "../lib/lighting/visualize";
import type { VirtualLight } from "../lib/lighting/type";

const LOCAL_MODEL = "/mediapipe/blaze_face_short_range.tflite";
const REMOTE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const CENTER_BOX: Box = { x: 0.35, y: 0.2, w: 0.3, h: 0.45 };
const AW = 160; // analysis size: small is fast and plenty for lighting
const AH = 120;
const RW = 640; // virtual light render width

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

const scoreColor = (t: number | null) => (t === null ? "#999" : t >= 80 ? "#2e7d32" : t >= 50 ? "#c77700" : "#c62828");

export default function Coach() {
  const [running, setRunning] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [mode, setMode] = useState<"off" | "loading" | "face" | "center">("off");
  const [scores, setScores] = useState<Scores | null>(null);
  const [dirs, setDirs] = useState<Direction[]>([]);
  const [error, setError] = useState("");

  // Virtual light studio
  const [studio, setStudio] = useState(false);
  const [light, setLight] = useState<VirtualLight>(DEFAULT_LIGHT);
  const [colorName, setColorName] = useState("Warm");
  const [showOriginal, setShowOriginal] = useState(false);
  const [showModel, setShowModel] = useState(true);
  const [relitTotal, setRelitTotal] = useState<number | null>(null);
  const [advice, setAdvice] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const relitRef = useRef<HTMLCanvasElement>(null);
  const studioOverlayRef = useRef<HTMLCanvasElement>(null);
  const work = useRef<HTMLCanvasElement | null>(null);
  const full = useRef<HTMLCanvasElement | null>(null);
  const outImg = useRef<ImageData | null>(null);
  const detector = useRef<FaceDetector | null>(null);
  const ema = useRef<Metrics | null>(null);
  const relitEma = useRef<Metrics | null>(null);
  const faceRef = useRef<Box | null>(null);
  const voiceRef = useRef(true);
  const spoken = useRef({ text: "", time: 0 });
  const candidate = useRef({ text: "", since: 0 });
  const lastFace = useRef<{ box: Box; time: number } | null>(null);
  const raf = useRef(0);
  // Refs mirror state so the animation loop always sees the latest values.
  const studioRef = useRef(false);
  const lightRef = useRef<VirtualLight>(DEFAULT_LIGHT);
  const showOriginalRef = useRef(false);
  const showModelRef = useRef(true);
  const dragging = useRef(false);

  useEffect(() => {
    voiceRef.current = voiceOn;
    if (!voiceOn) window.speechSynthesis?.cancel();
  }, [voiceOn]);
  useEffect(() => {
    studioRef.current = studio;
    relitEma.current = null;
    setRelitTotal(null);
    setAdvice("");
    window.speechSynthesis?.cancel();
  }, [studio]);
  useEffect(() => {
    showOriginalRef.current = showOriginal;
  }, [showOriginal]);
  useEffect(() => {
    showModelRef.current = showModel;
  }, [showModel]);

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function changeLight(next: VirtualLight) {
    lightRef.current = next;
    setLight(next);
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
      if (studioRef.current) render();
      if (now - last > 150) {
        last = now;
        analyze(now);
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
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
    faceRef.current = face;

    // 2. Measure the REAL lighting on a small copy of the camera frame.
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
    setScores(s);
    setDirs(d);
    drawOverlay(face);

    // 3. In the studio, also score the relit image (clearly labeled as virtual).
    const relit = relitRef.current;
    if (studioRef.current && face && relit && relit.width && !showOriginalRef.current) {
      ctx.drawImage(relit, 0, 0, AW, AH);
      const rpx = ctx.getImageData(0, 0, AW, AH).data;
      relitEma.current = smooth(relitEma.current, measure(rpx, AW, AH, face));
      setRelitTotal(score(relitEma.current, trackFace).total);
    }

    // Spoken coaching only in Coach mode, so it doesn't talk over the light demo.
    if (!studioRef.current) maybeSpeak(d[0], now);
  }

  // Draw the relit frame and the light rig every animation frame.
  function render() {
    const video = videoRef.current;
    const relit = relitRef.current;
    const over = studioOverlayRef.current;
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

    const fctx = f.getContext("2d", { willReadFrequently: true })!;
    fctx.drawImage(video, 0, 0, W, H);
    const frame = fctx.getImageData(0, 0, W, H);
    const rctx = relit.getContext("2d")!;
    if (showOriginalRef.current) {
      rctx.putImageData(frame, 0, 0);
    } else {
      if (!outImg.current) outImg.current = rctx.createImageData(W, H);
      relightFrame(frame.data, outImg.current.data, W, H, faceRef.current, lightRef.current);
      rctx.putImageData(outImg.current, 0, 0);
    }

    const octx = over.getContext("2d")!;
    octx.clearRect(0, 0, W, H);
    if (!showOriginalRef.current)
      drawDebugOverlay(octx, W, H, faceRef.current, lightRef.current, showModelRef.current, showModelRef.current, ema.current);
  }

  // Speak the top direction only after it has been stable for a moment, and don't nag.
  function maybeSpeak(top: Direction, now: number) {
    if (top.text !== candidate.current.text) {
      candidate.current = { text: top.text, since: now };
      return;
    }
    if (!voiceRef.current || now - candidate.current.since < 1200) return;
    const last = spoken.current;
    const isNew = top.text !== last.text;
    const repeatOk = top.key !== "good" && now - last.time > 9000;
    if ((isNew || repeatOk) && now - last.time > 3000 && !window.speechSynthesis?.speaking) {
      say(top.text);
      spoken.current = { text: top.text, time: now };
    }
  }

  function drawOverlay(face: Box | null) {
    const c = overlayRef.current;
    const v = videoRef.current;
    if (!c || !v) return;
    c.width = v.clientWidth;
    c.height = v.clientHeight;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!face) return;
    ctx.strokeStyle = "#d9b44a";
    ctx.lineWidth = 3;
    ctx.setLineDash(detector.current ? [] : [8, 6]);
    ctx.strokeRect(face.x * c.width, face.y * c.height, face.w * c.width, face.h * c.height);
  }

  // The view is mirrored, so flip X back to raw camera coordinates.
  function moveLight(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const xRaw = 1 - (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    changeLight(updateLightFromPointer(lightRef.current, xRaw, y, 1, 1));
    setAdvice("");
  }

  function explainForReal() {
    const text = realWorldAdvice(lightRef.current, faceRef.current, colorName);
    setAdvice(text);
    if (voiceRef.current) say(text);
    spoken.current = { text, time: performance.now() };
  }

  const total = scores?.total ?? null;

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>Light Coach</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        A live lighting check before your video interview. Follow the spoken directions until the score turns green, or try a virtual light
        to see what better lighting would look like.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button style={studio ? tabOff : tabOn} onClick={() => setStudio(false)}>
          Coach
        </button>
        <button style={studio ? tabOn : tabOff} onClick={() => setStudio(true)}>
          Virtual light
        </button>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 480px", maxWidth: 640, alignSelf: "flex-start" }}>
          {/* Mirrored like a selfie camera so directions feel natural. */}
          <video ref={videoRef} playsInline muted style={{ width: "100%", borderRadius: 12, background: "#222", transform: "scaleX(-1)", display: "block" }} />
          <canvas ref={overlayRef} style={{ ...layer, pointerEvents: "none" }} />

          {/* Virtual light view sits on top of the camera. */}
          <canvas ref={relitRef} style={{ ...layer, borderRadius: 12, pointerEvents: "none", visibility: studio ? "visible" : "hidden" }} />
          <canvas
            ref={studioOverlayRef}
            style={{ ...layer, cursor: "crosshair", touchAction: "none", visibility: studio ? "visible" : "hidden", pointerEvents: studio ? "auto" : "none" }}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              moveLight(e);
            }}
            onPointerMove={(e) => dragging.current && moveLight(e)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
          />
          {studio && running && (
            <div style={{ position: "absolute", left: 10, bottom: 10, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 12, padding: "4px 8px", borderRadius: 6, pointerEvents: "none" }}>
              {showOriginal ? "Original camera" : "Drag anywhere to move the light"}
            </div>
          )}

          {!running && (
            <button onClick={start} style={{ ...button, position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", fontSize: 18 }}>
              Start camera
            </button>
          )}
        </div>

        <div style={{ flex: "1 1 280px", ...card }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span id="score" data-score={total ?? ""} style={{ fontSize: 64, fontWeight: 700, color: scoreColor(total) }}>
              {total ?? "--"}
            </span>
            <span style={{ opacity: 0.7 }}>/ 100 {studio ? "your real lighting" : "lighting score"}</span>
          </div>

          {studio ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: -4 }}>
                <span id="relit-score" style={{ fontSize: 32, fontWeight: 700, color: scoreColor(relitTotal) }}>
                  {relitTotal ?? "--"}
                </span>
                <span style={{ opacity: 0.7 }}>/ 100 with the virtual light</span>
              </div>

              <p style={{ fontSize: 15, marginBottom: 12 }}>
                Drag the light around your face. Then ask how to get this look with a real lamp.
              </p>

              <Slider label="Intensity" value={light.intensity} min={0.3} max={2} step={0.05} onChange={(v) => changeLight({ ...light, intensity: v })} />
              <Slider label="Softness" value={light.softness} min={0} max={1} step={0.05} onChange={(v) => changeLight({ ...light, softness: v })} />
              <Slider label="Distance" value={light.distance} min={0} max={1} step={0.05} onChange={(v) => changeLight({ ...light, distance: v })} />

              <div style={{ display: "flex", gap: 6, margin: "8px 0 12px" }}>
                {COLORS.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => {
                      setColorName(c.name);
                      changeLight({ ...light, color: c.color });
                    }}
                    style={{
                      flex: 1,
                      padding: "6px 0",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: c.css,
                      border: colorName === c.name ? "2px solid #3b2f1d" : "1px solid #e4d9bd",
                      fontSize: 12,
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  style={{ ...button, background: "#7a6a4f" }}
                  onPointerDown={() => setShowOriginal(true)}
                  onPointerUp={() => setShowOriginal(false)}
                  onPointerLeave={() => setShowOriginal(false)}
                >
                  Hold to see original
                </button>
                <button style={{ ...button, background: "#7a6a4f" }} onClick={() => setShowModel((v) => !v)}>
                  {showModel ? "Hide how it works" : "Show how it works"}
                </button>
              </div>

              <button style={{ ...button, width: "100%", marginTop: 12 }} onClick={explainForReal}>
                How do I get this for real?
              </button>
              {advice && <p style={{ fontSize: 15, fontWeight: 600 }}>{advice}</p>}
            </>
          ) : (
            <>
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
            {mode === "center" && "Face tracking unavailable, so I'm checking the center of the frame (dashed box). Framing tips are off."}
          </p>
          {error && <p style={{ color: "#c62828" }}>{error}</p>}
        </div>
      </div>

      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 16 }}>
        Video stays on your computer and is never uploaded. The score measures relative light in the camera image, so treat it as a guide. The
        virtual light is a 2D preview using a simple head model, not a physically accurate relight.
      </p>
    </main>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: "block", marginBottom: 8, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span style={{ opacity: 0.6 }}>{value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} style={{ width: "100%", accentColor: "#3b2f1d" }} />
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
