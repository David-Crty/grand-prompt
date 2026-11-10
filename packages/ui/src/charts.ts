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
