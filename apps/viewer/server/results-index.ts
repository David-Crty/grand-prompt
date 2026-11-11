import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isEventResults, type StoredRace, summarizeDrivers } from "../src/lib/drivers.js";
import { trackOutline } from "../src/lib/outline.js";
import {
  type RaceEntry,
  type RaceIndex,
  type RaceSource,
  sortEvents,
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
        info.outline = trackOutline(t.points, id);
      } catch {
        // The race keeps its track id as its name and goes without an outline.
      }
      cache.set(id, info);
    }
    return info;
  };
}

const mtime = (path: string) => statSync(path).mtimeMs;

/** The site's settings (`site.json` at the repo root): the event the lists open on. */
export interface SiteConfig {
  defaultEvent: string | null;
}

export function readSiteConfig(path: string): SiteConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { defaultEvent: null };
    throw new Error(`${path}: ${(e as Error).message}`);
  }
  const d = (raw as { defaultEvent?: unknown } | null)?.defaultEvent;
  if (d !== undefined && (typeof d !== "string" || !d))
    throw new Error(`${path}: defaultEvent is an event id`);
  return { defaultEvent: d ?? null };
}

const subdirs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return [];
  }
};

/**
 * Every race in `resultsDir/races/<track>/<event>/` (its `replay.json.gz` and `results.json`), summarised for the
 * race list, and the models that raced them (`event-results.json`), for the drivers page, with the events they
 * belong to.
 */
export function scanResults(resultsDir: string, tracksDir: string, site?: SiteConfig): RaceIndex {
  const races: RaceEntry[] = [];
  const stored: StoredRace[] = [];
  const infoOf = trackInfo(tracksDir);
  const base = join(resultsDir, "races");
  for (const track of subdirs(base)) {
    for (const event of subdirs(join(base, track))) {
      const dir = join(base, track, event);
      try {
        const ev = READ(dir, "event-results.json");
        if (isEventResults(ev)) stored.push({ src: ev, trackName: infoOf(ev.track).name ?? ev.track });
      } catch {
        // A race without its table is still listed; its models are not.
      }
      try {
        const src = READ(dir, "results.json");
        if (isSource(src)) {
          const time = Math.max(mtime(join(dir, "replay.json.gz")), mtime(join(dir, "results.json")));
          races.push(summarizeRace({ track, event }, src, { track: infoOf(src.trackId), time }));
        }
      } catch {
        // A race without its replay, or unreadable or half-written, is left out of the list rather than failing it.
      }
    }
  }
  return {
    races: sortRaces(races),
    drivers: summarizeDrivers(stored),
    events: sortEvents(races.map((r) => r.event)),
    defaultEvent: site?.defaultEvent ?? null,
  };
}
