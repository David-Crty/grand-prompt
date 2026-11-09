/**
 * What the timing components print for a row: pure, so the tower, the phone strip, the sheet and the video
 * read the same words for the same state.
 */
import { formatGap, statusShort } from "./format.js";

/** The fields of a live standing the components need (the viewer's `StandingRow` has them all). */
export interface TimingRow {
  id: string;
  position: number;
  status: string;
  /** Crossed the line at the end of the lap, timed or not. */
  finished: boolean;
  /** Finished on a deleted lap: no time. */
  deleted: boolean;
  out: boolean;
  /** Seconds behind the car in P1. */
  gap: number | null;
  /** Seconds behind the car one place ahead. */
  interval: number | null;
}

export type GapMode = "gap" | "interval";
export type GapKind = "lead" | "out" | "gap";

/**
 * The gap column. P1 shows POLE once its lap is timed (LEADER, or INTERVAL in interval mode, before that), a
 * deleted lap NO TIME, a retired car OUT; everyone else the time. `compact` is the phone strip: LEAD and one
 * decimal.
 */
export function gapLabel(
  row: TimingRow,
  mode: GapMode = "gap",
  compact = false,
): { text: string; kind: GapKind } {
  if (row.deleted) return { text: "NO TIME", kind: "out" };
  if (row.position === 1)
    return {
      text: row.finished ? "POLE" : compact ? "LEAD" : mode === "interval" ? "INTERVAL" : "LEADER",
      kind: "lead",
    };
  if (row.out) return { text: "OUT", kind: "out" };
  const value = mode === "interval" ? (row.interval ?? row.gap) : row.gap;
  return { text: formatGap(value, compact ? 1 : 3), kind: "gap" };
}

/** The status column: a chequer for a timed lap, a badge for a deleted lap, a retirement or a time-up. */
export function statusCell(row: TimingRow): { kind: "fin" | "del" | "dnf" | "time" | "run"; text: string } {
  if (row.deleted) return { kind: "del", text: "DEL" };
  const st = statusShort(row.status);
  if (st === "FIN") return { kind: "fin", text: "FIN" };
  if (st === "DNF") return { kind: "dnf", text: "DNF" };
  if (st === "TIME") return { kind: "time", text: "TIME" };
  return { kind: "run", text: "" };
}

/** True once every car has finished or retired. */
export function towerFinal(rows: TimingRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.finished || r.out);
}

/** Lap time for a stat cell: an en dash when there is none. */
export function lapOrDash(t: number | null | undefined, format: (t: number) => string): string {
  return t == null || !Number.isFinite(t) || t < 0 ? "–" : format(t);
}
