/**
 * Analysis data: speed, throttle and brake against distance on the timed lap, the time gap between two cars at
 * equal distance, and the lap cut into its corners: the time each car takes over each corner's stretch, how fast
 * it goes through the apex, and where and how hard it brakes. The corners add up to the lap, so a pair's corner
 * gaps add up to the gap on the timing screen.
 */
import type { Corner } from "./corners.js";
import { type CarIndex, timeAtProgress } from "./frames.js";

/** Frames of the timed lap carry lap 1 (the run-up is 0, after the line 2). */
const TIMED = 1;

export interface LapProfile {
  id: string;
  /** The car's lap time, null for a deleted or unfinished lap. */
  time: number | null;
  /** Bin centres (m), and the mean speed (km/h), throttle and brake in each bin. */
  s: number[];
  speedKmh: number[];
  throttle: number[];
  brake: number[];
}

/** Speed and pedals against distance on the timed lap, averaged into `bin`-metre bins. */
export function lapProfile(c: CarIndex, bin = 5): LapProfile | null {
  const f = c.car.frames;
  const nb = Math.ceil(c.trackLength / bin);
  const acc = {
    n: new Uint32Array(nb),
    v: new Float64Array(nb),
    thr: new Float64Array(nb),
    brk: new Float64Array(nb),
  };
  let any = false;
  for (let k = 0; k < f.lap.length; k++) {
    if (f.lap[k] !== TIMED) continue;
    const b = Math.min(nb - 1, Math.max(0, Math.floor(f.s[k]! / bin)));
    acc.n[b]!++;
    acc.v[b]! += f.speed[k]!;
    acc.thr[b]! += f.throttle[k]!;
    acc.brk[b]! += f.brake[k]!;
    any = true;
  }
  if (!any) return null;
  const out: LapProfile = {
    id: c.car.id,
    time: c.car.result.lapTime,
    s: [],
    speedKmh: [],
    throttle: [],
    brake: [],
  };
  for (let b = 0; b < nb; b++) {
    const n = acc.n[b]!;
    if (!n) continue;
    out.s.push((b + 0.5) * bin);
    out.speedKmh.push((acc.v[b]! / n) * 3.6);
    out.throttle.push(acc.thr[b]! / n);
    out.brake.push(acc.brk[b]! / n);
  }
  return out;
}

/** The timed lap of every car that has one, fastest first. */
export function lapProfiles(cars: CarIndex[], bin = 5): LapProfile[] {
  return cars
    .flatMap((c) => {
      const p = c.car.result.lapTime == null ? null : lapProfile(c, bin);
      return p ? [p] : [];
    })
    .sort((a, b) => a.time! - b.time!);
}

/** Distance and elapsed time through the timed lap, from the frames (monotonic in distance). */
function lapClock(c: CarIndex): { s: number[]; t: number[] } {
  const f = c.car.frames;
  const s: number[] = [];
  const t: number[] = [];
  let t0: number | null = null;
  for (let k = 0; k < f.lap.length; k++) {
    if (f.lap[k] !== TIMED) continue;
    const tk = k / c.frameRate;
    if (t0 === null) t0 = tk;
    if (s.length && f.s[k]! <= s[s.length - 1]!) continue;
    s.push(f.s[k]!);
    t.push(tk - t0);
  }
  return { s, t };
}

function timeAt(clock: { s: number[]; t: number[] }, x: number): number {
  const { s, t } = clock;
  if (s.length === 0) return 0;
  if (x <= s[0]!) return t[0]!;
  let lo = 0;
  let hi = s.length - 1;
  if (x >= s[hi]!) return t[hi]!;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const a = (x - s[lo]!) / Math.max(1e-9, s[hi]! - s[lo]!);
  return t[lo]! + a * (t[hi]! - t[lo]!);
}

/** Elapsed time on the timed lap at distance x; the line itself is the lap time. */
function lapTimeAt(c: CarIndex, clock: { s: number[]; t: number[] }, x: number): number {
  return x >= c.trackLength ? c.car.result.lapTime! : timeAt(clock, x);
}

