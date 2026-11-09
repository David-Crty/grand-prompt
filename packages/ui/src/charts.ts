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
