import type { ClassifiedResult } from "@bench/sim";
import type { DriverEntry } from "./drivers.js";
import type { Outline } from "./outline.js";

/** The fields of a session's `results.json` a race list needs. */
export interface RaceSource {
  trackId: string;
  classification: Pick<ClassifiedResult, "id" | "name" | "position" | "lapTime">[];
}

export interface RaceDriver {
  id: string;
  name: string;
  /** Lap time, s; null without a valid lap. */
  time: number | null;
}

export interface RaceEntry {
  /** Its directory under `results/races/`: `<event>-<track>`, e.g. "gp-1-monaco". */
  id: string;
  trackName: string;
  /** The circuit drawn for the list; null when its track file is missing or unreadable. */
  outline: Outline | null;
  /** Last modification of the result files, ms since epoch. */
  time: number;
  /** Classification order. */
  drivers: RaceDriver[];
}

export interface RaceIndex {
  races: RaceEntry[];
  /** Every model that built a driver for an event, from the latest event it entered. */
  drivers: DriverEntry[];
}

export interface TrackInfo {
  name?: string;
  outline?: Outline | null;
}

export function summarizeRace(
  id: string,
  src: RaceSource,
  opts: { track?: TrackInfo; time: number },
): RaceEntry {
  const drivers = [...src.classification]
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name, time: c.lapTime }));
  return {
    id,
    trackName: opts.track?.name ?? src.trackId,
    outline: opts.track?.outline ?? null,
    time: opts.time,
    drivers,
  };
}

/** By circuit, then newest first, then by id so equal timestamps keep a stable order. */
export function sortRaces(races: RaceEntry[]): RaceEntry[] {
  return [...races].sort(
    (a, b) => a.trackName.localeCompare(b.trackName) || b.time - a.time || a.id.localeCompare(b.id),
  );
}

/** Races whose circuit name holds every term of the query. */
export function filterRaces(races: RaceEntry[], query: string): RaceEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return races;
  return races.filter((r) => terms.every((t) => r.trackName.toLowerCase().includes(t)));
}

/** The timed cars in order, each with its gap to pole. */
export function timedField(r: Pick<RaceEntry, "drivers">): (RaceDriver & { time: number; gap: number })[] {
  const timed = r.drivers.filter((d): d is RaceDriver & { time: number } => d.time != null);
  const pole = timed[0]?.time ?? 0;
  return timed.map((d) => ({ ...d, gap: d.time - pole }));
}

/**
 * Where each timed car sits between pole (0) and the slowest timed car (1), and the gap that spans. A field of
 * one sits at 0.
 */
export function fieldSpread(r: Pick<RaceEntry, "drivers">): {
  dots: { id: string; name: string; time: number; at: number; gap: number }[];
  span: number;
} {
  const field = timedField(r);
  const span = field.length ? field[field.length - 1]!.gap : 0;
  return {
    dots: field.map((d) => ({
      id: d.id,
      name: d.name,
      time: d.time,
      at: span > 0 ? d.gap / span : 0,
      gap: d.gap,
    })),
    span,
  };
}

/**
 * The dots in groups of ones closer than `near` (in the same 0..1 as `at`) to their neighbour, each with where it
 * starts and ends, so dots drawn on top of each other share one hover target.
 */
export function clusterDots<D extends { at: number }>(
  dots: D[],
  near: number,
): { from: number; to: number; dots: D[] }[] {
  const out: { from: number; to: number; dots: D[] }[] = [];
  for (const d of [...dots].sort((a, b) => a.at - b.at)) {
    const last = out[out.length - 1];
    if (last && d.at - last.to < near) {
      last.dots.push(d);
      last.to = d.at;
    } else out.push({ from: d.at, to: d.at, dots: [d] });
  }
  return out;
}

/** "3.31 km". */
export function formatLength(m: number): string {
  return `${(m / 1000).toFixed(2)} km`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Local "9 Nov 2026". */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "--";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const REVEAL_KEY = "gp.results.shown";

/** Whether the viewer chose to see results on the home pages; hidden by default, and when storage fails. */
export function readReveal(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  try {
    return storage?.getItem(REVEAL_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeReveal(storage: Pick<Storage, "setItem"> | null | undefined, shown: boolean): void {
  try {
    storage?.setItem(REVEAL_KEY, shown ? "1" : "0");
  } catch {
    // Private windows and blocked storage keep the choice for this page only.
  }
}
