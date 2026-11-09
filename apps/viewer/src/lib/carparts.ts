/** Procedural car parts in car-local metres (x forward, y up, z right), as indexed triangle lists. */

export interface Solid {
  positions: number[];
  indices: number[];
}

export function signedVolume(s: { positions: ArrayLike<number>; indices: ArrayLike<number> }): number {
  const p = s.positions;
  let v = 0;
  for (let k = 0; k < s.indices.length; k += 3) {
    const a = s.indices[k]! * 3;
    const b = s.indices[k + 1]! * 3;
    const c = s.indices[k + 2]! * 3;
    v +=
      (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
        p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
        p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) /
      6;
  }
  return v;
}

/** Winds a closed solid outward, whichever way it was built. */
function outward(s: Solid): Solid {
  if (signedVolume(s) < 0)
    for (let k = 0; k < s.indices.length; k += 3) {
      const t = s.indices[k + 1]!;
      s.indices[k + 1] = s.indices[k + 2]!;
      s.indices[k + 2] = t;
    }
  return s;
}

/**
 * Turns a closed (z, r) profile around the z axis. Points on the axis (r = 0) close the solid
 * with a fan rather than degenerate quads. `phase` rotates the whole solid about the axis.
 */
export function lathe(profile: [number, number][], segments: number, phase = 0): Solid {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = profile.length;
  const ring = (i: number) => i * segments;
  for (const [z, r] of profile)
    for (let j = 0; j < segments; j++) {
      const a = phase + (2 * Math.PI * j) / segments;
      positions.push(r * Math.cos(a), r * Math.sin(a), z);
    }
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const onAxis = profile[i]![1] === 0;
    const nextOnAxis = profile[i2]![1] === 0;
    if (onAxis && nextOnAxis) continue;
    for (let j = 0; j < segments; j++) {
      const j2 = (j + 1) % segments;
      const a = ring(i) + j;
      const b = ring(i2) + j;
      const c = ring(i2) + j2;
      const d = ring(i) + j2;
      if (!nextOnAxis) indices.push(a, b, c);
      if (!onAxis) indices.push(a, c, d);
    }
  }
  return outward({ positions, indices });
}

/** Extrudes a star-shaped (x, y) polygon along z, from z0 to z1. */
export function prism(poly: [number, number][], z0: number, z1: number): Solid {
  const n = poly.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const cx = poly.reduce((s, p) => s + p[0], 0) / n;
  const cy = poly.reduce((s, p) => s + p[1], 0) / n;
  for (const z of [z0, z1]) {
    for (const [x, y] of poly) positions.push(x, y, z);
    positions.push(cx, cy, z);
  }
  const top = n + 1;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    indices.push(i, i2, top + i2, i, top + i2, top + i);
    indices.push(n, i2, i, top + n, top + i, top + i2);
  }
  return outward({ positions, indices });
}

export interface WheelSpec {
  radius: number;
  width: number;
  rimRadius: number;
  coverRadius: number;
}

export interface ColoredSolid extends Solid {
  color: string;
}

export const WHEEL_SEGMENTS = 24;

/**
 * A right-hand wheel centred on its axle (the z axis), the outer face towards +z: tyre with
 * rounded shoulders, rim lip, a flat wheel cover with a centre nut, and a few marks on the cover
 * so its rotation reads on screen. Every part is turned, so it spins true.
 */
