import { Prng, type TrackData, wrapS } from "@bench/sim";
import { linearRgb, type RGB } from "./color.js";

export const KERB_WIDTH = 1.2;
export const LINE_WIDTH = 0.3;

/** Processed track edges, offsets measured from the centerline along the left normal (right is negative side). */
export interface TrackLayout {
  n: number;
  length: number;
  spacing: number;
  cx: Float64Array;
  cy: Float64Array;
  /** Left normal. */
  nx: Float64Array;
  ny: Float64Array;
  heading: Float64Array;
  wl: Float64Array;
  wr: Float64Array;
  kerbL: Uint8Array;
  kerbR: Uint8Array;
  typeL: Uint8Array;
  typeR: Uint8Array;
  /** Barrier distance from the centerline, clamped so runoffs never fold or overlap other track. */
  barrierL: Float64Array;
  barrierR: Float64Array;
}

const loopIdx = (i: number, n: number) => ((i % n) + n) % n;

function boxSmooth(v: Float64Array, radius: number): Float64Array {
  const n = v.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += v[loopIdx(i + k, n)]!;
    out[i] = sum / (2 * radius + 1);
  }
  return out;
}

function minFilter(v: Float64Array, radius: number): Float64Array {
  const n = v.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = Number.POSITIVE_INFINITY;
    for (let k = -radius; k <= radius; k++) m = Math.min(m, v[loopIdx(i + k, n)]!);
    out[i] = m;
  }
  return out;
}

/**
 * Largest offset on one side of each sample that stays clear of the rest of the track:
 * under 0.9 of the turn radius on the inside of a corner, and short of halfway to any
 * other part of the circuit lying in that direction.
 */
export function clearance(track: TrackData, side: 1 | -1, localWindow = 30): Float64Array {
  const n = track.x.length;
  const out = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const skip = Math.ceil(localWindow / track.spacing);
  for (let i = 0; i < n; i++) {
    const h = track.heading[i]!;
    const dx = -Math.sin(h) * side;
    const dy = Math.cos(h) * side;
    const k = track.curvature[i]! * side;
    let lim = k > 1e-6 ? 0.9 / k : Number.POSITIVE_INFINITY;
    const xi = track.x[i]!;
    const yi = track.y[i]!;
    for (let j = 0; j < n; j++) {
      let d = Math.abs(i - j);
      d = Math.min(d, n - d);
      if (d <= skip) continue;
      const vx = track.x[j]! - xi;
      const vy = track.y[j]! - yi;
      const along = vx * dx + vy * dy;
      if (along <= 0 || along / 2 >= lim) continue;
      const perp = Math.abs(vx * dy - vy * dx);
      if (perp > along) continue;
      lim = along / 2 - 0.5;
    }
    out[i] = lim;
  }
  return out;
}

export function buildLayout(track: TrackData): TrackLayout {
  const n = track.x.length;
  const cx = Float64Array.from(track.x);
  const cy = Float64Array.from(track.y);
  const heading = Float64Array.from(track.heading);
  const nx = heading.map((h) => -Math.sin(h));
  const ny = heading.map((h) => Math.cos(h));
  const wl = Float64Array.from(track.widthLeft);
  const wr = Float64Array.from(track.widthRight);
  const kerbL = Uint8Array.from(track.kerbLeft);
  const kerbR = Uint8Array.from(track.kerbRight);
  const typeL = Uint8Array.from(track.runoffTypeLeft);
  const typeR = Uint8Array.from(track.runoffTypeRight);
  const smoothR = Math.max(1, Math.round(10 / track.spacing));
  const barrier = (w: Float64Array, kerb: Uint8Array, run: number[], side: 1 | -1) => {
    const desired = boxSmooth(
      Float64Array.from(run, (r, i) => w[i]! + Math.max(r, 0)),
      smoothR,
    );
    const lim = clearance(track, side);
    const raw = desired.map((d, i) => Math.min(d, lim[i]!));
    const smooth = boxSmooth(minFilter(raw, smoothR), smoothR);
    return smooth.map((b, i) => Math.max(b, w[i]! + (kerb[i] ? KERB_WIDTH : 0) + 0.8));
  };
  return {
    n,
    length: track.length,
    spacing: track.spacing,
    cx,
    cy,
    nx,
    ny,
    heading,
    wl,
    wr,
    kerbL,
    kerbR,
    typeL,
    typeR,
    barrierL: barrier(wl, kerbL, track.runoffWidthLeft, 1),
    barrierR: barrier(wr, kerbR, track.runoffWidthRight, -1),
  };
}

