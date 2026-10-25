# Light Coach

A live lighting check for video calls and interviews. It shows a 0-100 lighting score, bars for each part of the score, and speaks directions out loud ("turn slightly to your left", "tilt your screen down") until the score turns green. Video never leaves your computer.

## Run it (Windows PowerShell)

```powershell
npm install
npm run dev
```

Open http://localhost:3000 in Chrome or Edge, press **Start camera**, and allow camera access. Turn your volume up for the spoken directions.

`npm install` also copies the face-tracking files into `public/mediapipe/wasm` automatically.

## Optional: make face tracking work offline (recommended before the demo)

The face-tracking model downloads from Google the first time. To keep a local copy so venue Wi-Fi can't break your demo:

```powershell
Invoke-WebRequest -Uri "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite" -OutFile "public\mediapipe\blaze_face_short_range.tflite"
```

If face tracking can't load at all, the app still works: it checks the center of the frame (dashed box) and turns framing tips off. You can force that mode with http://localhost:3000/?center

## How the score works

- **Face brightness (30%)**: the brighter parts of your face (90th percentile). Using highlights instead of the average keeps the check fairer across skin tones. Test it on teammates with different skin tones and say so in your pitch.
- **No glare behind you (25%)**: your face vs. the area behind you. A window behind you makes this drop.
- **Even light (20%)**: left half of your face vs. right half.
- **Not washed out (10%)**: how much of your face is pure white.
- **Framing (15%)**: face size and position (only with face tracking).

Any single severe problem pulls the total down hard, so a very dark face can't score well just because everything else is fine.

## Virtual light tab

Drag a glowing light around your face and change its intensity, softness, distance, and color. The panel shows your **real** score next to the score **with the virtual light**. Hold "Hold to see original" for a before/after. "Show how it works" draws the head model, the ray from the light, and an arrow for the side your real light is coming from. "How do I get this for real?" says where to put a real lamp.

How it works: the head is modeled as an ellipsoid, each pixel gets a surface direction, and it is shaded toward the light (Lambert shading, with "wrap" for soft light). The original pixels are multiplied, not blurred, so your features stay sharp. It is a 2D preview, not physically accurate relighting.

## Where to edit

- `lib/lighting/analyze.ts`: the measurements, score, and the spoken direction text
- `lib/lighting/relight.ts`: the virtual light shading
- `lib/lighting/light.ts`: default light, colors, and the "get this for real" advice
- `lib/lighting/visualize.ts`: head model, light ray, and orb drawing
- `app/page.tsx`: the camera page, tabs, voice timing, and layout