/**
 * Time of `other` minus time of `ref` at the same distance through their timed laps, every `step` m. The last
 * point is the lap-time difference itself, so the line ends where the timing screen says it should.
 */
export function deltaSeries(ref: CarIndex, other: CarIndex, step = 10): { s: number[]; dt: number[] } | null {
  const ta = ref.car.result.lapTime;
  const tb = other.car.result.lapTime;
  if (ta == null || tb == null) return null;
  const a = lapClock(ref);
  const b = lapClock(other);
  const L = ref.trackLength;
  const s: number[] = [];
  const dt: number[] = [];
  for (let x = 0; x < L; x += step) {
    s.push(x);
    dt.push(timeAt(b, x) - timeAt(a, x));
  }
  s.push(L);
  dt.push(tb - ta);
  return { s, dt };
}

/** One corner's stretch of the lap, from halfway along the straight before it to halfway along the one after. */
export interface CornerSegment {
  n: number;
  from: number;
  to: number;
  /** Index of the sector the stretch ends in. */
  sector: number;
}

/**
 * The lap cut into its corners. Each cut falls halfway along the straight between two corners, or on the
 * sector line when one lies on that straight, so the corners add up exactly to the sectors and to the lap.
 */
export function cornerSegments(corners: Corner[], length: number, sectors: number[]): CornerSegment[] {
  const cuts = [0];
  for (let k = 0; k < corners.length - 1; k++) {
    const a = corners[k]!.sEnd;
    const b = corners[k + 1]!.sStart;
    cuts.push(sectors.find((x) => x > a && x < b) ?? (a + b) / 2);
  }
  cuts.push(length);
  return corners.map((c, k) => {
    const to = cuts[k + 1]!;
    return { n: c.n, from: cuts[k]!, to, sector: sectors.filter((x) => x < to - 1e-6).length };
  });
}

/** Time the car takes over each corner's stretch of its timed lap, or null without a timed lap. */
export function cornerTimes(c: CarIndex, segs: CornerSegment[]): number[] | null {
  if (c.car.result.lapTime == null) return null;
  const clock = lapClock(c);
  if (clock.s.length === 0) return null;
  return segs.map((g) => lapTimeAt(c, clock, g.to) - lapTimeAt(c, clock, g.from));
}

/** Brake input that counts as braking (a lift alone stays below it). */
export const BRAKE_ON = 0.05;

export interface CornerFacts {
  /**
   * Apex speed (km/h) and where: the lowest point where the speed stops falling and starts rising again, near the
   * corner. A car still accelerating out of the corner before has no low point there, so the edge of the search
   * never counts; without any, the lowest speed inside the corner.
   */
  apexKmh: number;
  apexS: number;
  /** First braking before the corner, null when the car only lifts; and the peak brake input there. */
  brakeS: number | null;
  peakBrake: number;
}

/** Apex speed, and where and how hard the car brakes for the corner, from its lap profile. */
export function cornerFacts(p: LapProfile, corner: Corner, from: number): CornerFacts {
  const v = p.speedKmh;
  let apex: { kmh: number; s: number } | null = null;
  let inBand: { kmh: number; s: number } | null = null;
  let brakeS: number | null = null;
  let peak = 0;
  p.s.forEach((s, i) => {
    if (s >= corner.sStart - 30 && s <= corner.sEnd + 10) {
      const valley = (i === 0 || v[i]! <= v[i - 1]!) && (i === v.length - 1 || v[i]! <= v[i + 1]!);
      if (valley && (!apex || v[i]! < apex.kmh)) apex = { kmh: v[i]!, s };
    }
    if (s >= corner.sStart && s <= corner.sEnd && (!inBand || v[i]! < inBand.kmh)) inBand = { kmh: v[i]!, s };
    if (s >= from && s <= corner.sEnd) {
      if (brakeS == null && p.brake[i]! > BRAKE_ON) brakeS = s;
      peak = Math.max(peak, p.brake[i]!);
    }
  });
  const at: { kmh: number; s: number } = apex ?? inBand ?? { kmh: 0, s: corner.sApex };
  return { apexKmh: at.kmh, apexS: at.s, brakeS, peakBrake: brakeS == null ? 0 : peak };
}