export interface TrackPoint {
  x: number;
  y: number;
  heading: number;
  nx: number;
  ny: number;
  wl: number;
  wr: number;
  barrierL: number;
  barrierR: number;
}

/** Interpolated centerline frame at distance s. */
export function pointAt(L: TrackLayout, s: number): TrackPoint {
  const u = wrapS(s, L.length) / L.spacing;
  const i = Math.floor(u) % L.n;
  const j = (i + 1) % L.n;
  const a = u - Math.floor(u);
  const lp = (arr: Float64Array) => arr[i]! + (arr[j]! - arr[i]!) * a;
  let dh = L.heading[j]! - L.heading[i]!;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  const heading = L.heading[i]! + dh * a;
  return {
    x: lp(L.cx),
    y: lp(L.cy),
    heading,
    nx: -Math.sin(heading),
    ny: Math.cos(heading),
    wl: lp(L.wl),
    wr: lp(L.wr),
    barrierL: lp(L.barrierL),
    barrierR: lp(L.barrierR),
  };
}

/** Triangle soup in three.js coordinates (sim x, h, -y), non-indexed, with linear vertex colors. */
export class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];

  /** Quad a-b-c-d given in sim coords (x, y, h), counter-clockwise seen from the normal side. */
  quad(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    color: RGB,
    normal: [number, number, number] = [0, 1, 0],
  ): void {
    for (const p of [a, b, c, a, c, d]) {
      this.positions.push(p[0], p[2], -p[1]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(color[0], color[1], color[2]);
    }
  }

  /**
   * Oriented box in sim coords: centre (x, y), base at height z0, heading rotates its local x.
   * Size lx (along heading) by ly by lz (up). `top` overrides the color of the upper face.
   */
  box(
    x: number,
    y: number,
    z0: number,
    heading: number,
    lx: number,
    ly: number,
    lz: number,
    color: RGB,
    top?: RGB,
  ): void {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const P = (u: number, v: number, w: number): [number, number, number] => [
      x + c * u * lx * 0.5 - s * v * ly * 0.5,
      y + s * u * lx * 0.5 + c * v * ly * 0.5,
      z0 + w * lz,
    ];
    const N = (u: number, v: number, w: number): [number, number, number] => [
      c * u - s * v,
      w,
      -(s * u + c * v),
    ];
    this.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), top ?? color, N(0, 0, 1));
    this.quad(P(-1, 1, 0), P(1, 1, 0), P(1, -1, 0), P(-1, -1, 0), color, N(0, 0, -1));
    this.quad(P(1, -1, 0), P(1, 1, 0), P(1, 1, 1), P(1, -1, 1), color, N(1, 0, 0));
    this.quad(P(-1, 1, 0), P(-1, -1, 0), P(-1, -1, 1), P(-1, 1, 1), color, N(-1, 0, 0));
    this.quad(P(1, 1, 0), P(-1, 1, 0), P(-1, 1, 1), P(1, 1, 1), color, N(0, 1, 0));
    this.quad(P(-1, -1, 0), P(1, -1, 0), P(1, -1, 1), P(-1, -1, 1), color, N(0, -1, 0));
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  toArrays(): { positions: Float32Array; normals: Float32Array; colors: Float32Array } {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
    };
  }
}

export const PALETTE = {
  asphalt: "#4a4d54",
  line: "#f2f2ee",
  kerbRed: "#d42a2a",
  kerbWhite: "#f4f4f0",
  grassA: "#5f9a3a",
  grassB: "#68a542",
  gravel: "#d8c49a",
  barrierA: "#f0f0ea",
  barrierB: "#2c5a8c",
  barrierTop: "#bfc4cc",
  checkerDark: "#1d1d1f",
  sector: "#f5c400",
};

function jitter(rgb: RGB, f: number): RGB {
  return [rgb[0] * f, rgb[1] * f, rgb[2] * f];
}

const H_RUNOFF = 0.0;
const H_ASPHALT = 0.03;
const H_LINE = 0.05;
const H_KERB = 0.07;

