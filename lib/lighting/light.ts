import type { Box, VirtualLight } from "./type";

// Positions are in the RAW camera frame (not mirrored), 0..1.
// Raw image-right = the user's LEFT side.
export const DEFAULT_LIGHT: VirtualLight = {
  x: 0.65,
  y: 0.25,
  distance: 0.45,
  softness: 0.55,
  intensity: 1.15,
  color: [1.0, 0.97, 0.92],
  enabled: true,
};

export const COLORS: { name: string; color: [number, number, number]; css: string }[] = [
  { name: "Warm", color: [1.0, 0.96, 0.9], css: "#fff2dc" },
  { name: "Cool", color: [0.88, 0.93, 1.0], css: "#dfeaff" },
  { name: "Gold", color: [1.0, 0.86, 0.65], css: "#ffd9a0" },
  { name: "White", color: [1, 1, 1], css: "#ffffff" },
];

export function updateLightFromPointer(
  light: VirtualLight,
  canvasX: number,
  canvasY: number,
  canvasW: number,
  canvasH: number
): VirtualLight {
  return {
    ...light,
    x: Math.max(0.02, Math.min(0.98, canvasX / canvasW)),
    y: Math.max(0.02, Math.min(0.98, canvasY / canvasH)),
  };
}

// Turn the virtual light's position into instructions for a real lamp.
export function realWorldAdvice(light: VirtualLight, face: Box | null, colorName: string): string {
  const fcx = face ? face.x + face.w / 2 : 0.5;
  const fcy = face ? face.y + face.h * 0.4 : 0.4;
  const dx = light.x - fcx; // positive = raw image-right = the user's left
  const dy = light.y - fcy; // positive = below the face

  const side = Math.abs(dx) < 0.08 ? "" : dx > 0 ? "to your left" : "to your right";
  const height = dy < -0.08 ? "a little above your eyes" : dy > 0.12 ? "below your face" : "at eye level";
  const where = side ? `${height} and ${side}` : `${height}, straight in front of you`;
  const dist = light.distance < 0.35 ? "about an arm's length away" : light.distance < 0.7 ? "about three feet away" : "across the room";

  const parts = [`To get this look for real, put a lamp ${where}, ${dist}.`];
  if (dy > 0.12) parts.push("Light from below can look spooky, so raise it if you can.");
  if (light.softness >= 0.6) parts.push("Use a lampshade or bounce it off a wall so it's soft.");
  else if (light.softness < 0.3) parts.push("A bare bulb gives this harder look.");
  if (colorName === "Warm" || colorName === "Gold") parts.push("Use a warm white bulb.");
  if (colorName === "Cool") parts.push("Use a daylight bulb.");
  return parts.join(" ");
}
