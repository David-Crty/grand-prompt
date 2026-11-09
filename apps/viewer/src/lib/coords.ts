/** Sim world is x/y with z up. three.js is y up, so sim (x, y, h) maps to three (x, h, -y). */
export type Vec3 = [number, number, number];

export function toThree(x: number, y: number, h = 0): Vec3 {
  return [x, h, -y];
}

export function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

/** Frame-rate independent exponential smoothing factor. */
export function dampFactor(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * Math.max(0, dt));
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, dampFactor(lambda, dt));
}

/** Shortest signed angle from a to b, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return current + angleDelta(current, target) * dampFactor(lambda, dt);
}
