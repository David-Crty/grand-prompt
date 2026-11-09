import {
  type InterpolatedFrame,
  type Replay,
  type ReplayCar,
  type SimEvent,
  sampleFrames,
  wrapS,
} from "@bench/sim";

/** Per-car lookups precomputed once per replay. */
export interface CarIndex {
  car: ReplayCar;
  index: number;
  frameRate: number;
  trackLength: number;
  frameCount: number;
  /** Race distance per frame: (lap - 1) * length + s. */
  progress: Float64Array;
  /** Running maximum of progress, for monotonic time-at-distance lookups. */
  runMax: Float64Array;
  /** Time of the last frame. */
  endTime: number;
  /** Time the FINISHED status was given, or null. */
  finishTime: number | null;
  statuses: { t: number; status: string }[];
  laps: SimEvent[];
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
  for (let k = 0; k < n; k++) {
    const p = (f.lap[k]! - 1) * trackLength + f.s[k]!;
    progress[k] = p;
    max = Math.max(max, p);
    runMax[k] = max;
  }
  const statuses: { t: number; status: string }[] = [];
  const laps: SimEvent[] = [];
  for (const e of car.events) {
    if (e.type === "status" && e.detail) statuses.push({ t: e.t, status: e.detail });
    else if (e.type === "lap") laps.push(e);
  }
  statuses.sort((a, b) => a.t - b.t);
  laps.sort((a, b) => a.t - b.t);
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
    finishTime: fin ? fin.t : null,
    statuses,
    laps,
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

export interface LapInfo {
  completed: number;
  last: number | null;
  lastValid: boolean;
  best: number | null;
  currentLapStart: number;
}

export function lapInfoAt(c: CarIndex, t: number): LapInfo {
  let completed = 0;
  let last: number | null = null;
  let lastValid = true;
  let best: number | null = null;
  let currentLapStart = 0;
  for (const e of c.laps) {
    if (e.t > t + 1e-9) break;
    completed++;
    last = e.value ?? null;
    lastValid = e.detail !== "invalid";
    if (lastValid && last !== null && (best === null || last < best)) best = last;
    currentLapStart = e.t;
  }
  return { completed, last, lastValid, best, currentLapStart };
}

/** Fastest valid lap among all cars up to time t (for purple highlighting). */
export function overallBestAt(cars: CarIndex[], t: number): { id: string; time: number } | null {
  let best: { id: string; time: number } | null = null;
  for (const c of cars) {
    const b = lapInfoAt(c, t).best;
    if (b !== null && (best === null || b < best.time)) best = { id: c.car.id, time: b };
  }
  return best;
}
