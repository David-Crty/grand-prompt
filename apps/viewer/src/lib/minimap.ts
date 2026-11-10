import type { TrackLayout } from "./track.js";

export interface Minimap {
  width: number;
  height: number;
  /** SVG path of the centreline, closed. */
  path: string;
  /** Start/finish tick: two points across the track at s = 0. */
  start: [number, number, number, number];
  /** Rotation applied to the circuit (rad, counter-clockwise). */
  angle: number;
  /** Sim (x, y) to SVG pixels, after the rotation; screen up is rotated sim +y. */
  project: (x: number, y: number) => [number, number];
}

function rotatedBox(L: TrackLayout, a: number) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < L.n; i++) {
    const u = L.cx[i]! * c - L.cy[i]! * s;
    const v = L.cx[i]! * s + L.cy[i]! * c;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { minU, minV, spanU: Math.max(1, maxU - minU), spanV: Math.max(1, maxV - minV) };
}

/**
 * The circuit scaled into a `width`-wide box no taller than `maxHeight`, keeping its shape, with
 * `pad` px around it. It is turned (in 5 degree steps) to whichever angle draws it largest, so a
 * tall circuit lies on its side. The centreline is decimated to about `points` vertices.
 */
export function buildMinimap(
  L: TrackLayout,
  width: number,
  maxHeight: number,
  pad = 10,
  points = 400,
): Minimap {
  const fit = (b: ReturnType<typeof rotatedBox>) =>
    Math.min((width - 2 * pad) / b.spanU, (maxHeight - 2 * pad) / b.spanV);
  let angle = 0;
  let box = rotatedBox(L, 0);
  for (let deg = 5; deg < 180; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const b = rotatedBox(L, a);
    if (fit(b) > fit(box) * 1.02) {
      angle = a;
      box = b;
    }
  }
  const scale = fit(box);
  const height = Math.ceil(box.spanV * scale + 2 * pad);
  const ox = (width - box.spanU * scale) / 2;
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  const project = (x: number, y: number): [number, number] => [
    ox + (x * c - y * sn - box.minU) * scale,
    height - pad - (x * sn + y * c - box.minV) * scale,
  ];
  const step = Math.max(1, Math.floor(L.n / points));
  const parts: string[] = [];
  for (let i = 0; i < L.n; i += step) {
    const [px, py] = project(L.cx[i]!, L.cy[i]!);
    parts.push(`${parts.length ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`);
  }
  const half = 5;
  const [sx, sy] = project(L.cx[0]!, L.cy[0]!);
  const nx = L.nx[0]! * c - L.ny[0]! * sn;
  const ny = L.nx[0]! * sn + L.ny[0]! * c;
  return {
    width,
    height,
    angle,
    path: `${parts.join("")}Z`,
    start: [sx + nx * half, sy - ny * half, sx - nx * half, sy + ny * half],
    project,
  };
}

function pointAt(L: TrackLayout, s: number): { x: number; y: number; nx: number; ny: number } {
  const u = (((s % L.length) + L.length) % L.length) / L.spacing;
  const i = Math.floor(u) % L.n;
  const j = (i + 1) % L.n;
  const a = u - Math.floor(u);
  const lerp = (v: Float64Array) => v[i]! + (v[j]! - v[i]!) * a;
  return { x: lerp(L.cx), y: lerp(L.cy), nx: L.nx[i]!, ny: L.ny[i]! };
}

/** The centreline from distance `from` to `to` as an open SVG path in map pixels, about every `step` m. */
export function stretchPath(L: TrackLayout, map: Minimap, from: number, to: number, step = 8): string {
  const n = Math.max(1, Math.ceil((to - from) / step));
  const parts: string[] = [];
  for (let k = 0; k <= n; k++) {
    const p = pointAt(L, from + ((to - from) * k) / n);
    const [x, y] = map.project(p.x, p.y);
    parts.push(`${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return parts.join("");
}

/**
 * Where to write a corner's number on the map: `offset` px from the centreline at its apex, on the outside of the
 * turn (the right of a left-hander).
 */
export function cornerLabelAt(
  L: TrackLayout,
  map: Minimap,
  corner: { sApex: number; dir: "L" | "R" },
  offset = 14,
): { x: number; y: number } {
  const p = pointAt(L, corner.sApex);
  const side = corner.dir === "L" ? -1 : 1;
  const [x0, y0] = map.project(p.x, p.y);
  const [x1, y1] = map.project(p.x + p.nx * side, p.y + p.ny * side);
  const d = Math.hypot(x1 - x0, y1 - y0) || 1;
  return { x: x0 + ((x1 - x0) / d) * offset, y: y0 + ((y1 - y0) / d) * offset };
}
