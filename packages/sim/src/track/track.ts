import { Hasher, stableStringify, wrapAngle, wrapS } from "../math.js";
import type { SurfaceOrBarrier, TrackFile, TrackInfo, TrackSample } from "../types.js";
import { API_VERSION } from "../version.js";
import { PeriodicSpline } from "./spline.js";

export const KERB_WIDTH = 1.2;
export const KERB_CURVATURE = 1 / 250;
const KERB_DILATE_M = 12;
const MIN_RUNOFF = 3;
const RUNOFF_TYPES = ["grass", "gravel"] as const;
export type RunoffType = (typeof RUNOFF_TYPES)[number];

/** Processed track, serializable. Embedded in replays so the viewer never re-runs preprocessing. */
export interface TrackData {
  id: string;
  name: string;
  version: number;
  hash: string;
  length: number;
  spacing: number;
  sectors: [number, number];
  x: number[];
  y: number[];
  heading: number[];
  curvature: number[];
  widthLeft: number[];
  widthRight: number[];
  kerbLeft: number[];
  kerbRight: number[];
  /** 0 = grass, 1 = gravel */
  runoffTypeLeft: number[];
  runoffTypeRight: number[];
  /** Distance from the track edge to the barrier. */
  runoffWidthLeft: number[];
  runoffWidthRight: number[];
}

export interface Projection {
  /** Segment index (sample i to i+1). */
  index: number;
  s: number;
  n: number;
  heading: number;
  curvature: number;
  widthLeft: number;
  widthRight: number;
}

export class Track {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly hash: string;
  readonly length: number;
  readonly spacing: number;
  readonly count: number;
  readonly sectors: [number, number];
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly heading: Float64Array;
  readonly curvature: Float64Array;
  readonly widthLeft: Float64Array;
  readonly widthRight: Float64Array;
  readonly kerbLeft: Uint8Array;
  readonly kerbRight: Uint8Array;
  readonly runoffTypeLeft: Uint8Array;
  readonly runoffTypeRight: Uint8Array;
  readonly runoffWidthLeft: Float64Array;
  readonly runoffWidthRight: Float64Array;
  // unit segment direction per sample i -> i+1
  private readonly segDx: Float64Array;
  private readonly segDy: Float64Array;
  private readonly segLen: Float64Array;

