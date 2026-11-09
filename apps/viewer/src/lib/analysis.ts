/**
 * Analysis data: speed, throttle and brake against distance on the timed lap, the time gap to a reference at
 * equal distance, sector times coloured like a timing screen, and one sentence on where the time goes.
 */
import type { ClassifiedResult } from "@bench/sim";
import type { CarIndex } from "./frames.js";

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

/** The timed lap of every car that has one. */
export function lapProfiles(cars: CarIndex[], bin = 5): LapProfile[] {
  return cars.flatMap((c) => {
    const p = c.car.result.lapTime == null ? null : lapProfile(c, bin);
    return p ? [p] : [];
  });
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

export type SectorKind = "fastest" | "slower";

export interface SectorRow {
  id: string;
  time: number;
  sectors: { time: number; kind: SectorKind }[];
}

/** Sector times of every valid lap: purple where it is the fastest of anyone, yellow elsewhere. */
export function sectorRows(classification: ClassifiedResult[]): SectorRow[] {
  const laps = classification.flatMap((r) =>
    r.lap?.valid && r.lapTime != null ? [{ id: r.id, lap: r.lap }] : [],
  );
  const n = Math.max(0, ...laps.map((l) => l.lap.sectors.length));
  const best = Array.from({ length: n }, (_, k) =>
    Math.min(...laps.map((l) => l.lap.sectors[k] ?? Number.POSITIVE_INFINITY)),
  );
  return laps.map(({ id, lap }) => ({
    id,
    time: lap.time,
    sectors: lap.sectors.map((v, k) => ({
      time: v,
      kind: (v <= best[k]! + 1e-9 ? "fastest" : "slower") as SectorKind,
    })),
  }));
}

/**
 * One sentence comparing a car with the reference, sector by sector: where it loses time and
 * where it gets some back, naming a sector where it is the fastest of anyone.
 */
export function whereTimeGoes(
  rows: SectorRow[],
  focusId: string,
  refId: string,
  code: (id: string) => string,
): string | null {
  const f = rows.find((r) => r.id === focusId);
  const r = rows.find((x) => x.id === refId);
  if (!f || !r || focusId === refId) return null;
  const d = f.sectors.map((s, k) => s.time - (r.sectors[k]?.time ?? s.time));
  const loses = d.flatMap((v, k) => (v > 0.0005 ? [`${v.toFixed(2)} s in sector ${k + 1}`] : []));
  const gains = d.flatMap((v, k) => (v < -0.0005 ? [{ k, v }] : []));
  const parts: string[] = [];
  if (loses.length) parts.push(`${code(focusId)} loses ${joinAnd(loses)} to ${code(refId)}`);
  if (gains.length) {
    const g = gains.map(({ k, v }) => `${(-v).toFixed(2)} s back in sector ${k + 1}`);
    const fastest = gains.filter(({ k }) => f.sectors[k]!.kind === "fastest").map(({ k }) => k + 1);
    const tail = fastest.length ? `, where it is the fastest of anyone` : "";
    parts.push(
      loses.length
        ? `then gets ${joinAnd(g)}${tail}`
        : `${code(focusId)} gains ${joinAnd(g)} on ${code(refId)}${tail}`,
    );
  }
  if (!parts.length) return `${code(focusId)} matches ${code(refId)} in every sector.`;
  return `${parts.join(", ")}.`;
}

function joinAnd(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * Who the analysis compares: the reference (pole), the followed car, then the fastest others, at most `max`, all
 * with a timed lap.
 */
export function analysisPicks(
  profiles: LapProfile[],
  focusId: string,
  max = 4,
): { ref: string | null; ids: string[] } {
  const by = [...profiles].filter((p) => p.time != null).sort((a, b) => a.time! - b.time!);
  const ref = by[0]?.id ?? null;
  const ids: string[] = [];
  for (const id of [ref, focusId, ...by.map((p) => p.id)])
    if (id && !ids.includes(id) && profiles.some((p) => p.id === id) && ids.length < max) ids.push(id);
  return { ref, ids };
}
