import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isEventResults, type StoredRace, summarizeDrivers } from "../src/lib/drivers.js";
import { trackOutline } from "../src/lib/outline.js";
import {
  type RaceEntry,
  type RaceIndex,
  type RaceSource,
  sortRaces,
  summarizeRace,
  type TrackInfo,
} from "../src/lib/races.js";

const READ = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown;

function isSource(v: unknown): v is RaceSource {
  const r = v as Partial<RaceSource> | null;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.trackId === "string" &&
    Array.isArray(r.classification) &&
    r.classification.every((c) => "lapTime" in c)
  );
}

function trackInfo(tracksDir: string): (id: string) => TrackInfo {
  const cache = new Map<string, TrackInfo>();
  return (id) => {
    let info = cache.get(id);
    if (!info) {
      info = {};
      try {
        const t = JSON.parse(readFileSync(join(tracksDir, `${id}.json`), "utf8")) as {
          name?: unknown;
          points?: unknown;
        };
        if (typeof t.name === "string") info.name = t.name;
        info.outline = trackOutline(t.points);
      } catch {
        // The race keeps its track id as its name and goes without an outline.
      }
      cache.set(id, info);
    }
    return info;
  };
}

const mtime = (path: string) => statSync(path).mtimeMs;

/**
 * Every race in `resultsDir/races/<id>/` (its `replay.json.gz` and `results.json`), summarised for the race list,
 * and the models that raced them (`event-results.json`), for the drivers page.
 */
export function scanResults(resultsDir: string, tracksDir: string): RaceIndex {
  const races: RaceEntry[] = [];
  const stored: StoredRace[] = [];
  const infoOf = trackInfo(tracksDir);
  const base = join(resultsDir, "races");
  let ids: string[];
  try {
    ids = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    ids = [];
  }
  for (const id of ids) {
    const dir = join(base, id);
    try {
      const src = READ(dir, "results.json");
      if (isSource(src)) {
        const time = Math.max(mtime(join(dir, "replay.json.gz")), mtime(join(dir, "results.json")));
        races.push(summarizeRace(id, src, { track: infoOf(src.trackId), time }));
      }
    } catch {
      // A race without its replay, or unreadable or half-written, is left out of the list rather than failing it.
    }
    try {
      const ev = READ(dir, "event-results.json");
      if (isEventResults(ev)) {
        const time = mtime(join(dir, "event-results.json"));
        stored.push({ src: ev, trackName: infoOf(ev.track).name ?? ev.track, time });
      }
    } catch {
      // A race without its table is still listed; its models are not.
    }
  }
  return { races: sortRaces(races), drivers: summarizeDrivers(stored) };
}
