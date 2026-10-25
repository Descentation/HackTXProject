import type { Box, VirtualLight } from "./type";

// The head is modeled as an ellipse (really half an ellipsoid) slightly bigger than the
// face box, since the detector's box is tight around eyes-to-mouth.
export function faceEllipse(face: Box, W: number, H: number) {
  return {
    cx: (face.x + face.w / 2) * W,
    cy: (face.y + face.h * 0.45) * H,
    rx: face.w * W * 0.62,
    ry: face.h * H * 0.78,
  };
}

const FEATHER = 0.35; // how far past the ellipse the light fades out (in face radii)

/**
 * Relight one frame with a virtual light. 2D approximation, not physically accurate:
 * 1. Treat the head as an ellipsoid and estimate a surface normal for each pixel.
 * 2. Shade it with the light direction (Lambert, with "wrap" for softness).
 * 3. Multiply the original pixels by that shading, so skin texture and features are kept
 *    (no blur, no beauty filter). The side away from the light gets a gentle shadow.
 * Coordinates are in the RAW camera frame (not mirrored).
 */
export function relightFrame(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  W: number,
  H: number,
  face: Box | null,
  light: VirtualLight
) {
  dst.set(src);
  if (!light.enabled || !face) return;

  const { cx, cy, rx, ry } = faceEllipse(face, W, H);

  // Light direction in 3D. x/y in face radii, z points out of the screen toward the light.
  // A farther light sits more in front of you, so its light is flatter and gentler.
  const lx = (light.x * W - cx) / rx;
  const ly = (light.y * H - cy) / ry;
  const lz = 0.6 + light.distance * 1.4;
  const len = Math.hypot(lx, ly, lz);
  const Lx = lx / len;
  const Ly = ly / len;
  const Lz = lz / len;

  const wrap = 0.15 + light.softness * 0.85; // soft light wraps around the face
  const power = light.intensity * (1.25 - light.distance * 0.55);
  const shadow = (1 - light.softness) * 0.35 * Math.min(1, light.intensity);
  const [cr, cg, cb] = light.color;

  const outer = 1 + FEATHER;
  const x0 = Math.max(0, Math.floor(cx - rx * outer));
  const x1 = Math.min(W, Math.ceil(cx + rx * outer));
  const y0 = Math.max(0, Math.floor(cy - ry * outer));
  const y1 = Math.min(H, Math.ceil(cy + ry * outer));

  for (let y = y0; y < y1; y++) {
    const ny0 = (y - cy) / ry;
    for (let x = x0; x < x1; x++) {
      const nx0 = (x - cx) / rx;
      const d2 = nx0 * nx0 + ny0 * ny0;
      if (d2 >= outer * outer) continue;

      // Surface normal of the ellipsoid (edge-on outside the ellipse).
      const d = Math.sqrt(d2);
      let nx = nx0;
      let ny = ny0;
      let nz = 0;
      if (d < 1) nz = Math.sqrt(1 - d2);
      else {
        nx /= d;
        ny /= d;
      }

      // Smooth fade at the edge so there's no visible outline.
      const t = d <= 1 ? 1 : 1 - (d - 1) / FEATHER;
      const mask = t * t * (3 - 2 * t);

      const lit = Math.max(0, (nx * Lx + ny * Ly + nz * Lz + wrap) / (1 + wrap));
      const g = mask * lit * power;
      const dim = 1 - mask * shadow * (1 - lit);

      const i = (y * W + x) * 4;
      dst[i] = src[i] * dim * (1 + g * cr) + g * cr * 22;
      dst[i + 1] = src[i + 1] * dim * (1 + g * cg) + g * cg * 22;
      dst[i + 2] = src[i + 2] * dim * (1 + g * cb) + g * cb * 22;
    }
  }
}
