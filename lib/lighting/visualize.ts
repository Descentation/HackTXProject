import type { Box, VirtualLight } from "./type";
import { faceEllipse } from "./relight";

type Measured = { leftMean: number; rightMean: number } | null;

// The canvas is mirrored with CSS, so flip text back so it reads normally.
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(-w / 2, -14, w, 20);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 1);
  ctx.restore();
}

function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - 12 * Math.cos(a - 0.45), y1 - 12 * Math.sin(a - 0.45));
  ctx.lineTo(x1 - 12 * Math.cos(a + 0.45), y1 - 12 * Math.sin(a + 0.45));
  ctx.fill();
}

/**
 * Draw the head model, the real light direction we measured, the ray from the
 * virtual light, and the glowing light orb (the drag handle).
 */
export function drawDebugOverlay(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  face: Box | null,
  light: VirtualLight,
  showMesh = true,
  showLightRay = true,
  measured: Measured = null
) {
  const e = face ? faceEllipse(face, W, H) : null;

  if (e && showMesh) {
    const { cx, cy, rx, ry } = e;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(120, 200, 255, 0.8)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Wireframe of the ellipsoid head model.
    ctx.strokeStyle = "rgba(120, 200, 255, 0.35)";
    for (const lat of [-0.6, -0.3, 0, 0.3, 0.6]) {
      const y = cy + ry * lat;
      const hw = rx * Math.sqrt(1 - lat * lat);
      ctx.beginPath();
      ctx.moveTo(cx - hw, y);
      ctx.lineTo(cx + hw, y);
      ctx.stroke();
    }
    for (const lon of [-0.6, -0.3, 0, 0.3, 0.6]) {
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) {
        const a = -Math.PI / 2 + (Math.PI * k) / 24;
        const x = cx + rx * lon * Math.cos(a);
        const y = cy + ry * Math.sin(a);
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    label(ctx, "head model", cx, cy - ry - 8, "rgba(160, 215, 255, 0.95)");

    // Which side the REAL light comes from, measured from the camera image.
    if (measured) {
      const asym = (measured.rightMean - measured.leftMean) / Math.max(measured.leftMean, measured.rightMean, 1);
      if (Math.abs(asym) > 0.06) {
        const dir = asym > 0 ? 1 : -1;
        const sx = cx + dir * rx * 1.7;
        arrow(ctx, sx, cy, cx + dir * rx * 1.05, cy, "#f2b632");
        label(ctx, "real light", sx, cy - 16, "#f2b632");
      }
    }
  }

  if (!light.enabled) return;
  const lx = light.x * W;
  const ly = light.y * H;
  const rgb = `${light.color[0] * 255},${light.color[1] * 255},${light.color[2] * 255}`;

  // Light ray from the orb to the face.
  if (e && showLightRay) {
    const gradient = ctx.createLinearGradient(lx, ly, e.cx, e.cy);
    gradient.addColorStop(0, `rgba(${rgb},0.9)`);
    gradient.addColorStop(1, "rgba(255,255,255,0.05)");
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(e.cx, e.cy);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Glowing light orb.
  const radius = 14 + light.intensity * 6;
  const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, radius * 2.8);
  glow.addColorStop(0, `rgba(${rgb},0.55)`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(lx, ly, radius * 2.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(lx, ly, radius, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${rgb})`;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(lx - radius * 0.25, ly - radius * 0.25, radius * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fill();

  if (showLightRay) label(ctx, "virtual light", lx, ly + radius + 22, "#ffffff");
}
