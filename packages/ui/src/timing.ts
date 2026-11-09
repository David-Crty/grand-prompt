/**
 * What the timing components print for a row: pure, so the tower, the phone strip, the sheet and the video
 * read the same words for the same state.
 */
import { formatGap, formatLapsDown, statusShort } from "./format.js";

/** The fields of a live standing the components need (the viewer's `StandingRow` has them all). */
export interface TimingRow {
  id: string;
  position: number;
  lap: number;
  status: string;
  finished: boolean;
  out: boolean;
  /** Seconds behind the leader on the same lap. */
  gap: number | null;
  /** Seconds behind the car one place ahead on the same lap. */
  interval: number | null;
  lapsDown: number;
}

export type GapMode = "gap" | "interval";
export type GapKind = "lead" | "out" | "lapped" | "gap";

/**
 * The gap column. The leader shows LEADER (INTERVAL in interval mode, WINNER once finished), a retired car OUT,
 * a lapped car +1 LAP; everyone else the time. `compact` is the phone strip: LEAD, +1L and one decimal.
 */
export function gapLabel(
  row: TimingRow,
  mode: GapMode = "gap",
  compact = false,
): { text: string; kind: GapKind } {
  if (row.position === 1)
    return {
      text: row.finished ? "WINNER" : compact ? "LEAD" : mode === "interval" ? "INTERVAL" : "LEADER",
      kind: "lead",
    };
  if (row.out) return { text: "OUT", kind: "out" };
  if (row.lapsDown > 0)
    return { text: compact ? `+${row.lapsDown}L` : formatLapsDown(row.lapsDown), kind: "lapped" };
  const value = mode === "interval" ? (row.interval ?? row.gap) : row.gap;
  return { text: formatGap(value, compact ? 1 : 3), kind: "gap" };
}

/** The lap column: a chequer once finished, a status badge when retired or timed out, else the lap. */
export function lapCell(row: TimingRow): { kind: "fin" | "dnf" | "time" | "lap"; text: string } {
  const st = statusShort(row.status);
  if (st === "FIN") return { kind: "fin", text: "FIN" };
  if (st === "DNF") return { kind: "dnf", text: "DNF" };
  if (st === "TIME") return { kind: "time", text: "TIME" };
  return { kind: "lap", text: `L${row.lap}` };
}

/** "LAP 2/5", or FINAL once every car has finished or retired. */
export function towerLap(rows: TimingRow[], totalLaps: number): { final: boolean; lap: number } {
  const final = rows.length > 0 && rows.every((r) => r.finished || r.out);
  const leader = rows[0];
  return { final, lap: leader ? (leader.finished ? totalLaps : leader.lap) : 1 };
}

/** Lap time for a stat cell: an en dash when there is none. */
export function lapOrDash(t: number | null | undefined, format: (t: number) => string): string {
  return t == null || !Number.isFinite(t) || t < 0 ? "–" : format(t);
}
