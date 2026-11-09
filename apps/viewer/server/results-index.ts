import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  type RaceEntry,
  type RaceIndex,
  type RaceSource,
  sortRaces,
  summarizeRace,
} from "../src/lib/races.js";

const REPLAY_FILES = ["replay.json.gz", "replay.json"];
const MAX_DEPTH = 4;

function isSource(v: unknown): v is RaceSource {
  const r = v as Partial<RaceSource> | null;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.trackId === "string" &&
    typeof r.session === "object" &&
    Array.isArray(r.classification) &&
    r.classification.every((c) => "lapTime" in c)
  );
}

function trackNames(tracksDir: string): (id: string) => string | undefined {
  const cache = new Map<string, string | undefined>();
  return (id) => {
    if (!cache.has(id)) {
      let name: string | undefined;
      try {
        const t = JSON.parse(readFileSync(join(tracksDir, `${id}.json`), "utf8")) as { name?: unknown };
        if (typeof t.name === "string") name = t.name;
      } catch {
        name = undefined;
      }
      cache.set(id, name);
    }
    return cache.get(id);
  };
}

/** Every directory under `resultsDir` holding a replay and its `results.json`, summarised for the race list. */
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
    if (replayFile && names.includes("results.json") && dir !== resultsDir) {
      try {
        const src = JSON.parse(readFileSync(join(dir, "results.json"), "utf8"));
        if (isSource(src)) {
          const id = relative(resultsDir, dir).split(sep).join("/");
          const time = Math.max(...[replayFile, "results.json"].map((f) => statSync(join(dir, f)).mtimeMs));
          const url = `${urlBase}/${id.split("/").map(encodeURIComponent).join("/")}/${replayFile}`;
          races.push(summarizeRace(id, url, src, { trackName: nameOf(src.trackId), time }));
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