/** One corner, one car against its reference. */
export interface PairRow {
  k: number;
  n: number;
  sector: number;
  /** Car's time minus the reference's over the corner's stretch: positive is time lost. */
  dt: number;
  car: CornerFacts;
  ref: CornerFacts;
}

export function pairRows(
  segs: CornerSegment[],
  corners: Corner[],
  car: { times: number[]; profile: LapProfile },
  ref: { times: number[]; profile: LapProfile },
): PairRow[] {
  return segs.map((g, k) => ({
    k,
    n: g.n,
    sector: g.sector,
    dt: car.times[k]! - ref.times[k]!,
    car: cornerFacts(car.profile, corners[k]!, g.from),
    ref: cornerFacts(ref.profile, corners[k]!, g.from),
  }));
}

/** Braking points closer than this are the same point: the profile bins are 5 m. */
const SAME_POINT_M = 5;

/** Where and how hard the car brakes against the reference, in a few words for the corner table. */
export function brakeText(r: Pick<PairRow, "car" | "ref">, refCode: string): string {
  const a = r.car.brakeS;
  const b = r.ref.brakeS;
  if (a == null && b == null) return "–";
  if (a == null) return `lifts, ${refCode} brakes`;
  if (b == null) return `brakes, ${refCode} lifts`;
  const d = a - b;
  const where =
    Math.abs(d) <= SAME_POINT_M
      ? "same point"
      : `${Math.max(5, Math.round(Math.abs(d) / 5) * 5)} m ${d > 0 ? "later" : "earlier"}`;
  const ratio = r.car.peakBrake / Math.max(0.01, r.ref.peakBrake);
  const force = ratio >= 1.25 ? "harder" : ratio <= 0.8 ? "softer" : null;
  return force ? `${where}, ${force}` : where;
}

const kmhDiff = (r: Pick<PairRow, "car" | "ref">) => Math.round(r.car.apexKmh) - Math.round(r.ref.apexKmh);

/**
 * One sentence on the pair, from the corners: the gap, the two corners where most of it is made and the one that
 * gives some back, with the apex speed when it differs; and the top speed when it differs by 5 km/h or more.
 */
export function pairSummary(
  rows: PairRow[],
  code: string,
  refCode: string,
  gap: number,
  top: { car: number; ref: number },
): { lead: string; rest: string } {
  const behind = gap >= 0;
  const dir = (r: PairRow) => (behind ? r.dt : -r.dt);
  const apex = (r: PairRow) => {
    const dv = kmhDiff(r);
    return Math.abs(dv) >= 3 ? `, ${Math.abs(dv)} km/h ${dv < 0 ? "slower" : "faster"} at the apex` : "";
  };
  const by = (a: PairRow, b: PairRow) => Math.abs(b.dt) - Math.abs(a.dt);
  const main = rows
    .filter((r) => dir(r) > 0.05)
    .sort(by)
    .slice(0, 2);
  const back = rows.filter((r) => dir(r) < -0.05).sort(by)[0];
  const lead = `${code} is ${Math.abs(gap).toFixed(3)} s ${behind ? "slower" : "faster"} than ${refCode}.`;
  const parts: string[] = [];
  if (main.length) {
    const where = main.map((r, j) => `T${r.n} (${Math.abs(r.dt).toFixed(2)} s${j === 0 ? apex(r) : ""})`);
    let s = `It ${behind ? "loses" : "gains"} the most in ${where.join(" and ")}`;
    if (back)
      s += `, and ${behind ? "gets" : "gives"} ${Math.abs(back.dt).toFixed(2)} s ${behind ? "back" : "away"} in T${back.n}${apex(back)}`;
    parts.push(`${s}.`);
  }
  const dt = Math.round(top.car) - Math.round(top.ref);
  if (Math.abs(dt) >= 5)
    parts.push(
      `Its top speed is ${Math.round(top.car)} km/h, ${Math.abs(dt)} ${dt < 0 ? "below" : "above"} ${refCode}'s.`,
    );
  return { lead, rest: parts.join(" ") };
}