/** Asphalt, white lines, kerbs and runoff for the whole lap, as one mesh. */
export function buildSurface(L: TrackLayout, seed = 1): MeshBuilder {
  const m = new MeshBuilder();
  const rnd = new Prng(seed);
  const c = {
    asphalt: linearRgb(PALETTE.asphalt),
    line: linearRgb(PALETTE.line),
    red: linearRgb(PALETTE.kerbRed),
    white: linearRgb(PALETTE.kerbWhite),
    grassA: linearRgb(PALETTE.grassA),
    grassB: linearRgb(PALETTE.grassB),
    gravel: linearRgb(PALETTE.gravel),
  };
  const P = (i: number, off: number, h: number): [number, number, number] => [
    L.cx[i]! + L.nx[i]! * off,
    L.cy[i]! + L.ny[i]! * off,
    h,
  ];
  /** Band between two offsets on the same side, from sample i to j. */
  const band = (
    i: number,
    j: number,
    o1i: number,
    o2i: number,
    o1j: number,
    o2j: number,
    h: number,
    col: RGB,
  ) => {
    const [a, b] = o1i < o2i ? [o1i, o2i] : [o2i, o1i];
    const [aj, bj] = o1j < o2j ? [o1j, o2j] : [o2j, o1j];
    m.quad(P(i, a, h), P(j, aj, h), P(j, bj, h), P(i, b, h), col);
  };
  for (let i = 0; i < L.n; i++) {
    const j = (i + 1) % L.n;
    const stripe = Math.floor(i / 6) % 2 === 0;
    band(
      i,
      j,
      -L.wr[i]! + LINE_WIDTH,
      L.wl[i]! - LINE_WIDTH,
      -L.wr[j]! + LINE_WIDTH,
      L.wl[j]! - LINE_WIDTH,
      H_ASPHALT,
      jitter(c.asphalt, 0.95 + rnd.next() * 0.1),
    );
    for (const side of [1, -1] as const) {
      const w = side > 0 ? L.wl : L.wr;
      const kerb = side > 0 ? L.kerbL : L.kerbR;
      const type = side > 0 ? L.typeL : L.typeR;
      const bar = side > 0 ? L.barrierL : L.barrierR;
      const s = side;
      band(i, j, s * (w[i]! - LINE_WIDTH), s * w[i]!, s * (w[j]! - LINE_WIDTH), s * w[j]!, H_LINE, c.line);
      let start = w[i]!;
      let startJ = w[j]!;
      if (kerb[i]) {
        band(
          i,
          j,
          s * w[i]!,
          s * (w[i]! + KERB_WIDTH),
          s * w[j]!,
          s * (w[j]! + KERB_WIDTH),
          H_KERB,
          i % 2 === 0 ? c.red : c.white,
        );
        start += KERB_WIDTH;
        startJ += KERB_WIDTH;
      }
      const runCol =
        type[i] === 1 ? jitter(c.gravel, 0.92 + rnd.next() * 0.12) : stripe ? c.grassA : c.grassB;
      band(i, j, s * start, s * bar[i]!, s * startJ, s * bar[j]!, H_RUNOFF, runCol);
    }
  }
  return m;
}

export const BARRIER_HEIGHT = 1.1;

/** Barrier walls along both runoff edges, panels alternating colors, plus a top cap. */
export function buildBarriers(L: TrackLayout): MeshBuilder {
  const m = new MeshBuilder();
  const A = linearRgb(PALETTE.barrierA);
  const B = linearRgb(PALETTE.barrierB);
  const top = linearRgb(PALETTE.barrierTop);
  const H = BARRIER_HEIGHT;
  const T = 0.4;
  for (let i = 0; i < L.n; i++) {
    const j = (i + 1) % L.n;
    const col = Math.floor(i / 3) % 2 === 0 ? A : B;
    for (const side of [1, -1] as const) {
      const bar = side > 0 ? L.barrierL : L.barrierR;
      const P = (k: number, off: number, h: number): [number, number, number] => [
        L.cx[k]! + L.nx[k]! * off * side,
        L.cy[k]! + L.ny[k]! * off * side,
        h,
      ];
      const nrm: [number, number, number] = [-L.nx[i]! * side, 0, L.ny[i]! * side];
      const bi = bar[i]!;
      const bj = bar[j]!;
      if (side > 0) m.quad(P(i, bi, 0), P(j, bj, 0), P(j, bj, H), P(i, bi, H), col, nrm);
      else m.quad(P(j, bj, 0), P(i, bi, 0), P(i, bi, H), P(j, bj, H), col, nrm);
      if (side > 0) m.quad(P(i, bi, H), P(j, bj, H), P(j, bj + T, H), P(i, bi + T, H), top);
      else m.quad(P(j, bj, H), P(i, bi, H), P(i, bi + T, H), P(j, bj + T, H), top);
    }
  }
  return m;
}