  private constructor(d: TrackData) {
    this.id = d.id;
    this.name = d.name;
    this.version = d.version;
    this.hash = d.hash;
    this.length = d.length;
    this.spacing = d.spacing;
    this.count = d.x.length;
    this.sectors = d.sectors;
    this.x = Float64Array.from(d.x);
    this.y = Float64Array.from(d.y);
    this.heading = Float64Array.from(d.heading);
    this.curvature = Float64Array.from(d.curvature);
    this.widthLeft = Float64Array.from(d.widthLeft);
    this.widthRight = Float64Array.from(d.widthRight);
    this.kerbLeft = Uint8Array.from(d.kerbLeft);
    this.kerbRight = Uint8Array.from(d.kerbRight);
    this.runoffTypeLeft = Uint8Array.from(d.runoffTypeLeft);
    this.runoffTypeRight = Uint8Array.from(d.runoffTypeRight);
    this.runoffWidthLeft = Float64Array.from(d.runoffWidthLeft);
    this.runoffWidthRight = Float64Array.from(d.runoffWidthRight);
    const n = this.count;
    this.segDx = new Float64Array(n);
    this.segDy = new Float64Array(n);
    this.segLen = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = this.x[j]! - this.x[i]!;
      const dy = this.y[j]! - this.y[i]!;
      const l = Math.hypot(dx, dy);
      this.segLen[i] = l;
      this.segDx[i] = dx / l;
      this.segDy[i] = dy / l;
    }
  }

  static fromData(d: TrackData): Track {
    return new Track(d);
  }

  static fromFile(file: TrackFile, opts: { spacing?: number } = {}): Track {
    return new Track(processTrackFile(file, opts.spacing ?? 2));
  }

  toData(): TrackData {
    const r = (a: ArrayLike<number>, k: number) => Array.from(a, (v) => Math.round(v * k) / k);
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      hash: this.hash,
      length: this.length,
      spacing: this.spacing,
      sectors: this.sectors,
      x: r(this.x, 1e4),
      y: r(this.y, 1e4),
      heading: r(this.heading, 1e7),
      curvature: r(this.curvature, 1e8),
      widthLeft: r(this.widthLeft, 1e4),
      widthRight: r(this.widthRight, 1e4),
      kerbLeft: Array.from(this.kerbLeft),
      kerbRight: Array.from(this.kerbRight),
      runoffTypeLeft: Array.from(this.runoffTypeLeft),
      runoffTypeRight: Array.from(this.runoffTypeRight),
      runoffWidthLeft: r(this.runoffWidthLeft, 1e3),
      runoffWidthRight: r(this.runoffWidthRight, 1e3),
    };
  }

  toInfo(): TrackInfo {
    const samples: TrackSample[] = [];
    for (let i = 0; i < this.count; i++) {
      samples.push({
        s: i * this.spacing,
        x: this.x[i]!,
        y: this.y[i]!,
        heading: this.heading[i]!,
        curvature: this.curvature[i]!,
        widthLeft: this.widthLeft[i]!,
        widthRight: this.widthRight[i]!,
      });
    }
    return {
      apiVersion: API_VERSION,
      id: this.id,
      length: this.length,
      sampleSpacing: this.spacing,
      samples,
      sectors: [...this.sectors],
    };
  }

  indexAt(s: number): number {
    return Math.floor(wrapS(s, this.length) / this.spacing) % this.count;
  }

  private projectOnSegment(i: number, px: number, py: number): { d2: number; t: number } {
    const ax = this.x[i]!;
    const ay = this.y[i]!;
    const l = this.segLen[i]!;
    let t = ((px - ax) * this.segDx[i]! + (py - ay) * this.segDy[i]!) / l;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const qx = ax + this.segDx[i]! * l * t - px;
    const qy = ay + this.segDy[i]! * l * t - py;
    return { d2: qx * qx + qy * qy, t };
  }

  /**
   * Project a world point to Frenet coordinates. With a hint (previous segment index) the search is
   * local, so a car never snaps onto a nearby parallel section of track.
   */
  project(px: number, py: number, hint?: number): Projection {
    const n = this.count;
    let best = 0;
    let bestD2 = Number.POSITIVE_INFINITY;
    let bestT = 0;
    if (hint === undefined) {
      for (let i = 0; i < n; i++) {
        const r = this.projectOnSegment(i, px, py);
        if (r.d2 < bestD2) {
          bestD2 = r.d2;
          best = i;
          bestT = r.t;
        }
      }
    } else {
      const K = 6;
      let lo = hint - K;
      let hi = hint + K;
      for (let iter = 0; iter < 8; iter++) {
        bestD2 = Number.POSITIVE_INFINITY;
        for (let k = lo; k <= hi; k++) {
          const i = ((k % n) + n) % n;
          const r = this.projectOnSegment(i, px, py);
          if (r.d2 < bestD2) {
            bestD2 = r.d2;
            best = k;
            bestT = r.t;
          }
        }
        if (best === lo && bestT === 0) {
          lo -= K;
          hi -= K;
        } else if (best === hi && bestT === 1) {
          lo += K;
          hi += K;
        } else break;
      }
      best = ((best % n) + n) % n;
    }
    return this.frenetAt(best, bestT, px, py);
  }

  private frenetAt(i: number, t: number, px: number, py: number): Projection {
    const j = (i + 1) % this.count;
    const l = this.segLen[i]!;
    const qx = this.x[i]! + this.segDx[i]! * l * t;
    const qy = this.y[i]! + this.segDy[i]! * l * t;
    const nSigned = (px - qx) * -this.segDy[i]! + (py - qy) * this.segDx[i]!;
    const h0 = this.heading[i]!;
    return {
      index: i,
      s: wrapS((i + t) * this.spacing, this.length),
      n: nSigned,
      heading: wrapAngle(h0 + wrapAngle(this.heading[j]! - h0) * t),
      curvature: this.curvature[i]! + (this.curvature[j]! - this.curvature[i]!) * t,
      widthLeft: this.widthLeft[i]! + (this.widthLeft[j]! - this.widthLeft[i]!) * t,
      widthRight: this.widthRight[i]! + (this.widthRight[j]! - this.widthRight[i]!) * t,
    };
  }

  /** World position of a Frenet point (s, n). */
  toWorld(s: number, n: number): { x: number; y: number; heading: number } {
    const u = wrapS(s, this.length) / this.spacing;
    const i = Math.floor(u) % this.count;
    const t = u - Math.floor(u);
    const l = this.segLen[i]!;
    const qx = this.x[i]! + this.segDx[i]! * l * t;
    const qy = this.y[i]! + this.segDy[i]! * l * t;
    const j = (i + 1) % this.count;
    const h = this.heading[i]! + wrapAngle(this.heading[j]! - this.heading[i]!) * t;
    return { x: qx - this.segDy[i]! * n, y: qy + this.segDx[i]! * n, heading: wrapAngle(h) };
  }

  surfaceAt(index: number, n: number, wl: number, wr: number): SurfaceOrBarrier {
    const left = n >= 0;
    const over = left ? n - wl : -n - wr;
    if (over <= 0) return "track";
    const kerb = left ? this.kerbLeft[index] : this.kerbRight[index];
    if (kerb && over <= KERB_WIDTH) return "kerb";
    const width = left ? this.runoffWidthLeft[index]! : this.runoffWidthRight[index]!;
    if (over <= width)
      return RUNOFF_TYPES[left ? this.runoffTypeLeft[index]! : this.runoffTypeRight[index]!]!;
    return "barrier";
  }

  /** Lateral offset of the barrier on the given side (positive distance from the centerline). */
  barrierOffset(index: number, left: boolean): number {
    return left
      ? this.widthLeft[index]! + this.runoffWidthLeft[index]!
      : this.widthRight[index]! + this.runoffWidthRight[index]!;
  }

  sectorOf(s: number): number {
    return s < this.sectors[0] ? 1 : s < this.sectors[1] ? 2 : 3;
  }
}