export function buildWheel(w: WheelSpec): ColoredSolid[] {
  const h = w.width / 2;
  const R = w.radius;
  const rr = w.rimRadius;
  const s = Math.min(0.08 * R, h / 2);
  const tyre = lathe(
    [
      [-h, rr],
      [-h, R - s],
      [-h + 0.4 * s, R - 0.25 * s],
      [-h + s, R],
      [h - s, R],
      [h - 0.4 * s, R - 0.25 * s],
      [h, R - s],
      [h, rr],
    ],
    WHEEL_SEGMENTS,
  );
  const lipZ = h - 0.06 * w.width;
  const rim = lathe(
    [
      [-h + 0.05 * w.width, w.coverRadius],
      [-h + 0.05 * w.width, rr],
      [lipZ, rr],
      [lipZ, w.coverRadius],
    ],
    WHEEL_SEGMENTS,
  );
  const coverZ = lipZ - 0.06 * w.width;
  const cover = lathe(
    [
      [coverZ - 0.04 * w.width, 0],
      [coverZ - 0.04 * w.width, w.coverRadius],
      [coverZ, w.coverRadius],
      [coverZ, 0],
    ],
    WHEEL_SEGMENTS,
  );
  const nut = lathe(
    [
      [coverZ, 0],
      [coverZ, 0.13 * R],
      [coverZ + 0.05 * w.width, 0.11 * R],
      [coverZ + 0.05 * w.width, 0],
    ],
    6,
  );
  const marks: Solid = { positions: [], indices: [] };
  for (let k = 0; k < 5; k++) {
    const a = (2 * Math.PI * k) / 5;
    const bar = prism(
      [
        [0.28 * R, -0.035 * R],
        [0.58 * R, -0.035 * R],
        [0.58 * R, 0.035 * R],
        [0.28 * R, 0.035 * R],
      ],
      coverZ,
      coverZ + 0.012 * w.width,
    );
    const base = marks.positions.length / 3;
    for (let i = 0; i < bar.positions.length; i += 3) {
      const x = bar.positions[i]!;
      const y = bar.positions[i + 1]!;
      marks.positions.push(
        x * Math.cos(a) - y * Math.sin(a),
        x * Math.sin(a) + y * Math.cos(a),
        bar.positions[i + 2]!,
      );
    }
    for (const i of bar.indices) marks.indices.push(base + i);
  }
  return [
    { ...tyre, color: "#151515" },
    { ...rim, color: "#9aa0a8" },
    { ...cover, color: "#2c2f34" },
    { ...nut, color: "#c9cdd3" },
    { ...marks, color: "#6b7079" },
  ];
}

/** One rear-wing element: a thin cambered section, leading edge at (u, y), angled up towards the rear. */
function element(u: number, y: number, chord: number, angle: number, thick: number): [number, number][] {
  const upper: [number, number][] = [];
  const lower: [number, number][] = [];
  for (const [t, half] of [
    [0, 0],
    [0.08, 0.4],
    [0.35, 0.5],
    [0.75, 0.3],
    [1, 0.06],
  ] as const) {
    const camber = -0.04 * chord * Math.sin(Math.PI * t);
    upper.push([t * chord, camber + half * thick * chord]);
    if (t > 0) lower.push([t * chord, camber - half * thick * chord]);
  }
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  return [...upper, ...lower.reverse()].map(([a, b]) => [u + a * ca - b * sa, y + a * sa + b * ca]);
}

export interface RearWing {
  /** Painted with the body: the two flaps. */
  painted: Solid[];
  /** In the entry colour: the two endplates. */
  endplates: Solid[];
  /** Carbon: the mainplane and the two pylons. */
  carbon: Solid[];
}

/**
 * A 2026-style rear wing (no beam wing, three elements, plain endplates rolled over at the top,
 * two pylons into the underside of the mainplane). Built in a 3.4 m-wheelbase car's metres,
 * then scaled by `scale` lengthwise and by `lift` in height, and spread over `span`; its trailing edge is
 * at x = `tailX`.
 */
export function buildRearWing(tailX: number, span: number, scale: number, lift = scale): RearWing {
  const depth = 0.485;
  const toX = (poly: [number, number][]) =>
    poly.map(([u, y]) => [tailX + (depth - u) * scale, y * lift] as [number, number]);
  const half = span / 2;
  const [main, ...flaps] = [
    element(0, 0.7, 0.3, 0.1, 0.12),
    element(0.255, 0.765, 0.17, 0.49, 0.1),
    element(0.38, 0.845, 0.115, 0.9, 0.1),
  ].map((e) => prism(toX(e), -half, half));
  const endplate = toX([
    [0.01, 0.66],
    [0.12, 0.58],
    [0.46, 0.56],
    [0.485, 0.86],
    [0.455, 0.95],
    [0.36, 0.995],
    [0.15, 0.975],
    [0.03, 0.88],
  ]);
  const pylon = toX([
    [-0.12, 0.5],
    [0.02, 0.5],
    [0.18, 0.705],
    [0.04, 0.7],
  ]);
  const t = 0.02 * scale;
  const p = 0.09 * scale;
  return {
    painted: flaps,
    endplates: [prism(endplate, half, half + t), prism(endplate, -half - t, -half)],
    carbon: [main!, prism(pylon, p - t / 2, p + t / 2), prism(pylon, -p - t / 2, -p + t / 2)],
  };
}
