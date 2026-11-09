import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanResults } from "../server/results-index.js";
import {
  filterRaces,
  formatDate,
  type RaceSource,
  sessionLabel,
  sortRaces,
  summarizeRace,
  watchHref,
} from "../src/lib/races.js";

type Row = RaceSource["classification"][number];

function row(over: Partial<Row> & Pick<Row, "id" | "position">): Row {
  return {
    name: over.id,
    color: "#fff",
    status: "FINISHED",
    bestLap: 80,
    totalTime: 240,
    finishTime: 240,
    lapsCompleted: 3,
    ...over,
  };
}

function source(over: Partial<RaceSource> = {}): RaceSource {
  return {
    simVersion: "0.1.0",
    trackId: "monaco",
    session: { type: "race", laps: 3, seed: 7 },
    classification: [
      row({ id: "b", position: 2, bestLap: 79.5, totalTime: 241, color: "#00f" }),
      row({ id: "a", position: 1, bestLap: 80, totalTime: 240, color: "#f00" }),
      row({ id: "c", position: 3, status: "DNF: CRASHED", bestLap: null, totalTime: null }),
    ],
    ...over,
  };
}

describe("summarizeRace", () => {
  it("picks the winner, the fastest lap and counts finishers", () => {
    const r = summarizeRace("race/monaco-001", "/results/race/monaco-001/replay.json.gz", source(), {
      trackName: "Monaco",
      time: 1000,
    });
    expect(r).toMatchObject({
      group: "race",
      trackName: "Monaco",
      type: "race",
      laps: 3,
      seed: 7,
      cars: 3,
      finished: 2,
      time: 1000,
      winner: { id: "a", color: "#f00", time: 240, status: "FINISHED" },
      fastest: { id: "b", time: 79.5 },
    });
    expect(r.drivers.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("uses the best lap as P1's time outside races and falls back to the track id", () => {
    const r = summarizeRace("demo", "/x", source({ session: { type: "qualify", laps: 1, seed: 1 } }), {
      time: 0,
    });
    expect(r.trackName).toBe("monaco");
    expect(r.group).toBe("demo");
    expect(r.winner?.time).toBe(80);
  });

  it("falls back to finishTime and copes with an empty field", () => {
    const one = source({
      classification: [row({ id: "a", position: 1, totalTime: null, finishTime: 250 })],
    });
    expect(summarizeRace("r", "/x", one, { time: 0 }).winner?.time).toBe(250);
    const none = summarizeRace("r", "/x", source({ classification: [] }), { time: 0 });
    expect(none.winner).toBeNull();
    expect(none.fastest).toBeNull();
  });
});

describe("race list helpers", () => {
  const mk = (id: string, time: number, trackName = "Monaco") =>
    summarizeRace(id, `/results/${id}/replay.json.gz`, source(), { trackName, time });

  it("sorts newest first, ties by id", () => {
    const sorted = sortRaces([mk("b", 1), mk("a", 1), mk("c", 5)]);
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("filters on every term across track, session, group and drivers", () => {
    const races = [mk("race/monaco-001", 1), mk("race/silverstone-001", 1, "Silverstone")];
    expect(filterRaces(races, "")).toBe(races);
    expect(filterRaces(races, "silver").map((r) => r.id)).toEqual(["race/silverstone-001"]);
    expect(filterRaces(races, "SILVERSTONE race a")).toHaveLength(1);
    expect(filterRaces(races, "monaco nobody")).toHaveLength(0);
  });

  it("formats dates, session labels and links", () => {
    expect(formatDate(new Date(2026, 10, 9, 8, 5).getTime())).toBe("2026-11-09 08:05");
    expect(formatDate(Number.NaN)).toBe("--");
    expect(sessionLabel({ type: "race", laps: 1 })).toBe("Race · 1 lap");
    expect(sessionLabel({ type: "qualify", laps: 2 })).toBe("Qualifying · 2 laps");
    expect(sessionLabel({ type: "practice", laps: 5 })).toBe("Practice · 5 laps");
    expect(watchHref("/results/race/a b/replay.json.gz")).toBe(
      "?replay=%2Fresults%2Frace%2Fa%20b%2Freplay.json.gz",
    );
  });
});

describe("scanResults", () => {
  let root: string;
  let results: string;
  let tracks: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "races-"));
    results = join(root, "results");
    tracks = join(root, "tracks");
    mkdirSync(results);
    mkdirSync(tracks);
    writeFileSync(join(tracks, "monaco.json"), JSON.stringify({ id: "monaco", name: "Monaco" }));
    writeFileSync(join(tracks, "broken.json"), "{");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const dir = (rel: string) => {
    const d = join(results, rel);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const touch = (path: string, sec: number) => utimesSync(path, sec, sec);

  it("lists replays with results.json, falls back to the replay, and skips bad entries", () => {
    const a = dir("race/monaco-001");
    writeFileSync(join(a, "replay.json.gz"), gzipSync("{}"));
    writeFileSync(join(a, "results.json"), JSON.stringify(source()));
    touch(join(a, "replay.json.gz"), 100);
    touch(join(a, "results.json"), 200);

    const demo = dir("demo");
    const replay = {
      header: { simVersion: "0.1.0", trackId: "ring", session: { type: "race", laps: 2, seed: 1 } },
      track: { name: "Ring from replay" },
      classification: [row({ id: "x", position: 1 })],
    };
    writeFileSync(join(demo, "replay.json"), JSON.stringify(replay));
    touch(join(demo, "replay.json"), 300);

    const ev = dir("my event/race");
    writeFileSync(
      join(ev, "replay.json.gz"),
      gzipSync(JSON.stringify({ ...replay, classification: undefined })),
    );
    writeFileSync(join(ev, "results.json"), JSON.stringify({ not: "a result" }));
    touch(join(ev, "replay.json.gz"), 50);
    touch(join(ev, "results.json"), 50);

    const broken = dir("race/broken-001");
    writeFileSync(join(broken, "replay.json.gz"), "not gzip");
    const headless = dir("race/headless-001");
    writeFileSync(join(headless, "replay.json"), "{}");
    const badHeader = dir("race/bad-header-001");
    writeFileSync(join(badHeader, "replay.json"), JSON.stringify({ header: { trackId: 3 } }));
    dir("practice/empty");
    dir(".hidden/race");
    writeFileSync(join(results, ".hidden/race/replay.json"), JSON.stringify(replay));
    writeFileSync(join(results, "replay.json"), JSON.stringify(replay));
    symlinkSync(join(root, "missing"), join(results, "dangling"));
    dir("a/b/c/d/e/f");
    writeFileSync(join(results, "a/b/c/d/e/f/replay.json"), JSON.stringify(replay));

    const { races } = scanResults(results, tracks);
    expect(races.map((r) => r.id)).toEqual(["demo", "race/monaco-001", "my event/race"]);
    const [d, m, e] = races;
    expect(d!.trackName).toBe("Ring from replay");
    expect(d!.replay).toBe("/results/demo/replay.json");
    expect(m!.trackName).toBe("Monaco");
    expect(m!.time).toBe(200_000);
    expect(m!.replay).toBe("/results/race/monaco-001/replay.json.gz");
    expect(e!.replay).toBe("/results/my%20event/race/replay.json.gz");
    expect(e!.group).toBe("my event");
    expect(e!.cars).toBe(0);
  });

  it("uses no track name for unreadable track files", () => {
    const a = dir("race/x");
    writeFileSync(join(a, "results.json"), JSON.stringify(source({ trackId: "broken" })));
    writeFileSync(join(a, "replay.json.gz"), gzipSync("{}"));
    const b = dir("race/y");
    writeFileSync(join(b, "results.json"), JSON.stringify(source({ trackId: "broken" })));
    writeFileSync(join(b, "replay.json.gz"), gzipSync("{}"));
    expect(scanResults(results, tracks).races.map((r) => r.trackName)).toEqual(["broken", "broken"]);
  });

  it("returns nothing for a missing directory", () => {
    expect(scanResults(join(root, "nope"), tracks).races).toEqual([]);
  });
});