export interface FieldGrid {
  ids: string[];
  /** Per car, per corner: time lost to the fastest car through that corner (0 for the fastest). */
  loss: number[][];
  /** Per corner: the id of the fastest car through it. */
  fastest: string[];
  /** The best time through each corner, added up. */
  ideal: number;
}

/** Every timed lap through every corner, against the fastest car through each one. */
export function fieldGrid(laps: { id: string; times: number[] }[]): FieldGrid {
  const n = laps[0]?.times.length ?? 0;
  const best = Array.from({ length: n }, (_, k) => Math.min(...laps.map((l) => l.times[k]!)));
  return {
    ids: laps.map((l) => l.id),
    loss: laps.map((l) => l.times.map((t, k) => Math.max(0, t - best[k]!))),
    fastest: best.map((b, k) => laps.find((l) => l.times[k]! <= b + 1e-9)!.id),
    ideal: best.reduce((a, b) => a + b, 0),
  };
}

/**
 * Who the analysis compares: the followed car (the fastest when it has no timed lap) against `ref` when that is
 * another timed lap, else against pole, or P2 when the car is on pole.
 */
export function analysisPair(
  profiles: LapProfile[],
  focusId: string,
  ref: string | null = null,
): { car: string | null; ref: string | null } {
  const ids = profiles.map((p) => p.id);
  const car = ids.includes(focusId) ? focusId : (ids[0] ?? null);
  if (ref && ref !== car && ids.includes(ref)) return { car, ref };
  return { car, ref: ids.find((id) => id !== car) ?? null };
}

/** Replay time a little before the car reaches distance `s` on its timed lap: where Watch seeks to. */
export function watchTime(c: CarIndex, s: number, lead = 1.5): number {
  return Math.max(0, (timeAtProgress(c, s) ?? c.startTime) - lead);
}

/** Rows grouped by sector, in lap order, with each sector's total. */
export function bySector<T extends { sector: number; dt: number }>(
  rows: T[],
): { sector: number; dt: number; rows: T[] }[] {
  const out: { sector: number; dt: number; rows: T[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.sector === r.sector) {
      last.rows.push(r);
      last.dt += r.dt;
    } else out.push({ sector: r.sector, dt: r.dt, rows: [r] });
  }
  return out;
}

/** Everything the analysis panel reads from a replay, computed once. */
export interface AnalysisData {
  /** Timed laps, fastest first. */
  profiles: LapProfile[];
  segments: CornerSegment[];
  /** Corner times per car with a timed lap. */
  times: Map<string, number[]>;
  field: FieldGrid;
}

export function analysisData(cars: CarIndex[], corners: Corner[], sectors: number[]): AnalysisData {
  const profiles = lapProfiles(cars);
  const length = cars[0]?.trackLength ?? 0;
  const segments = cornerSegments(corners, length, sectors);
  const times = new Map<string, number[]>();
  for (const p of profiles) {
    const t = cornerTimes(cars.find((c) => c.car.id === p.id)!, segments);
    if (t) times.set(p.id, t);
  }
  const field = fieldGrid(
    profiles.flatMap((p) => (times.has(p.id) ? [{ id: p.id, times: times.get(p.id)! }] : [])),
  );
  return { profiles, segments, times, field };
}

/** How many corners each car is fastest through, most first (ties in grid order). */
export function fastestCounts(field: FieldGrid): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const id of field.fastest) counts.set(id, (counts.get(id) ?? 0) + 1);
  return field.ids
    .flatMap((id) => (counts.has(id) ? [{ id, count: counts.get(id)! }] : []))
    .sort((a, b) => b.count - a.count);
}
