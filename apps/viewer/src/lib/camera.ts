import type { Vec3 } from "./coords.js";
import { toThree } from "./coords.js";

export interface Pose {
  pos: Vec3;
  look: Vec3;
  fov: number;
}

export interface CarPose {
  x: number;
  y: number;
  yaw: number;
}

/** Behind and above the car, looking a little ahead. `heading` is a smoothed yaw. */
export function chasePose(c: CarPose, heading: number, dist = 9.5, height = 3.2): Pose {
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  return {
    pos: toThree(c.x - fx * dist, c.y - fy * dist, height),
    look: toThree(c.x + fx * 8, c.y + fy * 8, 1.0),
    fov: 58,
  };
}

/** T-cam above the airbox, looking down the road. */
export function onboardPose(c: CarPose): Pose {
  const fx = Math.cos(c.yaw);
  const fy = Math.sin(c.yaw);
  return {
    pos: toThree(c.x - fx * 0.4, c.y - fy * 0.4, 1.12),
    look: toThree(c.x + fx * 30, c.y + fy * 30, 0.75),
    fov: 72,
  };
}

/**
 * Helicopter: high, behind and to one side of the focus point, telephoto. `spread` (m) is the
 * distance between the cars being framed, which pulls the camera back.
 */
export function heliPose(fx: number, fy: number, heading: number, spread: number, orbit = 0.75): Pose {
  const dist = 42 + spread * 0.85;
  const height = 21 + spread * 0.5;
  const a = heading + Math.PI + orbit;
  return {
    pos: toThree(fx + Math.cos(a) * dist, fy + Math.sin(a) * dist, height),
    look: toThree(fx, fy, 0.5),
    fov: 30,
  };
}

/** Fixed trackside camera panning to the car, zoomed so the car fills a fixed width. */
export function tracksidePose(
  cam: { x: number; y: number; h: number },
  target: { x: number; y: number },
  frameWidth = 16,
): Pose {
  const d = Math.hypot(target.x - cam.x, target.y - cam.y);
  const fov = Math.min(50, Math.max(5, (2 * Math.atan(frameWidth / 2 / Math.max(1, d)) * 180) / Math.PI));
  return { pos: toThree(cam.x, cam.y, cam.h), look: toThree(target.x, target.y, 0.7), fov };
}

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Straight down over the bounds, fitted into the part of a W x H viewport left free by the
 * HUD insets (px). Screen up is sim +y.
 */
export function mapPose(
  b: { minX: number; maxX: number; minY: number; maxY: number },
  W: number,
  H: number,
  insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 },
  fov = 35,
  margin = 1.06,
): Pose {
  const rw = Math.max(50, W - insets.left - insets.right);
  const rh = Math.max(50, H - insets.top - insets.bottom);
  const scale = Math.max((b.maxX - b.minX) / rw, (b.maxY - b.minY) / rh) * margin;
  const rcx = insets.left + rw / 2 - W / 2;
  const rcy = insets.top + rh / 2 - H / 2;
  const cx = (b.minX + b.maxX) / 2 - rcx * scale;
  const cy = (b.minY + b.maxY) / 2 + rcy * scale;
  const halfH = (scale * H) / 2;
  const z = halfH / Math.tan((fov * Math.PI) / 360);
  return { pos: toThree(cx, cy, z), look: toThree(cx, cy, 0), fov };
}

/** Index of the camera 50..260 m ahead of a car at distance s, or null. */
export function cameraAhead(
  cams: { s: number }[],
  s: number,
  length: number,
  min = 50,
  max = 260,
): number | null {
  let best: number | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  cams.forEach((c, k) => {
    const d = (((c.s - s) % length) + length) % length;
    if (d >= min && d <= max && d < bestD) {
      bestD = d;
      best = k;
    }
  });
  return best;
}

/** True once the car is more than `margin` metres past the camera (looping distance). */
export function cameraPassed(camS: number, s: number, length: number, margin = 30): boolean {
  let d = (s - camS) % length;
  if (d > length / 2) d -= length;
  else if (d <= -length / 2) d += length;
  return d > margin;
}

/** 0..1 ease-in-out over `duration`. */
export function blendWeight(elapsed: number, duration: number): number {
  const u = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 1;
  return u * u * (3 - 2 * u);
}

/** Vertical FOV that keeps a 16:9 horizontal framing on narrower screens, capped. */
export function fitFov(fov: number, aspect: number, ref = 16 / 9, max = 80): number {
  if (aspect >= ref) return fov;
  const half = (fov * Math.PI) / 360;
  return Math.min(max, (2 * Math.atan((Math.tan(half) * ref) / Math.max(0.2, aspect)) * 180) / Math.PI);
}
