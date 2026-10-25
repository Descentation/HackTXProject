import { measure, score, type Box } from "./analyze";
import { relightFrame } from "./relight";
import type { VirtualLight } from "./type";

// Where the virtual light sits RELATIVE to the face, so it follows you when you move.
// ox/oy are in face widths/heights from the face center. Negative oy = above.
export type LightAim = { ox: number; oy: number; intensity: number; distance: number; softness: number };

export const DEFAULT_AIM: LightAim = { ox: 0.8, oy: -0.6, intensity: 1.0, distance: 0.45, softness: 0.55 };

const clamp = (v: number) => Math.max(0.02, Math.min(0.98, v));
const INTENSITIES = [0, 0.4, 0.7, 1.0, 1.3, 1.6, 2.0];
const DISTANCES = [0.15, 0.45, 0.8];
const SOFTNESS = [0.15, 0.55, 0.9];

// Candidate spots around the face: in front and a little above, plus two rings of 8 directions.
const SPOTS: { ox: number; oy: number }[] = [{ ox: 0, oy: -0.25 }];
for (const r of [0.7, 1.3]) {
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    SPOTS.push({ ox: Math.cos(a) * r, oy: Math.sin(a) * r });
  }
}

export function faceAnchor(face: Box) {
  return { cx: face.x + face.w / 2, cy: face.y + face.h * 0.45 };
}

// Turn a face-relative aim into an actual light in frame coordinates.
export function aimToLight(aim: LightAim, face: Box, base: VirtualLight): VirtualLight {
  const { cx, cy } = faceAnchor(face);
  return { ...base, x: clamp(cx + aim.ox * face.w), y: clamp(cy + aim.oy * face.h), intensity: aim.intensity, distance: aim.distance, softness: aim.softness };
}

export function lightToAim(light: VirtualLight, face: Box): LightAim {
  const { cx, cy } = faceAnchor(face);
  return { ox: (light.x - cx) / face.w, oy: (light.y - cy) / face.h, intensity: light.intensity, distance: light.distance, softness: light.softness };
}

let scratch: Uint8ClampedArray | null = null;

// Score the frame as it would look with this light (on the small analysis frame).
export function scoreWithLight(px: Uint8ClampedArray, W: number, H: number, face: Box, light: VirtualLight, trackFace: boolean): number {
  if (!scratch || scratch.length !== px.length) scratch = new Uint8ClampedArray(px.length);
  relightFrame(px, scratch, W, H, face, light);
  return score(measure(scratch, W, H, face), trackFace).total;
}

/**
 * Search for the light that gives the highest score.
 * full = try every combination (when the face first appears).
 * Otherwise do a quick local search around the current aim (every frame, so it tracks you).
 */
export function findBestAim(
  px: Uint8ClampedArray,
  W: number,
  H: number,
  face: Box,
  current: LightAim,
  base: VirtualLight,
  trackFace: boolean,
  full: boolean
): { aim: LightAim; total: number; currentTotal: number } {
  const evalAim = (aim: LightAim) => scoreWithLight(px, W, H, face, aimToLight(aim, face, base), trackFace);
  const currentTotal = evalAim(current);
  let best = current;
  let bestTotal = currentTotal;
  const consider = (aim: LightAim) => {
    const t = evalAim(aim);
    // On ties prefer the gentler light, so it doesn't max out for no reason.
    if (t > bestTotal || (t === bestTotal && aim.intensity < best.intensity)) {
      best = aim;
      bestTotal = t;
    }
  };

    if (full) {
    // First look: every spot and strength (~120 tries), then distance and softness.
    // Kept small so the video doesn't stutter; the quick search below refines it every frame after.
    for (const s of SPOTS) for (const intensity of INTENSITIES) consider({ ...best, ...s, intensity });
    for (const distance of DISTANCES) consider({ ...best, distance });
    for (const softness of SOFTNESS) consider({ ...best, softness });
  } else {
    for (const s of SPOTS) consider({ ...best, ...s });
    for (const intensity of INTENSITIES) consider({ ...best, intensity });
    for (const distance of DISTANCES) consider({ ...best, distance });
    for (const softness of SOFTNESS) consider({ ...best, softness });
  }
  return { aim: best, total: bestTotal, currentTotal };
}