/** Checkered start/finish band at s = 0, plus thin sector lines across the asphalt. */
export function buildLines(L: TrackLayout, sectors: number[]): MeshBuilder {
  const m = new MeshBuilder();
  const dark = linearRgb(PALETTE.checkerDark);
  const white = linearRgb(PALETTE.kerbWhite);
  const yellow = linearRgb(PALETTE.sector);
  const h = H_LINE + 0.005;
  const across = (
    s: number,
    len: number,
    rows: number,
    cols: number,
    colorAt: (r: number, c: number) => RGB,
  ) => {
    const p = pointAt(L, s);
    const tx = Math.cos(p.heading);
    const ty = Math.sin(p.heading);
    const w0 = -p.wr;
    const w1 = p.wl;
    for (let r = 0; r < rows; r++) {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const a0 = -len / 2 + (r * len) / rows;
        const a1 = a0 + len / rows;
        const b0 = w0 + ((w1 - w0) * cIdx) / cols;
        const b1 = w0 + ((w1 - w0) * (cIdx + 1)) / cols;
        const pt = (a: number, b: number): [number, number, number] => [
          p.x + tx * a + p.nx * b,
          p.y + ty * a + p.ny * b,
          h,
        ];
        m.quad(pt(a0, b0), pt(a1, b0), pt(a1, b1), pt(a0, b1), colorAt(r, cIdx));
      }
    }
  };
  across(0, 1.8, 3, 16, (r, cc) => ((r + cc) % 2 === 0 ? dark : white));
  for (const s of sectors) across(s, 0.35, 1, 1, () => yellow);
  return m;
}

export interface Placement {
  x: number;
  y: number;
  heading: number;
  scale: number;
  variant: number;
}

/** Uniform grid over centerline samples, to test "is this point clear of the circuit" quickly. */
export class TrackProximity {
  private readonly cells = new Map<string, number[]>();
  private readonly reach: Float64Array;
  constructor(
    private readonly L: TrackLayout,
    private readonly cell = 40,
  ) {
    this.reach = L.barrierL.map((b, i) => Math.max(b, L.barrierR[i]!));
    for (let i = 0; i < L.n; i++) {
      const key = this.key(L.cx[i]!, L.cy[i]!);
      const arr = this.cells.get(key);
      if (arr) arr.push(i);
      else this.cells.set(key, [i]);
    }
  }
  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }
  /** Distance from (x, y) to the nearest barrier-side boundary (negative means inside the circuit area). */
  clearanceAt(x: number, y: number, searchRadius = 120): number {
    const r = Math.ceil(searchRadius / this.cell);
    const cxI = Math.floor(x / this.cell);
    const cyI = Math.floor(y / this.cell);
    let best = Number.POSITIVE_INFINITY;
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        const arr = this.cells.get(`${cxI + a},${cyI + b}`);
        if (!arr) continue;
        for (const i of arr) {
          const d = Math.hypot(x - this.L.cx[i]!, y - this.L.cy[i]!) - this.reach[i]!;
          if (d < best) best = d;
        }
      }
    }
    return best;
  }
}

/** Straights long enough for a grandstand: runs of low curvature, returned as their middle sample. */
export function findStraights(
  track: TrackData,
  minLength = 120,
  maxCurv = 0.003,
): { mid: number; length: number }[] {
  const n = track.x.length;
  const straight = track.curvature.map((k) => Math.abs(k) < maxCurv);
  const start = straight.findIndex((v) => !v);
  if (start < 0) return [{ mid: 0, length: track.length }];
  const out: { mid: number; length: number }[] = [];
  let run = 0;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (straight[i]) run++;
    else {
      if (run * track.spacing >= minLength)
        out.push({ mid: (i - Math.ceil(run / 2) + n) % n, length: run * track.spacing });
      run = 0;
    }
  }
  return out.sort((a, b) => b.length - a.length);
}

