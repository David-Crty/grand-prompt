/** Geometry for the small SVG charts: pure, so the shapes are tested and the components only draw them. */

export interface TraceInput {
  t: number[];
  speedKmh: number[];
  throttle: number[];
}

export interface TraceGeometry {
  width: number;
  height: number;
  /** Speed line. */
  speed: string;
  /** Throttle strip: one cell per sample, opacity from the pedal. */
  throttle: { x: number; w: number; opacity: number }[];
  /** Vertical marks (e.g. where the car spun), in px. */
  marks: { x: number; label: string; anchor: "start" | "end" }[];
  /** y of the 100 km/h grid line. */
  y100: number;
}

/** Speed (top, up to `maxKmh`) and throttle (a strip along the bottom) against time, `width` × `height` px. */
export function incidentTrace(
  w: TraceInput,
  width: number,
  height: number,
  marks: { t: number; label: string }[] = [],
  maxKmh = 220,
): TraceGeometry {
  const n = w.t.length;
  const t0 = w.t[0] ?? 0;
  const t1 = w.t[n - 1] ?? t0 + 1;
  const span = Math.max(1e-6, t1 - t0);
  const xOf = (t: number) => ((t - t0) / span) * width;
  const top = 8;
  const bottom = height - 22;
  const yOf = (v: number) => bottom - (Math.min(maxKmh, Math.max(0, v)) / maxKmh) * (bottom - top);
  const speed = w.t
    .map((t, k) => `${k ? "L" : "M"}${xOf(t).toFixed(1)} ${yOf(w.speedKmh[k]!).toFixed(1)}`)
    .join(" ");
  const cell = width / Math.max(1, n - 1);
  const throttle = w.t.map((t, k) => ({
    x: Math.max(0, xOf(t) - cell / 2),
    w: cell + 0.6,
    opacity: 0.15 + Math.min(1, Math.max(0, w.throttle[k]!)) * 0.85,
  }));
  return {
    width,
    height,
    speed,
    throttle,
    marks: marks
      .filter((m) => m.t >= t0 && m.t <= t1)
      .map((m) => ({
        x: xOf(m.t),
        label: m.label,
        anchor: xOf(m.t) > width - 48 ? ("end" as const) : ("start" as const),
      })),
    y100: yOf(100),
  };
}

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
