/** Sim world is x/y with z up. three.js is y up, so sim (x, y, h) maps to three (x, h, -y). */
export type Vec3 = [number, number, number];

export function toThree(x: number, y: number, h = 0): Vec3 {
  return [x, h, -y];
}

/** A car model built along +X turns by `yaw` about three's Y axis. */
export function yawToThree(yaw: number): number {
  return yaw;
}

export function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

export function lerp3(a: Vec3, b: Vec3, u: number): Vec3 {
  return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
}

/** Frame-rate independent exponential smoothing factor. */
export function dampFactor(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * Math.max(0, dt));
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, dampFactor(lambda, dt));
}

export function damp3(current: Vec3, target: Vec3, lambda: number, dt: number): Vec3 {
  return lerp3(current, target, dampFactor(lambda, dt));
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

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}
