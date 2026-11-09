import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  type RaceEntry,
  type RaceIndex,
  type RaceSource,
  sortRaces,
  summarizeRace,
} from "../src/lib/races.js";

const REPLAY_FILES = ["replay.json.gz", "replay.json"];
const MAX_DEPTH = 4;

function readJson(path: string): unknown {
  const raw = readFileSync(path);
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));
}

function isSource(v: unknown): v is RaceSource {
  const r = v as Partial<RaceSource> | null;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.trackId === "string" &&
    typeof r.session === "object" &&
    Array.isArray(r.classification)
  );
}

/** `results.json` when present, otherwise the replay's own header and classification. */
function loadSource(dir: string, replayFile: string): { src: RaceSource; trackName?: string } | null {
  const resultsPath = join(dir, "results.json");
  if (existsSync(resultsPath)) {
    const r = readJson(resultsPath);
    if (isSource(r)) return { src: r };
  }
  const replay = readJson(join(dir, replayFile)) as {
    header?: { simVersion: string; trackId: string; session: RaceSource["session"] };
    track?: { name?: string };
    classification?: RaceSource["classification"];
  };
  if (!replay.header) return null;
  const src = { ...replay.header, classification: replay.classification ?? [] };
  return isSource(src) ? { src, trackName: replay.track?.name } : null;
}

function trackNames(tracksDir: string): (id: string) => string | undefined {
  const cache = new Map<string, string | undefined>();
  return (id) => {
    if (!cache.has(id)) {
      let name: string | undefined;
      try {
        const t = readJson(join(tracksDir, `${id}.json`)) as { name?: unknown };
        if (typeof t.name === "string") name = t.name;
      } catch {
        name = undefined;
      }
      cache.set(id, name);
    }
    return cache.get(id);
  };
}

/** Every directory under `resultsDir` holding a replay, summarised for the race list. */
export function scanResults(resultsDir: string, tracksDir: string, urlBase = "/results"): RaceIndex {
  const races: RaceEntry[] = [];
  const nameOf = trackNames(tracksDir);
  const visit = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    const replayFile = REPLAY_FILES.find((f) => names.includes(f));
    if (replayFile && dir !== resultsDir) {
      try {
        const loaded = loadSource(dir, replayFile);
        if (loaded) {
          const id = relative(resultsDir, dir).split(sep).join("/");
          const time = Math.max(
            ...[replayFile, "results.json"]
              .filter((f) => names.includes(f))
              .map((f) => statSync(join(dir, f)).mtimeMs),
          );
          const url = `${urlBase}/${id.split("/").map(encodeURIComponent).join("/")}/${replayFile}`;
          races.push(
            summarizeRace(id, url, loaded.src, {
              trackName: nameOf(loaded.src.trackId) ?? loaded.trackName,
              time,
            }),
          );
        }
      } catch {
        // An unreadable or half-written result is left out of the list rather than failing it.
      }
    }
    if (depth >= MAX_DEPTH) return;
    for (const n of names) {
      if (n.startsWith(".") || n === "node_modules") continue;
      const p = join(dir, n);
      if (statSync(p, { throwIfNoEntry: false })?.isDirectory()) visit(p, depth + 1);
    }
  };
  visit(resultsDir, 0);
  return { races: sortRaces(races) };
}
