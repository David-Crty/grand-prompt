import type { Vec3 } from "./coords.js";
import { toThree } from "./coords.js";

export interface Pose {
  pos: Vec3;
  look: Vec3;
  fov: number;
  /** Screen-up direction (three coords); world up when absent. */
  up?: Vec3;
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

/** Vertical FOV that keeps a 16:9 horizontal framing on narrower screens, capped. */
export function fitFov(fov: number, aspect: number, ref = 16 / 9, max = 80): number {
  if (aspect >= ref) return fov;
  const half = (fov * Math.PI) / 360;
  return Math.min(max, (2 * Math.atan((Math.tan(half) * ref) / Math.max(0.2, aspect)) * 180) / Math.PI);
}

/**
 * Widest stretch of ground (m, across the free part of the screen) the TV camera opens up to.
 * Cars that would need more stay out of the frame. Lower it to stay closer on the cars.
 */
export const TV_MAX_SPAN = 120;
/** Range of the live TV zoom factor, which divides both spans (2 = twice as close). */
export const TV_ZOOM_MIN = 0.4;
export const TV_ZOOM_MAX = 2.8;

export function clampZoom(z: number): number {
  return Math.min(TV_ZOOM_MAX, Math.max(TV_ZOOM_MIN, z));
}

/** One zoom step from `z`: in (dir 1) or out (dir -1), by a constant ratio, clamped. */
export function stepZoom(z: number, dir: 1 | -1, ratio = 1.15): number {
  return clampZoom(dir > 0 ? z * ratio : z / ratio);
}

/** Tightest framing (m), used when the focused car is alone. */
export const TV_MIN_SPAN = 42;
/** Ground kept around the framed cars (m), plus a share of the frame on each side. */
export const TV_PAD = 6;
export const TV_MARGIN = 0.15;
/** A car joins the frame only below this share of the max span, and leaves above the max. */
export const TV_JOIN = 0.85;
/** Seconds a car must keep fitting before it joins the frame, and keep not fitting before it leaves. */
export const TV_JOIN_HOLD = 1;
export const TV_LEAVE_HOLD = 2;
/** Past this share of the max span a framed car leaves at once, before it slips off the screen. */
export const TV_STRETCH = 1.3;

export interface TvCar {
  id: string;
  x: number;
  y: number;
}

export interface TvFrame {
  x: number;
  y: number;
  /** Ground width (m) the free part of the screen must show. */
  span: number;
  /** Cars inside the frame, the focus first. */
  ids: string[];
  /** Seconds each car has been waiting to join or leave; pass it back as `wait` next frame. */
  wait: Record<string, number>;
}

export interface TvOptions {
  /** The previous frame's `ids`. A different focus (or none) decides every car at once. */
  prev?: readonly string[];
  wait?: Readonly<Record<string, number>>;
  /** Seconds since the previous frame; without it every car is decided at once. */
  dt?: number;
  maxSpan?: number;
  minSpan?: number;
  pad?: number;
}

/**
 * The TV framing: the focus car plus the nearest cars that still fit within `maxSpan`, in screen
 * axes where `heading` points right. `aspect` is the free area's width over height. Cars already
 * in `prev` stay until they no longer fit; new ones join only below `TV_JOIN` of the max, so a car
 * hovering at the limit does not pump the zoom. A change also has to hold for `TV_JOIN_HOLD` or
 * `TV_LEAVE_HOLD` seconds, so a car that drifts across the limit in a corner does not flip the
 * zoom back and forth; a framed car past `TV_STRETCH` of the max leaves at once.
 */
export function tvFrame(
  focus: TvCar,
  others: TvCar[],
  heading: number,
  aspect: number,
  {
    prev = [],
    wait = {},
    dt = Number.POSITIVE_INFINITY,
    maxSpan = TV_MAX_SPAN,
    minSpan = TV_MIN_SPAN,
    pad = TV_PAD,
  }: TvOptions = {},
): TvFrame {
  const steady = prev[0] === focus.id;
  const waited: Record<string, number> = {};
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const local = (p: TvCar) => {
    const dx = p.x - focus.x;
    const dy = p.y - focus.y;
    return { u: dx * c + dy * s, v: -dx * s + dy * c };
  };
  const box = { u0: 0, u1: 0, v0: 0, v1: 0 };
  const need = (b: typeof box) =>
    Math.max(b.u1 - b.u0 + 2 * pad, (b.v1 - b.v0 + 2 * pad) * aspect) / (1 - 2 * TV_MARGIN);
  const ids = [focus.id];
  const sorted = others
    .filter((o) => o.id !== focus.id)
    .map((o) => ({ id: o.id, ...local(o) }))
    .sort((a, b) => Math.hypot(a.u, a.v) - Math.hypot(b.u, b.v));
  for (const o of sorted) {
    const next = {
      u0: Math.min(box.u0, o.u),
      u1: Math.max(box.u1, o.u),
      v0: Math.min(box.v0, o.v),
      v1: Math.max(box.v1, o.v),
    };
    const was = prev.includes(o.id);
    const n = need(next);
    let keep = n <= (was ? maxSpan : maxSpan * TV_JOIN);
    if (steady && keep !== was) {
      const w = (wait[o.id] ?? 0) + dt;
      if (w < (was ? TV_LEAVE_HOLD : TV_JOIN_HOLD)) {
        waited[o.id] = w;
        keep = was;
      }
    }
    if (keep && n > maxSpan * TV_STRETCH) {
      delete waited[o.id];
      keep = false;
    }
    if (!keep) continue;
    Object.assign(box, next);
    ids.push(o.id);
  }
  const mu = (box.u0 + box.u1) / 2;
  const mv = (box.v0 + box.v1) / 2;
  return {
    x: focus.x + mu * c - mv * s,
    y: focus.y + mu * s + mv * c,
    span: Math.min(maxSpan, Math.max(minSpan, need(box))),
    ids,
    wait: waited,
  };
}

/** How far (degrees) the TV camera leans off the vertical, looking across the track from its right. */
export const TV_TILT = 32;

/**
 * Over (x, y), rotated so `heading` points right, far enough that `span` metres fill the width of
 * the part of a W x H viewport left free by the HUD insets, with (x, y) at its centre. The camera
 * leans `tilt` degrees off the vertical toward the bottom of the screen, so the far side of the
 * road sits at the top and the cars show a little of their side.
 */
export function tvPose(
  frame: { x: number; y: number; span: number },
  heading: number,
  W: number,
  H: number,
  insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 },
  fov = 24,
  tilt = TV_TILT,
): Pose {
  const t = (tilt * Math.PI) / 180;
  const rw = Math.max(50, W - insets.left - insets.right);
  const scale = frame.span / rw;
  const rcx = (insets.left + rw / 2 - W / 2) * scale;
  const rh = Math.max(50, H - insets.top - insets.bottom);
  const rcy = ((insets.top + rh / 2 - H / 2) * scale) / Math.cos(t);
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const cx = frame.x - rcx * c - rcy * s;
  const cy = frame.y - rcx * s + rcy * c;
  const d = (scale * H) / 2 / Math.tan((fov * Math.PI) / 360);
  const back = d * Math.sin(t);
  return {
    pos: toThree(cx + back * s, cy - back * c, d * Math.cos(t)),
    look: toThree(cx, cy, 0),
    fov,
    up: toThree(-s, c, 0),
  };
}
