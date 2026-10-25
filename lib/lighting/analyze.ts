// Lighting analysis for one webcam frame. Everything here is plain math on pixels,
// so it runs fast in the browser and never sends video anywhere.
//
// Coordinates are in the RAW camera frame (not mirrored), normalized 0..1.
// In the raw frame, image-left is the user's RIGHT side, and image-right is the user's LEFT.

export type Box = { x: number; y: number; w: number; h: number };

export type Metrics = {
  faceP90: number; // brightness of the brighter parts of the face (0-255)
  clipFrac: number; // share of face pixels that are blown out (pure white)
  bgMean: number; // average brightness behind/around you
  leftMean: number; // raw image-left half of face (= your right side)
  rightMean: number; // raw image-right half of face (= your left side)
  cx: number; // face center x
  cy: number; // face center y
  size: number; // face height as a share of frame height
};

export type Scores = {
  brightness: number;
  backlight: number;
  evenness: number;
  notBlown: number;
  framing: number;
  total: number;
};

export type Direction = { key: string; text: string };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function measure(px: Uint8ClampedArray, W: number, H: number, face: Box): Metrics {
  // Use the inner part of the face box so hair and background don't count as face.
  const fx0 = Math.max(0, Math.floor((face.x + face.w * 0.15) * W));
  const fx1 = Math.min(W, Math.ceil((face.x + face.w * 0.85) * W));
  const fy0 = Math.max(0, Math.floor((face.y + face.h * 0.1) * H));
  const fy1 = Math.min(H, Math.ceil((face.y + face.h * 0.9) * H));
  const midX = (fx0 + fx1) / 2;

  const hist = new Uint32Array(256);
  let n = 0;
  let clipped = 0;
  let leftSum = 0;
  let leftN = 0;
  let rightSum = 0;
  let rightN = 0;
  for (let y = fy0; y < fy1; y++) {
    for (let x = fx0; x < fx1; x++) {
      const i = (y * W + x) * 4;
      const v = lum(px[i], px[i + 1], px[i + 2]);
      hist[Math.min(255, Math.round(v))]++;
      n++;
      if (v > 245) clipped++;
      if (x < midX) {
        leftSum += v;
        leftN++;
      } else {
        rightSum += v;
        rightN++;
      }
    }
  }

  // 90th percentile: robust to skin tone, since well-lit faces of any tone have bright highlights.
  let faceP90 = 0;
  let seen = 0;
  for (let b = 0; b < 256; b++) {
    seen += hist[b];
    if (seen >= n * 0.9) {
      faceP90 = b;
      break;
    }
  }

  // Background = upper part of the frame (where windows and lamps usually are), minus a padded face area.
  const cxp = (face.x + face.w / 2) * W;
  const cyp = (face.y + face.h / 2) * H;
  const halfW = face.w * W * 0.8;
  const halfH = face.h * H * 0.8;
  let bgSum = 0;
  let bgN = 0;
  let allSum = 0;
  const bgRows = Math.floor(H * 0.65);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = lum(px[i], px[i + 1], px[i + 2]);
      allSum += v;
      if (y < bgRows && (Math.abs(x - cxp) > halfW || Math.abs(y - cyp) > halfH)) {
        bgSum += v;
        bgN++;
      }
    }
  }
  const bgMean = bgN > W * H * 0.05 ? bgSum / bgN : allSum / (W * H);

  return {
    faceP90,
    clipFrac: n ? clipped / n : 0,
    bgMean,
    leftMean: leftN ? leftSum / leftN : 0,
    rightMean: rightN ? rightSum / rightN : 0,
    cx: face.x + face.w / 2,
    cy: face.y + face.h / 2,
    size: face.h,
  };
}

export function score(m: Metrics, trackFace: boolean): Scores {
  const brightness = m.faceP90 >= 120 ? 1 : clamp01((m.faceP90 - 45) / 75);
  const notBlown = 1 - clamp01((m.clipFrac - 0.03) / 0.17);
  const ratio = m.faceP90 / Math.max(m.bgMean, 1);
  const backlight = clamp01((ratio - 0.55) / 0.45);
  const asym = Math.abs(m.leftMean - m.rightMean) / Math.max(m.leftMean, m.rightMean, 1);
  const evenness = 1 - clamp01((asym - 0.12) / 0.33);

  let framing = 1;
  if (trackFace) {
    const sizeS = m.size < 0.25 ? clamp01((m.size - 0.1) / 0.15) : m.size > 0.5 ? clamp01(1 - (m.size - 0.5) / 0.25) : 1;
    const off = Math.max(Math.abs(m.cx - 0.5), Math.abs(m.cy - 0.42));
    const posS = 1 - clamp01((off - 0.12) / 0.25);
    framing = 0.5 * sizeS + 0.5 * posS;
  }

  // Weighted average, pulled down hard when any single problem is severe
  // (a very dark face shouldn't score 70 just because everything else is fine).
  const weighted = 0.3 * brightness + 0.25 * backlight + 0.2 * evenness + 0.1 * notBlown + 0.15 * framing;
  const worst = Math.min(brightness, backlight, evenness, notBlown, framing);
  const total = Math.round(100 * weighted * (0.4 + 0.6 * worst));
  return { brightness, backlight, evenness, notBlown, framing, total };
}

// Most important fix first. The first item is what gets spoken.
export function directions(m: Metrics, s: Scores, faceFound: boolean, trackFace: boolean): Direction[] {
  if (!faceFound) return [{ key: "noface", text: "I can't find your face. Sit in front of the camera." }];

  const out: Direction[] = [];
  // Backlight first: when a window is behind you, your face is dark *because* of it.
  if (s.backlight < 0.7)
    out.push({ key: "backlit", text: "There's bright light behind you. Turn your laptop so the window is in front of you, or close the blinds behind you." });
  if (s.brightness < 0.7)
    out.push({ key: "dark", text: "It's too dark on your face. Turn toward a window, or put a lamp behind your screen pointing at you." });
  if (s.notBlown < 0.7)
    out.push({ key: "blown", text: "Your face is too bright. Move back from the light, or point the lamp at a wall instead." });
  if (s.evenness < 0.7) {
    // Raw image-right is the user's left side.
    out.push(
      m.rightMean > m.leftMean
        ? { key: "uneven-left", text: "The light is coming from your left. Turn slightly to your left, toward the light." }
        : { key: "uneven-right", text: "The light is coming from your right. Turn slightly to your right, toward the light." }
    );
  }
  if (trackFace) {
    if (m.size < 0.25) out.push({ key: "closer", text: "Move a little closer to the screen." });
    if (m.size > 0.5) out.push({ key: "back", text: "Lean back a little." });
    // Face on raw image-left means you're shifted to your own right.
    if (m.cx < 0.38) out.push({ key: "go-left", text: "Move a little to your left." });
    if (m.cx > 0.62) out.push({ key: "go-right", text: "Move a little to your right." });
    if (m.cy > 0.55) out.push({ key: "tilt-down", text: "Tilt your screen down a little." });
    if (m.cy < 0.28) out.push({ key: "tilt-back", text: "Tilt your screen back a little." });
  }
  if (!out.length) {
    out.push(
      s.total >= 80
        ? { key: "good", text: "Great lighting. You're ready." }
        : { key: "almost", text: "Almost there. Try facing the light a little more." }
    );
  }
  return out;
}

export function smooth(prev: Metrics | null, next: Metrics, a = 0.3): Metrics {
  if (!prev) return next;
  const out = { ...next };
  for (const k of Object.keys(next) as (keyof Metrics)[]) out[k] = prev[k] * (1 - a) + next[k] * a;
  return out;
}
