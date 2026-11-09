import type { TimingRow } from "@bench/ui";
import { type CarIndex, progressAt, statusAt, timeAtProgress } from "./frames.js";

/** One line of the live timing: what `@bench/ui`'s timing components print. */
export type StandingRow = TimingRow;

/** 0 timed, 1 still running (or out of time), 2 finished on a deleted lap, 3 retired. */
function group(c: CarIndex, status: string): number {
  if (status === "FINISHED") return c.lapValid ? 0 : 2;
  if (status.startsWith("DNF")) return 3;
  return 1;
}

/** Seconds `behind` is behind `ahead` at time t, by when `ahead` was where `behind` is now. */
export function timeGap(ahead: CarIndex, behind: CarIndex, t: number): number | null {
  const aFin = ahead.finishTime !== null && ahead.finishTime <= t;
  const bFin = behind.finishTime !== null && behind.finishTime <= t;
  if (aFin && bFin) return behind.finishTime! - ahead.finishTime!;
  const ta = timeAtProgress(ahead, progressAt(behind, t));
  if (ta === null || ta > t + 1e-9) return null;
  return Math.max(0, t - ta);
}

/**
 * Live order: timed cars by finish time (every car crosses the line at the same instant, so that is lap
 * time order), then running cars by distance, then deleted laps, then retirements.
 */
export function liveStandings(cars: CarIndex[], t: number): StandingRow[] {
  const items = cars.map((c) => {
    const status = statusAt(c, t);
    return { c, status, g: group(c, status), p: progressAt(c, t) };
  });
  items.sort((a, b) => {
    if (a.g !== b.g) return a.g - b.g;
    if (a.g === 0 || a.g === 2) return a.c.finishTime! - b.c.finishTime!;
    return b.p - a.p;
  });
  const leader = items[0]!;
  return items.map((it, k) => {
    const ranked = k > 0 && it.g < 2;
    const ahead = items[k - 1];
    return {
      id: it.c.car.id,
      position: k + 1,
      status: it.status,
      finished: it.g === 0 || it.g === 2,
      deleted: it.g === 2,
      out: it.g === 3,
      gap: ranked ? timeGap(leader.c, it.c, t) : null,
      interval: ranked && ahead && ahead.g < 2 ? timeGap(ahead.c, it.c, t) : null,
    };
  });
}
