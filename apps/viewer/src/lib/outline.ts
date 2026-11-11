import { mapAngle, rotatedBounds } from "./orientation.js";

/** A circuit's centreline drawn into a `width` × `height` box, for the race list thumbnails. */
export interface Outline {
  width: number;
  height: number;
  /** Closed SVG path in box units. */
  path: string;
  /** Centreline length, m. */
  length: number;
}

type Point = readonly number[];

/**
 * The outline of a closed circuit from its file's points (`[x, y, …]` in metres), centred in the box and turned
 * to its `mapAngle`, as the minimap is. The path keeps about `maxPoints` vertices. Null for fewer than three
 * valid points.
 */
export function trackOutline(
  points: unknown,
  trackId?: string,
  width = 160,
  height = 100,
  maxPoints = 200,
): Outline | null {
  if (!Array.isArray(points)) return null;
  const pts = points.filter(
    (p): p is Point => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
  );
  if (pts.length < 3) return null;
  let length = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    length += Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
  }
  const xs = pts.map((p) => p[0]!);
  const ys = pts.map((p) => p[1]!);
  const angle = mapAngle(trackId, xs, ys);
  const box = rotatedBounds(xs, ys, angle);
  const k = Math.min(width / box.spanU, height / box.spanV);
  const ox = (width - box.spanU * k) / 2;
  const oy = (height - box.spanV * k) / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const step = Math.max(1, Math.floor(pts.length / maxPoints));
  const parts: string[] = [];
  for (let i = 0; i < pts.length; i += step) {
    const x = ox + (xs[i]! * c - ys[i]! * s - box.minU) * k;
    const y = height - oy - (xs[i]! * s + ys[i]! * c - box.minV) * k;
    parts.push(`${parts.length ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return { width, height, path: `${parts.join("")}Z`, length: Math.round(length) };
}
