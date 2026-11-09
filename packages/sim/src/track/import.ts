import type { RunoffSpec, RunoffZone, TrackFile } from "../types.js";

export type Vec2 = [number, number];

const EARTH_RADIUS = 6371008.8;

/** Rows of a TUMFTM racetrack-database CSV (`x_m, y_m, w_tr_right_m, w_tr_left_m`). */
export function parseTumftmCsv(text: string): [number, number, number, number][] {
  const rows: [number, number, number, number][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const v = line.split(",").map(Number);
    if (v.length !== 4 || v.some((n) => !Number.isFinite(n))) throw new Error(`bad TUMFTM row: '${line}'`);
    rows.push(v as [number, number, number, number]);
  }
  return rows;
}

/** Equirectangular projection to metres (x east, y north) around `origin` [lon, lat]. */
export function projectLonLat(points: Vec2[], origin: Vec2): Vec2[] {
  const k = Math.cos((origin[1] * Math.PI) / 180);
  const r = (d: number) => (d * Math.PI * EARTH_RADIUS) / 180;
  return points.map(([lon, lat]) => [r(lon - origin[0]) * k, r(lat - origin[1])]);
}

const same = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];

/**
 * Join polylines (OSM ways in metres, any order and direction) into one closed ring. From the end
 * of the chain it continues on the unused way with the nearest node: normally a shared end node,
 * but a way may also be joined at an interior node (the part behind is dropped, the direction is
 * the one that keeps heading forward), and a gap up to `gap` metres is bridged with a straight,
 * since mapped circuit relations are not always complete. Every way must be used.
 * The returned ring has no duplicated closing point.
 */
export function chainWays(ways: Vec2[][], gap = 0): Vec2[] {
  if (ways.length === 0) throw new Error("no ways to chain");
  const used = new Array<boolean>(ways.length).fill(false);
  used[0] = true;
  let chain = [...ways[0]!];
  for (let step = 1; step < ways.length; step++) {
    const tail = chain.at(-1)!;
    let best = -1;
    let at = 0;
    let bestD = Number.POSITIVE_INFINITY;
    ways.forEach((w, j) => {
      if (used[j]) return;
      w.forEach((p, k) => {
        const d = Math.hypot(p[0] - tail[0], p[1] - tail[1]);
        if (d < bestD) {
          bestD = d;
          best = j;
          at = k;
        }
      });
    });
    if (bestD > gap) throw new Error(`no way continues the chain at (${tail[0]}, ${tail[1]})`);
    used[best] = true;
    const w = ways[best]!;
    const prev = chain.at(-2) ?? tail;
    const hx = tail[0] - prev[0];
    const hy = tail[1] - prev[1];
    const ahead = (q: Vec2 | undefined) => (q ? (q[0] - w[at]![0]) * hx + (q[1] - w[at]![1]) * hy : -1);
    const forward = at === 0 || (at < w.length - 1 && ahead(w[at + 1]) >= ahead(w[at - 1]));
    const rest = forward ? w.slice(at) : w.slice(0, at + 1).reverse();
    chain = chain.concat(same(rest[0]!, tail) ? rest.slice(1) : rest);
  }
  const head = chain[0]!;
  const end = chain.at(-1)!;
  const d = Math.hypot(end[0] - head[0], end[1] - head[1]);
  if (d > gap) throw new Error("the ways do not close into a loop");
  return d === 0 ? chain.slice(0, -1) : chain;
}

/** Twice the signed area: positive when the ring runs anticlockwise. */
export function signedArea(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

/** Point `step` metres apart along a closed polyline (the last step absorbs the remainder). */
export function resampleClosed(ring: Vec2[], step: number): Vec2[] {
  const n = ring.length;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    cum.push(cum[i]! + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const total = cum[n]!;
  const count = Math.max(4, Math.round(total / step));
  const ds = total / count;
  const out: Vec2[] = [];
  let k = 0;
  for (let i = 0; i < count; i++) {
    const s = i * ds;
    while (cum[k + 1]! < s) k++;
    const p = ring[k]!;
    const q = ring[(k + 1) % n]!;
    const f = (s - cum[k]!) / (cum[k + 1]! - cum[k]! || 1);
    out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
  }
  return out;
}

/** Gaussian smoothing of a uniformly sampled closed ring; `sigma` in samples. */
export function smoothClosed(ring: Vec2[], sigma: number): Vec2[] {
  if (sigma <= 0) return ring.map((p) => [...p] as Vec2);
  const n = ring.length;
  const r = Math.ceil(3 * sigma);
  const w = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const sum = w.reduce((a, b) => a + b, 0);
  return ring.map((_, i) => {
    let x = 0;
    let y = 0;
    for (let d = -r; d <= r; d++) {
      const p = ring[(((i + d) % n) + n) % n]!;
      x += p[0] * w[d + r]!;
      y += p[1] * w[d + r]!;
    }
    return [x / sum, y / sum];
  });
}

export interface CenterlineOptions {
  /** World point the start/finish line should sit at (the nearest sample becomes point 0). */
  start: Vec2;
  /** Driving direction. */
  clockwise: boolean;
  /** Gaussian smoothing radius, metres (default 4). */
  smooth?: number;
  /** Output point spacing, metres (default 5). */
  spacing?: number;
}

/** Raw centerline (e.g. chained OSM ways) to evenly spaced, smoothed points in driving order. */
export function prepareCenterline(ring: Vec2[], o: CenterlineOptions): Vec2[] {
  const fine = resampleClosed(ring, 1);
  const smooth = smoothClosed(fine, o.smooth ?? 4);
  if (signedArea(smooth) > 0 === o.clockwise) smooth.reverse();
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  smooth.forEach((p, i) => {
    const d = Math.hypot(p[0] - o.start[0], p[1] - o.start[1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return resampleClosed([...smooth.slice(best), ...smooth.slice(0, best)], o.spacing ?? 5);
}

export interface ImportedTrackMeta {
  id: string;
  name: string;
  sectors: [number, number];
  runoff: { default: RunoffSpec; zones?: RunoffZone[] };
  license: string;
  source: string;
}

/** Assemble a track file; coordinates are rounded to the centimetre to keep the JSON small. */
export function importedTrackFile(
  meta: ImportedTrackMeta,
  points: Vec2[] | [number, number, number, number][],
  width?: { left: number; right: number },
): TrackFile {
  const c = (v: number) => Math.round(v * 100) / 100 + 0;
  return {
    id: meta.id,
    name: meta.name,
    version: 1,
    closed: true,
    points: points.map((p) => {
      const wr = p.length === 4 ? p[2] : width?.right;
      const wl = p.length === 4 ? p[3] : width?.left;
      if (wr === undefined || wl === undefined) throw new Error("points without widths need a width");
      return [c(p[0]), c(p[1]), c(wr), c(wl)];
    }),
    sectors: meta.sectors,
    runoff: meta.runoff,
    license: meta.license,
    source: meta.source,
  };
}
