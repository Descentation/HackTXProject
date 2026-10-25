export type Box = { x: number; y: number; w: number; h: number };

export type VirtualLight = {
  // Position in normalized camera space (0–1). 
  // (0.5, 0.5) = center of frame
  x: number;
  y: number;

  // How far the light is from the face (0 = very close / harsh, 1 = far / soft)
  distance: number;

  // Softness of the falloff (0 = hard, 1 = very soft)
  softness: number;

  // Intensity multiplier
  intensity: number;

  // RGB color of the light (0–1)
  color: [number, number, number];

  // Whether the light is currently active
  enabled: boolean;
};

export type RelightOptions = {
  preserveDetail: boolean;   // keep original texture instead of smoothing
  showMesh: boolean;
  showLightRay: boolean;
  showBeforeAfter: boolean;
};