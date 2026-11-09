import type { CarIndex } from "./frames.js";

export interface LapTrace {
  carId: string;
  name: string;
  color: string;
  lap: number;
  time: number | null;
  /** Bin centres along the lap (m) and mean speed in each bin (m/s). */
  s: number[];
  speed: number[];
}

/** Best valid lap number from the result, falling back to the lap events. */
export function bestLapNumber(c: CarIndex): number | null {
  if (c.car.result.bestLapNumber != null) return c.car.result.bestLapNumber;
  let best: { lap: number; time: number } | null = null;
  for (const e of c.laps) {
    if (e.detail === "invalid" || e.value == null) continue;
    if (!best || e.value < best.time) best = { lap: e.lap, time: e.value };
  }
  return best ? best.lap : null;
}

/** Speed against distance for one lap, averaged into bins of `bin` metres. */
export function lapTrace(c: CarIndex, lap: number, bin = 5): LapTrace | null {
  const f = c.car.frames;
  const nb = Math.ceil(c.trackLength / bin);
  const sum = new Float64Array(nb);
  const cnt = new Uint32Array(nb);
  let any = false;
  for (let k = 0; k < f.lap.length; k++) {
    if (f.lap[k] !== lap) continue;
    const b = Math.min(nb - 1, Math.max(0, Math.floor(f.s[k]! / bin)));
    sum[b]! += f.speed[k]!;
    cnt[b]!++;
    any = true;
  }
  if (!any) return null;
  const s: number[] = [];
  const speed: number[] = [];
  for (let b = 0; b < nb; b++) {
    if (cnt[b]! === 0) continue;
    s.push((b + 0.5) * bin);
    speed.push(sum[b]! / cnt[b]!);
  }
  const ev = c.laps.find((e) => e.lap === lap);
  return { carId: c.car.id, name: c.car.name, color: c.car.color, lap, time: ev?.value ?? null, s, speed };
}

export function bestLapTraces(cars: CarIndex[], bin = 5): LapTrace[] {
  const out: LapTrace[] = [];
  for (const c of cars) {
    const lap = bestLapNumber(c);
    if (lap === null) continue;
    const tr = lapTrace(c, lap, bin);
    if (tr) out.push(tr);
  }
  return out;
}

/** SVG polyline points for a trace in a w x h box with the given speed range. */
export function tracePath(
  tr: LapTrace,
  length: number,
  vmin: number,
  vmax: number,
  w: number,
  h: number,
): string {
  const span = Math.max(1e-6, vmax - vmin);
  return tr.s
    .map((s, k) => {
      const x = (s / length) * w;
      const y = h - ((tr.speed[k]! - vmin) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