export interface Grandstand extends Placement {
  length: number;
  depth: number;
}

/** Grandstands beside the start straight and the longest other straights, facing the track. */
export function placeGrandstands(L: TrackLayout, track: TrackData, max = 6): Grandstand[] {
  const prox = new TrackProximity(L);
  const straights = findStraights(track);
  const out: Grandstand[] = [];
  const depth = 14;
  const tryAt = (i: number, length: number) => {
    for (const side of [-1, 1] as const) {
      const bar = side > 0 ? L.barrierL[i]! : L.barrierR[i]!;
      const off = bar + 4 + depth / 2;
      const x = L.cx[i]! + L.nx[i]! * off * side;
      const y = L.cy[i]! + L.ny[i]! * off * side;
      const tx = Math.cos(L.heading[i]!);
      const ty = Math.sin(L.heading[i]!);
      const ok = [-0.5, 0, 0.5].every((f) =>
        [-depth / 2, depth / 2].every(
          (d) =>
            prox.clearanceAt(
              x + tx * f * length + L.nx[i]! * side * d,
              y + ty * f * length + L.ny[i]! * side * d,
            ) > 2,
        ),
      );
      const clash = out.some((g) => Math.hypot(g.x - x, g.y - y) < (g.length + length) / 2 + 10);
      if (ok && !clash) {
        out.push({
          x,
          y,
          heading: L.heading[i]! + (side > 0 ? 0 : Math.PI),
          scale: 1,
          variant: out.length % 3,
          length,
          depth,
        });
        return true;
      }
    }
    return false;
  };
  const startIdx = Math.round(40 / L.spacing) % L.n;
  tryAt(startIdx, 90);
  for (const st of straights) {
    if (out.length >= max) break;
    tryAt(st.mid, Math.min(80, st.length * 0.6));
  }
  return out;
}

/** Clustered trees outside the barriers, kept clear of the circuit and of grandstands. */
export function placeTrees(L: TrackLayout, count: number, seed = 7, avoid: Grandstand[] = []): Placement[] {
  const rnd = new Prng(seed);
  const prox = new TrackProximity(L);
  const out: Placement[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < L.n; i++) {
    minX = Math.min(minX, L.cx[i]!);
    maxX = Math.max(maxX, L.cx[i]!);
    minY = Math.min(minY, L.cy[i]!);
    maxY = Math.max(maxY, L.cy[i]!);
  }
  const margin = 260;
  const clusters: [number, number, number][] = [];
  for (let k = 0; k < Math.max(4, Math.round(count / 25)); k++) {
    clusters.push([
      minX - margin + rnd.next() * (maxX - minX + 2 * margin),
      minY - margin + rnd.next() * (maxY - minY + 2 * margin),
      25 + rnd.next() * 70,
    ]);
  }
  let attempts = 0;
  while (out.length < count && attempts < count * 30) {
    attempts++;
    let x: number;
    let y: number;
    if (rnd.next() < 0.7) {
      const c = clusters[Math.floor(rnd.next() * clusters.length)]!;
      const r = c[2] * Math.sqrt(rnd.next());
      const a = rnd.next() * Math.PI * 2;
      x = c[0] + Math.cos(a) * r;
      y = c[1] + Math.sin(a) * r;
    } else {
      const i = Math.floor(rnd.next() * L.n);
      const side = rnd.next() < 0.5 ? 1 : -1;
      const bar = side > 0 ? L.barrierL[i]! : L.barrierR[i]!;
      const d = bar + 8 + rnd.next() ** 1.5 * 140;
      x = L.cx[i]! + L.nx[i]! * d * side;
      y = L.cy[i]! + L.ny[i]! * d * side;
    }
    if (prox.clearanceAt(x, y) < 7) continue;
    if (avoid.some((g) => Math.hypot(g.x - x, g.y - y) < g.length / 2 + 12)) continue;
    out.push({
      x,
      y,
      heading: rnd.next() * Math.PI * 2,
      scale: 0.7 + rnd.next() * 0.8,
      variant: Math.floor(rnd.next() * 3),
    });
  }
  return out;
}

