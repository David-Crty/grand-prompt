import { formatGap, formatLapsDown } from "./format.js";
import { type CarIndex, progressAt, statusAt, timeAtProgress } from "./frames.js";

export interface StandingRow {
  id: string;
  index: number;
  position: number;
  name: string;
  color: string;
  progress: number;
  /** Lap shown on the tower, capped to the race distance. */
  lap: number;
  status: string;
  finished: boolean;
  out: boolean;
  /** Seconds behind the leader, when on the same lap. */
  gap: number | null;
  /** Seconds behind the car one place ahead, when on the same lap. */
  interval: number | null;
  lapsDown: number;
  gapText: string;
  intervalText: string;
}

function group(status: string): number {
  if (status === "FINISHED") return 0;
  if (status.startsWith("DNF")) return 2;
  return 1;
}

/** Time gap of `behind` to `ahead` at time t, by when `ahead` reached the same distance. */
export function timeGap(
  ahead: CarIndex,
  behind: CarIndex,
  t: number,
): { gap: number | null; lapsDown: number } {
  const aFin = ahead.finishTime !== null && ahead.finishTime <= t;
  const bFin = behind.finishTime !== null && behind.finishTime <= t;
  if (aFin && bFin) return { gap: behind.finishTime! - ahead.finishTime!, lapsDown: 0 };
  const pa = progressAt(ahead, t);
  const pb = progressAt(behind, t);
  const L = ahead.trackLength;
  if (pa - pb >= L) return { gap: null, lapsDown: Math.floor((pa - pb) / L) };
  const ta = timeAtProgress(ahead, pb);
  if (ta === null || ta > t + 1e-9) return { gap: null, lapsDown: 0 };
  return { gap: Math.max(0, t - ta), lapsDown: 0 };
}

/** Live running order: finished cars by finish time, then running cars by distance, then retirements. */
export function liveStandings(cars: CarIndex[], t: number, totalLaps: number): StandingRow[] {
  const items = cars.map((c) => {
    const status = statusAt(c, t);
    return { c, status, g: group(status), p: progressAt(c, t) };
  });
  items.sort((a, b) => {
    if (a.g !== b.g) return a.g - b.g;
    if (a.g === 0) return a.c.finishTime! - b.c.finishTime!;
    return b.p - a.p;
  });
  const rows: StandingRow[] = [];
  const leader = items[0]!;
  items.forEach((it, k) => {
    const L = it.c.trackLength;
    const lap = Math.max(1, Math.min(totalLaps, Math.floor(it.p / L) + 1));
    const out = it.g === 2;
    let gap: number | null = null;
    let interval: number | null = null;
    let lapsDown = 0;
    let gapText = "";
    let intervalText = "";
    if (k === 0) {
      gapText = it.g === 0 ? "WINNER" : "LEADER";
      intervalText = gapText === "WINNER" ? "WINNER" : "INTERVAL";
    } else if (out) {
      gapText = "OUT";
      intervalText = "OUT";
    } else {
      const lg = timeGap(leader.c, it.c, t);
      gap = lg.gap;
      lapsDown = lg.lapsDown;
      gapText = lapsDown > 0 ? formatLapsDown(lapsDown) : formatGap(gap);
      const ahead = items[k - 1]!;
      if (ahead.g === 2) {
        intervalText = gapText;
      } else {
        const ig = timeGap(ahead.c, it.c, t);
        interval = ig.gap;
        intervalText = ig.lapsDown > 0 ? formatLapsDown(ig.lapsDown) : formatGap(interval);
      }
    }
    rows.push({
      id: it.c.car.id,
      index: it.c.index,
      position: k + 1,
      name: it.c.car.name,
      color: it.c.car.color,
      progress: it.p,
      lap,
      status: it.status,
      finished: it.g === 0,
      out,
      gap,
      interval,
      lapsDown,
      gapText,
      intervalText,
    });
  });
  return rows;
}

/** Leader's lap for the session header, e.g. 2 of 3; caps at the race distance. */
export function leaderLap(rows: StandingRow[], totalLaps: number): number {
  const first = rows[0];
  if (!first) return 0;
  return first.finished ? totalLaps : first.lap;
}
