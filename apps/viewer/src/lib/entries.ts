import type { Replay } from "@bench/sim";
import { type Entry, entryMap, resolveEntries } from "@bench/ui";
import type { RaceEntry } from "./races.js";

/**
 * Entries of one event, resolved in id order so the race list and the viewer give a car the same slot.
 * Replays do not carry slots yet (they keep the sim's palette colour); until they do, the stored colour is
 * ignored and every car takes its entry colour from the design system's twelve slots.
 */
export function eventEntries(items: { id: string; name: string }[]): Map<string, Entry> {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  return entryMap(resolveEntries(sorted.map((c) => ({ id: c.id, name: c.name }))));
}

/** A copy of the replay whose cars and classification rows use their entry colours. */
export function recolorReplay(replay: Replay, entries: Map<string, Entry>): Replay {
  const color = (id: string, fallback: string) => entries.get(id)?.color ?? fallback;
  return {
    ...replay,
    cars: replay.cars.map((c) => ({ ...c, color: color(c.id, c.color) })),
    classification: replay.classification.map((r) => ({ ...r, color: color(r.id, r.color) })),
  };
}

/**
 * A race-list row with entry colours. Applied in the browser, after `/results/index.json` loads: the dev
 * server builds the index in plain Node and keeps the stored colours.
 */
export function recolorRace(r: RaceEntry): RaceEntry {
  const entries = eventEntries(r.drivers);
  const color = (id: string, fallback: string) => entries.get(id)?.color ?? fallback;
  return {
    ...r,
    winner: r.winner ? { ...r.winner, color: color(r.winner.id, r.winner.color) } : null,
    fastest: r.fastest ? { ...r.fastest, color: color(r.fastest.id, r.fastest.color) } : null,
    drivers: r.drivers.map((d) => ({ ...d, color: color(d.id, d.color) })),
  };
}
