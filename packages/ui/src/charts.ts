/** Geometry for the small SVG charts: pure, so the shapes are tested and the components only draw them. */

/** Linear map from [d0, d1] onto [r0, r1]. */
export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const k = (r1 - r0) / (d1 - d0 || 1);
  return (v) => r0 + (v - d0) * k;
}

/** SVG path through the points, skipping any outside [xmin, xmax] of the domain. */
export function pathOf(
  xs: number[],
  ys: number[],
  sx: (v: number) => number,
  sy: (v: number) => number,
  xmin = Number.NEGATIVE_INFINITY,
  xmax = Number.POSITIVE_INFINITY,
): string {
  const parts: string[] = [];
  xs.forEach((x, k) => {
    if (x < xmin || x > xmax) return;
    parts.push(`${parts.length ? "L" : "M"}${sx(x).toFixed(1)} ${sy(ys[k]!).toFixed(1)}`);
  });
  return parts.join(" ");
}

/**
 * Direct labels at the end of lines: y positions pushed apart so no two are closer than `gap`, keeping their
 * order. Returns positions in the input order.
 */
export function spreadLabels(ys: number[], gap: number): number[] {
  const order = ys.map((y, k) => ({ y, k })).sort((a, b) => a.y - b.y);
  let last = Number.NEGATIVE_INFINITY;
  const out = new Array<number>(ys.length);
  for (const o of order) {
    const y = Math.max(o.y, last + gap);
    out[o.k] = y;
    last = y;
  }
  return out;
}

/** Round up to a whole number of `step`s (axis tops). */
export function niceTop(max: number, step: number): number {
  return Math.max(step, Math.ceil(max / step) * step);
}

/** Linear interpolation of ys over ascending xs at x, held flat past either end. */
export function valueAt(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const a = (x - xs[lo]!) / (xs[hi]! - xs[lo]! || 1);
  return ys[lo]! + a * (ys[hi]! - ys[lo]!);
}

/** A round tick step (1, 2 or 5 times a power of ten) giving about `count` ticks over `span`. */
export function niceStep(span: number, count = 3): number {
  const raw = Math.max(1e-9, span / count);
  const e = 10 ** Math.floor(Math.log10(raw));
  const f = raw / e;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e;
}

/** Multiples of `step` within [lo, hi]. */
export function ticksIn(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let i = Math.ceil(lo / step - 1e-9); i * step <= hi + 1e-9; i++)
    out.push(i * step === 0 ? 0 : i * step);
  return out;
}

/** The y range of the values whose x lies in [x0, x1], padded by `pad` and widened to multiples of `step`. */
export function fitRange(
  xs: number[][],
  ys: number[][],
  x0: number,
  x1: number,
  step: number,
  pad = 0,
): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  xs.forEach((row, j) => {
    row.forEach((x, i) => {
      if (x < x0 || x > x1) return;
      lo = Math.min(lo, ys[j]![i]!);
      hi = Math.max(hi, ys[j]![i]!);
    });
  });
  if (lo > hi) return [0, step];
  return [Math.floor((lo - pad) / step) * step, Math.max(Math.ceil((hi + pad) / step) * step, lo + step)];
}

/** Each value's share of the largest magnitude, for bars drawn to one scale. */
export function shares(values: number[]): number[] {
  const max = Math.max(0, ...values.map(Math.abs));
  return values.map((v) => (max > 0 ? Math.abs(v) / max : 0));
}

/** How strongly to tint a cell for a loss: a percentage from 8 (nothing lost) to 70 (`full` or more). */
export function lossTint(loss: number, full: number): number {
  return Math.round(8 + Math.min(1, Math.max(0, loss) / full) * 62);
}
