/**
 * Degrees counter-clockwise that turn a circuit from sim axes (x east, y north) to the way the official F1
 * circuit map draws it.
 */
export const OFFICIAL_MAP_ANGLE: Readonly<Record<string, number>> = {
  barcelona: -35,
  monaco: -45,
  portimao: 75,
  silverstone: -90,
  spa: 100,
};

export interface RotatedBounds {
  minU: number;
  minV: number;
  spanU: number;
  spanV: number;
}

/** Bounds of the points turned by `a` rad counter-clockwise: u = x cos a - y sin a, v = x sin a + y cos a. */
export function rotatedBounds(xs: ArrayLike<number>, ys: ArrayLike<number>, a: number): RotatedBounds {
  const c = Math.cos(a);
  const s = Math.sin(a);
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) {
    const u = xs[i]! * c - ys[i]! * s;
    const v = xs[i]! * s + ys[i]! * c;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { minU, minV, spanU: Math.max(1, maxU - minU), spanV: Math.max(1, maxV - minV) };
}

const FALLBACK_ASPECT = 16 / 10;

/**
 * The angle (rad, counter-clockwise) every 2D map of a circuit is drawn at, so the race list, the HUD and the
 * analysis all show it the same way. A circuit with an official map gets its angle. Any other is turned, in
 * 5 degree steps, to whichever angle fills a 16:10 box best, then the half turn that puts the start/finish line
 * (point 0) in the lower half. It depends on the circuit only, never on the size of the box it is drawn in.
 */
export function mapAngle(trackId: string | undefined, xs: ArrayLike<number>, ys: ArrayLike<number>): number {
  const official = trackId === undefined ? undefined : OFFICIAL_MAP_ANGLE[trackId];
  if (official !== undefined) return (official * Math.PI) / 180;
  const fit = (b: RotatedBounds) => Math.min(FALLBACK_ASPECT / b.spanU, 1 / b.spanV);
  let angle = 0;
  let box = rotatedBounds(xs, ys, 0);
  for (let deg = 5; deg < 180; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const b = rotatedBounds(xs, ys, a);
    if (fit(b) > fit(box) * 1.02) {
      angle = a;
      box = b;
    }
  }
  if (xs.length === 0) return angle;
  const v0 = xs[0]! * Math.sin(angle) + ys[0]! * Math.cos(angle);
  return v0 - box.minV > box.spanV / 2 ? angle + Math.PI : angle;
}