export function trackFileHash(file: TrackFile): string {
  return new Hasher().string(stableStringify(file)).digest();
}

function processTrackFile(file: TrackFile, spacing: number): TrackData {
  let pts = file.points.map((p) => [...p] as [number, number, number, number]);
  if (file.reverse) pts = pts.reverse().map(([x, y, wr, wl]) => [x, y, wl, wr]);
  const spline = new PeriodicSpline(
    pts.map((p) => p[0]),
    pts.map((p) => p[1]),
  );

  // Dense arc-length table.
  const dense = Math.max(4000, Math.ceil(spline.period / 0.2));
  const du = spline.period / dense;
  const cum = new Float64Array(dense + 1);
  let prev = spline.eval(0);
  for (let k = 1; k <= dense; k++) {
    const p = spline.eval(k * du);
    cum[k] = cum[k - 1]! + Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  const length = cum[dense]!;
  const count = Math.round(length / spacing);
  const ds = length / count;

  const x: number[] = [];
  const y: number[] = [];
  const heading: number[] = [];
  const curvature: number[] = [];
  const widthLeft: number[] = [];
  const widthRight: number[] = [];
  let k = 0;
  for (let i = 0; i < count; i++) {
    const s = i * ds;
    while (k < dense - 1 && cum[k + 1]! < s) k++;
    const f = (s - cum[k]!) / (cum[k + 1]! - cum[k]!);
    const e = spline.eval((k + f) * du);
    x.push(e.x);
    y.push(e.y);
    heading.push(Math.atan2(e.dy, e.dx));
    const sp2 = e.dx * e.dx + e.dy * e.dy;
    curvature.push((e.dx * e.ddy - e.dy * e.ddx) / (sp2 * Math.sqrt(sp2)));
    const a = pts[e.seg]!;
    const b = pts[(e.seg + 1) % pts.length]!;
    widthRight.push(a[2] + (b[2] - a[2]) * e.f);
    widthLeft.push(a[3] + (b[3] - a[3]) * e.f);
  }

  // Kerbs on the inside of corners above a curvature threshold, dilated along s.
  const kerbLeft = new Array<number>(count).fill(0);
  const kerbRight = new Array<number>(count).fill(0);
  const dil = Math.round(KERB_DILATE_M / ds);
  for (let i = 0; i < count; i++) {
    const c = curvature[i]!;
    if (Math.abs(c) < KERB_CURVATURE) continue;
    const arr = c > 0 ? kerbLeft : kerbRight;
    for (let d = -dil; d <= dil; d++) arr[(((i + d) % count) + count) % count] = 1;
  }

  // Runoff from the default and zones.
  const typeCode = (t: RunoffType) => RUNOFF_TYPES.indexOf(t);
  const runoffTypeLeft = new Array<number>(count).fill(typeCode(file.runoff.default.type));
  const runoffTypeRight = [...runoffTypeLeft];
  const runoffWidthLeft = new Array<number>(count).fill(file.runoff.default.width);
  const runoffWidthRight = [...runoffWidthLeft];
  for (const z of file.runoff.zones ?? []) {
    for (let i = 0; i < count; i++) {
      const f = (i * ds) / length;
      const inside = z.from <= z.to ? f >= z.from && f <= z.to : f >= z.from || f <= z.to;
      if (!inside) continue;
      if (z.side !== "right") {
        runoffTypeLeft[i] = typeCode(z.type);
        runoffWidthLeft[i] = z.width;
      }
      if (z.side !== "left") {
        runoffTypeRight[i] = typeCode(z.type);
        runoffWidthRight[i] = z.width;
      }
    }
  }
  clipRunoffByProximity(x, y, heading, widthLeft, widthRight, runoffWidthLeft, runoffWidthRight, ds);

  const s1 = file.sectors[0] * length;
  const s2 = file.sectors[1] * length;
  return {
    id: file.id,
    name: file.name,
    version: file.version,
    hash: trackFileHash(file),
    length,
    spacing: ds,
    sectors: [s1, s2],
    x,
    y,
    heading,
    curvature,
    widthLeft,
    widthRight,
    kerbLeft,
    kerbRight,
    runoffTypeLeft,
    runoffTypeRight,
    runoffWidthLeft,
    runoffWidthRight,
  };
}

/**
 * Where another part of the circuit runs close by, put the barrier halfway between the two track
 * edges so runoff areas never overlap a neighbouring section.
 */
function clipRunoffByProximity(
  x: number[],
  y: number[],
  heading: number[],
  wl: number[],
  wr: number[],
  rl: number[],
  rr: number[],
  ds: number,
): void {
  const n = x.length;
  const minSep = Math.round(150 / ds);
  const maxReach = Math.max(...rl, ...rr) + Math.max(...wl, ...wr) * 2 + 5;
  const cell = maxReach;
  const grid = new Map<string, number[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  for (let j = 0; j < n; j++) {
    const k = key(Math.floor(x[j]! / cell), Math.floor(y[j]! / cell));
    const b = grid.get(k);
    if (b) b.push(j);
    else grid.set(k, [j]);
  }
  const newL = [...rl];
  const newR = [...rr];
  for (let i = 0; i < n; i++) {
    const tx = Math.cos(heading[i]!);
    const ty = Math.sin(heading[i]!);
    const cx = Math.floor(x[i]! / cell);
    const cy = Math.floor(y[i]! / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(key(gx, gy)) ?? []) {
          let sep = Math.abs(i - j);
          sep = Math.min(sep, n - sep);
          if (sep < minSep) continue;
          const dx = x[j]! - x[i]!;
          const dy = y[j]! - y[i]!;
          const along = dx * tx + dy * ty;
          if (Math.abs(along) > 6) continue;
          const lat = -dx * ty + dy * tx;
          // the other section's edge facing us: approximate with its larger half-width
          const otherW = Math.max(wl[j]!, wr[j]!);
          if (lat > 0) {
            const gap = lat - otherW - wl[i]!;
            newL[i] = Math.min(newL[i]!, Math.max(MIN_RUNOFF, gap / 2));
          } else {
            const gap = -lat - otherW - wr[i]!;
            newR[i] = Math.min(newR[i]!, Math.max(MIN_RUNOFF, gap / 2));
          }
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    rl[i] = newL[i]!;
    rr[i] = newR[i]!;
  }
}
