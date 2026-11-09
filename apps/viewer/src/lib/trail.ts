import { type CarIndex, sampleCar } from "./frames.js";

/**
 * Ribbon vertices (three coords, two per point) for a car's recent path, plus per-vertex alpha
 * fading toward the tail. Writes into `out` (length >= points * 6) and `alpha` (points * 2).
 */
export function trailRibbon(
  c: CarIndex,
  t: number,
  seconds: number,
  points: number,
  halfWidth: number,
  height: number,
  out: Float32Array,
  alpha: Float32Array,
  headFade = 0.12,
): number {
  const t0 = Math.max(0, t - seconds);
  const span = t - t0;
  let used = 0;
  let prevX = 0;
  let prevY = 0;
  for (let k = 0; k < points; k++) {
    const tk = points > 1 ? t0 + (span * k) / (points - 1) : t;
    const f = sampleCar(c, tk);
    let dx: number;
    let dy: number;
    if (k === 0) {
      const g = sampleCar(c, Math.min(t, tk + 0.05));
      dx = g.x - f.x;
      dy = g.y - f.y;
    } else {
      dx = f.x - prevX;
      dy = f.y - prevY;
    }
    const len = Math.hypot(dx, dy);
    const nx = len > 1e-6 ? -dy / len : -Math.sin(f.yaw);
    const ny = len > 1e-6 ? dx / len : Math.cos(f.yaw);
    const o = k * 6;
    out[o] = f.x + nx * halfWidth;
    out[o + 1] = height;
    out[o + 2] = -(f.y + ny * halfWidth);
    out[o + 3] = f.x - nx * halfWidth;
    out[o + 4] = height;
    out[o + 5] = -(f.y - ny * halfWidth);
    const u = points > 1 ? k / (points - 1) : 1;
    const a = u ** 1.4 * Math.min(1, (1 - u) / headFade + 0.05);
    alpha[k * 2] = a;
    alpha[k * 2 + 1] = a;
    prevX = f.x;
    prevY = f.y;
    used++;
  }
  return span > 0 ? used : 0;
}

/** Triangle-strip style indices for a ribbon of `points` pairs. */
export function ribbonIndices(points: number): Uint32Array {
  const idx = new Uint32Array(Math.max(0, points - 1) * 6);
  for (let k = 0; k < points - 1; k++) {
    const a = k * 2;
    idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], k * 6);
  }
  return idx;
}
