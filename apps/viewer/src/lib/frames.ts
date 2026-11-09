import { type InterpolatedFrame, type Replay, type ReplayCar, sampleFrames, wrapS } from "@bench/sim";

/** Per-car lookups precomputed once per replay. */
export interface CarIndex {
  car: ReplayCar;
  index: number;
  frameRate: number;
  trackLength: number;
  frameCount: number;
  /** Distance from the line per frame, (lap - 1) * length + s: negative on the run-up, past length at the end. */
  progress: Float64Array;
  /** Running maximum of progress, for monotonic time-at-distance lookups. */
  runMax: Float64Array;
  /** Time of the last frame. */
  endTime: number;
  /** Time the car crossed the line at the end of the run-up (first frame of lap 1). */
  startTime: number;
  /** Time the FINISHED status was given, or null. */
  finishTime: number | null;
  /** Time the car retired (a DNF status), or null. */
  outTime: number | null;
  /** False when the lap was deleted. */
  lapValid: boolean;
  statuses: { t: number; status: string }[];
}

export interface CarSample extends InterpolatedFrame {
  progress: number;
}

export function indexCar(car: ReplayCar, index: number, frameRate: number, trackLength: number): CarIndex {
  const f = car.frames;
  const n = f.x.length;
  const progress = new Float64Array(n);
  const runMax = new Float64Array(n);
  let max = Number.NEGATIVE_INFINITY;
  let start = -1;
  for (let k = 0; k < n; k++) {
    if (start < 0 && f.lap[k]! >= 1) start = k;
    const p = (f.lap[k]! - 1) * trackLength + f.s[k]!;
    progress[k] = p;
    max = Math.max(max, p);
    runMax[k] = max;
  }
  const statuses = car.events
    .filter((e) => e.type === "status" && e.detail)
    .map((e) => ({ t: e.t, status: e.detail! }))
    .sort((a, b) => a.t - b.t);
  const endTime = (n - 1) / frameRate;
  if (statuses.length === 0 && car.result.status !== "RUNNING")
    statuses.push({ t: endTime, status: car.result.status });
  const fin = statuses.find((s) => s.status === "FINISHED");
  return {
    car,
    index,
    frameRate,
    trackLength,
    frameCount: n,
    progress,
    runMax,
    endTime,
    startTime: Math.max(0, start) / frameRate,
    finishTime: fin ? fin.t : null,
    outTime: statuses.find((s) => s.status.startsWith("DNF"))?.t ?? null,
    lapValid: !car.events.some((e) => e.type === "lap" && e.detail === "invalid"),
    statuses,
  };
}

export function indexReplay(r: Replay): CarIndex[] {
  return r.cars.map((c, i) => indexCar(c, i, r.header.frameRate, r.track.length));
}

/** Fractional frame position at time t, clamped to the recorded frames. */
export function frameAt(c: CarIndex, t: number): { i: number; j: number; a: number } {
  const u = Math.min(Math.max(0, t * c.frameRate), c.frameCount - 1);
  const i = Math.floor(u);
  const j = Math.min(i + 1, c.frameCount - 1);
  return { i, j, a: u - i };
}

export function progressAt(c: CarIndex, t: number): number {
  const { i, j, a } = frameAt(c, t);
  return c.progress[i]! + (c.progress[j]! - c.progress[i]!) * a;
}

/** First time the car reached race distance p (linear between frames), or null if it never did. */
export function timeAtProgress(c: CarIndex, p: number): number | null {
  const rm = c.runMax;
  const n = rm.length;
  if (p <= rm[0]!) return 0;
  if (p > rm[n - 1]!) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rm[mid]! >= p) hi = mid;
    else lo = mid;
  }
  const a = rm[hi]! > rm[lo]! ? (p - rm[lo]!) / (rm[hi]! - rm[lo]!) : 0;
  return (lo + a) / c.frameRate;
}

/** sampleFrames plus continuous race distance, and s interpolated across the line. */
export function sampleCar(c: CarIndex, t: number): CarSample {
  const base = sampleFrames(c.car.frames, c.frameRate, t);
  const progress = progressAt(c, t);
  return { ...base, s: wrapS(progress, c.trackLength), progress };
}

export function statusAt(c: CarIndex, t: number): string {
  let status = "RUNNING";
  for (const s of c.statuses) {
    if (s.t <= t + 1e-9) status = s.status;
    else break;
  }
  return status;
}