export function trackBounds(L: TrackLayout): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < L.n; i++) {
    const r = Math.max(L.barrierL[i]!, L.barrierR[i]!);
    minX = Math.min(minX, L.cx[i]! - r);
    maxX = Math.max(maxX, L.cx[i]! + r);
    minY = Math.min(minY, L.cy[i]! - r);
    maxY = Math.max(maxY, L.cy[i]! + r);
  }
  return { minX, maxX, minY, maxY };
}

const CROWD = [
  "#e63946",
  "#f1faee",
  "#a8dadc",
  "#457b9d",
  "#1d3557",
  "#f4a261",
  "#e9c46a",
  "#2a9d8f",
  "#ffffff",
  "#ffb703",
];

/**
 * Stepped grandstands with a crowd of colored blocks and a roof. Local frame per stand:
 * x along the track, -y faces the track, rows rise toward +y.
 */
export function buildGrandstands(stands: Grandstand[], seed = 3): MeshBuilder {
  const m = new MeshBuilder();
  const rnd = new Prng(seed);
  const concrete = linearRgb("#c9ccd2");
  const roof = linearRgb("#e8ebef");
  const steel = linearRgb("#6b7280");
  const crowd = CROWD.map((c) => linearRgb(c));
  for (const g of stands) {
    const c = Math.cos(g.heading);
    const s = Math.sin(g.heading);
    const at = (u: number, v: number): [number, number] => [g.x + c * u - s * v, g.y + s * u + c * v];
    const rows = 8;
    const rowDepth = g.depth / rows;
    for (let r = 0; r < rows; r++) {
      const v = -g.depth / 2 + rowDepth * (r + 0.5);
      const h = 0.6 + r * 0.75;
      const [bx, by] = at(0, v);
      m.box(bx, by, 0, g.heading, g.length, rowDepth, h, concrete);
      const chunks = Math.floor(g.length / 1.6);
      for (let k = 0; k < chunks; k++) {
        if (rnd.next() < 0.12) continue;
        const u = -g.length / 2 + (k + 0.5) * (g.length / chunks);
        const [px, py] = at(u, v - rowDepth * 0.1);
        m.box(
          px,
          py,
          h,
          g.heading,
          g.length / chunks - 0.25,
          rowDepth * 0.45,
          0.45 + rnd.next() * 0.2,
          crowd[Math.floor(rnd.next() * crowd.length)]!,
        );
      }
    }
    const roofH = 0.6 + rows * 0.75 + 3.2;
    for (const u of [-0.5, -0.17, 0.17, 0.5]) {
      const [px, py] = at(u * (g.length - 1), g.depth / 2 - 0.3);
      m.box(px, py, 0, g.heading, 0.4, 0.4, roofH, steel);
    }
    const [rx, ry] = at(0, 1);
    m.box(rx, ry, roofH, g.heading, g.length + 2, g.depth + 4, 0.35, roof);
    const [wx, wy] = at(0, g.depth / 2 + 0.2);
    m.box(wx, wy, 0, g.heading, g.length, 0.4, roofH, concrete);
  }
  return m;
}

/** Start/finish gantry spanning the track at s, with a light panel facing oncoming cars. */
export function buildGantry(L: TrackLayout, s = 0): MeshBuilder {
  const m = new MeshBuilder();
  const p = pointAt(L, s);
  const steel = linearRgb("#2b2f36");
  const panel = linearRgb("#15171b");
  const light = linearRgb("#ff2a2a", 3);
  const H = 6.5;
  const offL = p.wl + 2.2;
  const offR = p.wr + 2.2;
  for (const off of [offL, -offR]) {
    m.box(p.x + p.nx * off, p.y + p.ny * off, 0, p.heading, 0.8, 0.8, H + 1.6, steel);
  }
  const midOff = (offL - offR) / 2;
  const span = offL + offR;
  const mx = p.x + p.nx * midOff;
  const my = p.y + p.ny * midOff;
  m.box(mx, my, H, p.heading, 0.7, span, 0.5, steel);
  m.box(mx, my, H + 0.5, p.heading, 0.7, span, 1.1, panel);
  const back = -0.4;
  for (let k = 0; k < 5; k++) {
    const v = (k - 2) * 1.1;
    m.box(
      mx + Math.cos(p.heading) * back + p.nx * v,
      my + Math.sin(p.heading) * back + p.ny * v,
      H + 0.7,
      p.heading,
      0.1,
      0.6,
      0.6,
      light,
    );
  }
  return m;
}
