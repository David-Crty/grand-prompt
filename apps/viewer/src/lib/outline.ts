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

function rotatedBox(points: readonly Point[], a: number) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    const u = p[0]! * c - p[1]! * s;
    const v = p[0]! * s + p[1]! * c;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { a, minU, minV, spanU: Math.max(1, maxU - minU), spanV: Math.max(1, maxV - minV) };
}

/**
 * The outline of a closed circuit from its file's points (`[x, y, …]` in metres), centred in the box and turned
 * (in 5 degree steps) to whichever angle draws it largest, as the minimap does. The path keeps about `maxPoints`
 * vertices. Null for fewer than three valid points.
 */
export function trackOutline(points: unknown, width = 160, height = 100, maxPoints = 200): Outline | null {
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
  const fit = (b: ReturnType<typeof rotatedBox>) => Math.min(width / b.spanU, height / b.spanV);
  let box = rotatedBox(pts, 0);
  for (let deg = 5; deg < 180; deg += 5) {
    const b = rotatedBox(pts, (deg * Math.PI) / 180);
    if (fit(b) > fit(box) * 1.02) box = b;
  }
  const k = fit(box);
  const ox = (width - box.spanU * k) / 2;
  const oy = (height - box.spanV * k) / 2;
  const c = Math.cos(box.a);
  const s = Math.sin(box.a);
  const step = Math.max(1, Math.floor(pts.length / maxPoints));
  const parts: string[] = [];
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i]!;
    const x = ox + (p[0]! * c - p[1]! * s - box.minU) * k;
    const y = height - oy - (p[0]! * s + p[1]! * c - box.minV) * k;
    parts.push(`${parts.length ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return { width, height, path: `${parts.join("")}Z`, length: Math.round(length) };
}
