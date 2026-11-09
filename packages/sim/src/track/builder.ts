import type { RunoffZone, TrackFile } from "../types.js";

/**
 * Segment-based builder for handmade circuits: straights and corners with clothoid transitions,
 * integrated into a centerline. Closure is enforced by adjusting the lengths of two straights.
 */
export type Segment =
  | { kind: "straight"; length: number; adjust?: "a" | "b"; width?: number; label?: string }
  | {
      kind: "corner";
      /** degrees, positive = left */
      angle: number;
      radius: number;
      transition?: number;
      width?: number;
      label?: string;
    };

interface Piece {
  length: number;
  k0: number;
  k1: number;
  width: number;
  label?: string;
}

function pieces(segs: Segment[], defaultWidth: number, adj: { a: number; b: number }): Piece[] {
  const out: Piece[] = [];
  for (const s of segs) {
    const w = s.width ?? defaultWidth;
    if (s.kind === "straight") {
      const extra = s.adjust ? adj[s.adjust] : 0;
      out.push({ length: s.length + extra, k0: 0, k1: 0, width: w, label: s.label });
      continue;
    }
    const k = (Math.sign(s.angle) || 1) / s.radius;
    const total = (Math.abs(s.angle) * Math.PI) / 180;
    let lt = s.transition ?? Math.min(30, s.radius * 0.6);
    // transitions turn by k*lt/2 each; keep at least a little constant-radius arc
    if (Math.abs(k) * lt > total * 0.9) lt = (total * 0.9) / Math.abs(k);
    const arc = (total - Math.abs(k) * lt) / Math.abs(k);
    out.push({ length: lt, k0: 0, k1: k, width: w, label: s.label });
    out.push({ length: arc, k0: k, k1: k, width: w, label: s.label });
    out.push({ length: lt, k0: k, k1: 0, width: w, label: s.label });
  }
  return out;
}

export interface BuiltTrack {
  points: [number, number, number, number][];
  /** Arc length at which each labelled segment starts. */
  labels: { label: string; s: number }[];
  length: number;
  closureError: number;
}

function integrate(ps: Piece[], step: number) {
  let x = 0;
  let y = 0;
  let h = 0;
  let s = 0;
  const pts: [number, number, number, number][] = [];
  const labels: { label: string; s: number }[] = [];
  let lastLabel: string | undefined;
  for (const p of ps) {
    if (p.label && p.label !== lastLabel) labels.push({ label: p.label, s });
    lastLabel = p.label;
    const n = Math.max(1, Math.ceil(p.length / (step / 8)));
    const ds = p.length / n;
    for (let i = 0; i < n; i++) {
      if (pts.length === 0 || s - pts.length * step >= 0) pts.push([x, y, p.width / 2, p.width / 2]);
      const k = p.k0 + ((p.k1 - p.k0) * (i + 0.5)) / n;
      const hm = h + (k * ds) / 2;
      x += Math.cos(hm) * ds;
      y += Math.sin(hm) * ds;
      h += k * ds;
      s += ds;
    }
  }
  return { x, y, h, s, pts, labels };
}

export function buildTrack(segs: Segment[], opts: { defaultWidth: number; step?: number }): BuiltTrack {
  const step = opts.step ?? 5;
  const end = (a: number, b: number) => {
    const r = integrate(pieces(segs, opts.defaultWidth, { a, b }), step);
    return [r.x, r.y] as const;
  };
  // Newton on the two adjustable lengths (end position is affine in them, so 2 iterations suffice).
  let a = 0;
  let b = 0;
  for (let it = 0; it < 4; it++) {
    const [x0, y0] = end(a, b);
    const [xa, ya] = end(a + 1, b);
    const [xb, yb] = end(a, b + 1);
    const j11 = xa - x0;
    const j21 = ya - y0;
    const j12 = xb - x0;
    const j22 = yb - y0;
    const det = j11 * j22 - j12 * j21;
    if (Math.abs(det) < 1e-9) throw new Error("adjustable straights must not be parallel");
    a += (-x0 * j22 + y0 * j12) / det;
    b += (x0 * j21 - y0 * j11) / det;
  }
  const r = integrate(pieces(segs, opts.defaultWidth, { a, b }), step);
  for (const s of segs) {
    if (s.kind === "straight" && s.adjust && s.length + (s.adjust === "a" ? a : b) < 10)
      throw new Error(`closure made straight '${s.label ?? s.adjust}' too short`);
  }
  // drop a trailing point that duplicates the start
  const last = r.pts[r.pts.length - 1]!;
  if (Math.hypot(last[0], last[1]) < step / 2) r.pts.pop();
  return {
    points: r.pts.map(([x, y, wr, wl]) => [round(x), round(y), wr, wl]),
    labels: r.labels,
    length: r.s,
    closureError: Math.hypot(r.x, r.y) + Math.abs(Math.atan2(Math.sin(r.h), Math.cos(r.h))),
  };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function trackFileFromBuilt(
  built: BuiltTrack,
  meta: {
    id: string;
    name: string;
    version: number;
    sectors: [number, number];
    runoff: TrackFile["runoff"];
  },
): TrackFile {
  return {
    id: meta.id,
    name: meta.name,
    version: meta.version,
    closed: true,
    points: built.points,
    sectors: meta.sectors,
    runoff: meta.runoff,
    license: "CC0-1.0 (handmade for this project)",
  };
}

export type { RunoffZone };
