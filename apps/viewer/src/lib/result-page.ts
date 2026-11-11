/** The results page of one race: a circuit and an event, beside the circuit's other events. */
import type { ClassifiedResult } from "@bench/sim";
import type { EventResults } from "./results.js";

/** The fields of a race's `results.json` the page reads. */
export type ResultCar = Pick<
  ClassifiedResult,
  "id" | "name" | "position" | "lapTime" | "gap" | "lap" | "status" | "maxSpeed" | "offTracks"
>;

/** One race of the circuit: its classification (`results.json`) and its builds (`event-results.json`). */
export interface RaceResults {
  event: string;
  classification: ResultCar[];
  results: EventResults | null;
}

/** The effort every build of the event shares, or null when none says or they differ. */
export function eventEffort(results: EventResults | null): string | null {
  const efforts = new Set(results?.rows.flatMap((r) => r.manifest?.settings?.effort ?? []));
  return efforts.size === 1 ? [...efforts][0]! : null;
}

export interface StripScale {
  from: number;
  to: number;
  /** Lap times to label, every `step` seconds. */
  ticks: number[];
}

const STEPS = [1, 2, 5, 10, 15, 30, 60];

/**
 * One time axis for every event at a circuit, so the cars move when the event changes and the axis does not:
 * from the fastest lap to the slowest, out to whole ticks, at most 8 steps apart.
 */
export function stripScale(laps: number[]): StripScale | null {
  if (!laps.length) return null;
  const lo = Math.min(...laps);
  const hi = Math.max(...laps);
  const fits = (s: number) => Math.ceil(hi / s) - Math.floor(lo / s) <= 8;
  let step = STEPS.find(fits) ?? 120;
  while (!fits(step)) step += 60;
  const from = Math.floor(lo / step) * step;
  const to = Math.max(Math.ceil(hi / step) * step, from + step);
  const ticks: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) ticks.push(t);
  return { from, to, ticks };
}

/** Where a lap time sits on the axis, 0 to 1. */
export function stripAt(t: number, s: StripScale): number {
  return Math.min(1, Math.max(0, (t - s.from) / (s.to - s.from)));
}

/** "1:35": a tick's label, whole seconds. */
export function formatTick(t: number): string {
  const s = Math.round(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A row for each label, so labels `width` px wide centred on `xs` don't overlap: each goes in the first row where
 * it clears the last label by `gap`, or, when none has room, in the row whose last label ends first.
 */
export function labelLanes(xs: number[], width: number, lanes: number, gap = 4): number[] {
  const ends = Array.from({ length: Math.max(1, lanes) }, () => Number.NEGATIVE_INFINITY);
  const out = new Array<number>(xs.length);
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  for (const { x, i } of order) {
    const start = x - width / 2;
    let lane = ends.findIndex((e) => start >= e + gap);
    if (lane < 0) lane = ends.indexOf(Math.min(...ends));
    ends[lane] = x + width / 2;
    out[i] = lane;
  }
  return out;
}

/** The models that raced the circuit in another event but not in this one, with the events they raced it in. */
export function alsoRaced(
  races: { event: string; drivers: { id: string; name: string }[] }[],
  event: string,
): { id: string; name: string; events: string[] }[] {
  const here = new Set(races.find((r) => r.event === event)?.drivers.map((d) => d.id));
  const out = new Map<string, { id: string; name: string; events: string[] }>();
  for (const r of races) {
    if (r.event === event) continue;
    for (const d of r.drivers) {
      if (here.has(d.id)) continue;
      const m = out.get(d.id) ?? { id: d.id, name: d.name, events: [] };
      m.events.push(r.event);
      out.set(d.id, m);
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Every model that raced the circuit, once, for one set of codes and colours across its events. */
export function circuitDrivers(races: { drivers: { id: string; name: string }[] }[]): {
  id: string;
  name: string;
}[] {
  const seen = new Map<string, string>();
  for (const r of races) for (const d of r.drivers) if (!seen.has(d.id)) seen.set(d.id, d.name);
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** The circuits with a race, by name, for the page's circuit picker. */
export function circuits(races: { track: string; trackName: string }[]): { track: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const r of races) if (!seen.has(r.track)) seen.set(r.track, r.trackName);
  return [...seen].map(([track, name]) => ({ track, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** A top speed in m/s as the table shows it. */
export function formatSpeed(ms: number): string {
  return `${Math.round(ms * 3.6)} km/h`;
}
