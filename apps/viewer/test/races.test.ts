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
  sortRaces,
  summarizeRace,
  watchHref,
} from "../src/lib/races.js";

type Row = RaceSource["classification"][number];

function row(over: Partial<Row> & Pick<Row, "id" | "position">): Row {
  return {
    name: over.id,
    status: "FINISHED",
    lapTime: 80,
    ...over,
  };
}

function source(over: Partial<RaceSource> = {}): RaceSource {
  return {
    simVersion: "0.1.0",
    trackId: "monaco",
    session: { seed: 7 },
    classification: [
      row({ id: "b", position: 2, lapTime: 80.5 }),
      row({ id: "a", position: 1, lapTime: 80 }),
      row({ id: "c", position: 3, status: "DNF: CRASHED", lapTime: null }),
    ],
    ...over,
  };
}

describe("summarizeRace", () => {
  it("picks pole and counts the cars with a time", () => {
    const r = summarizeRace("qualify/monaco-001", "/results/qualify/monaco-001/replay.json.gz", source(), {
      trackName: "Monaco",
      time: 1000,
    });
    expect(r).toMatchObject({
      group: "qualify",
      trackName: "Monaco",
      seed: 7,
      cars: 3,
      timed: 2,
      time: 1000,
      pole: { id: "a", time: 80, status: "FINISHED" },
    });
    expect(r.drivers.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to the track id and copes with an empty field", () => {
    const r = summarizeRace("demo", "/x", source(), { time: 0 });
    expect(r.trackName).toBe("monaco");
    expect(r.group).toBe("demo");
    expect(summarizeRace("r", "/x", source({ classification: [] }), { time: 0 }).pole).toBeNull();
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

  it("formats dates and links", () => {
    expect(formatDate(new Date(2026, 10, 9, 8, 5).getTime())).toBe("2026-11-09 08:05");
    expect(formatDate(Number.NaN)).toBe("--");
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

  it("lists replays next to their results.json, and skips bad entries", () => {
    const a = dir("qualify/monaco-001");
    writeFileSync(join(a, "replay.json.gz"), gzipSync("{}"));
    writeFileSync(join(a, "results.json"), JSON.stringify(source()));
    touch(join(a, "replay.json.gz"), 100);
    touch(join(a, "results.json"), 200);

    const ev = dir("my event/qualify");
    writeFileSync(join(ev, "replay.json"), "{}");
    writeFileSync(join(ev, "results.json"), JSON.stringify(source({ trackId: "ring" })));
    touch(join(ev, "replay.json"), 50);
    touch(join(ev, "results.json"), 50);

    const notResult = dir("qualify/not-a-result");
    writeFileSync(join(notResult, "replay.json.gz"), gzipSync("{}"));
    writeFileSync(join(notResult, "results.json"), JSON.stringify({ not: "a result" }));
    const broken = dir("qualify/broken");
    writeFileSync(join(broken, "replay.json.gz"), gzipSync("{}"));
    writeFileSync(join(broken, "results.json"), "{");
    const replayOnly = dir("qualify/replay-only");
    writeFileSync(join(replayOnly, "replay.json"), "{}");
    dir("practice/empty");
    dir(".hidden/qualify");
    writeFileSync(join(results, ".hidden/qualify/replay.json"), "{}");
    writeFileSync(join(results, ".hidden/qualify/results.json"), JSON.stringify(source()));
    writeFileSync(join(results, "replay.json"), "{}");
    writeFileSync(join(results, "results.json"), JSON.stringify(source()));
    symlinkSync(join(root, "missing"), join(results, "dangling"));
    dir("a/b/c/d/e/f");
    writeFileSync(join(results, "a/b/c/d/e/f/replay.json"), "{}");
    writeFileSync(join(results, "a/b/c/d/e/f/results.json"), JSON.stringify(source()));

    const { races } = scanResults(results, tracks);
    expect(races.map((r) => r.id)).toEqual(["qualify/monaco-001", "my event/qualify"]);
    const [m, e] = races;
    expect(m!.trackName).toBe("Monaco");
    expect(m!.time).toBe(200_000);
    expect(m!.replay).toBe("/results/qualify/monaco-001/replay.json.gz");
    expect(e!.trackName).toBe("ring");
    expect(e!.replay).toBe("/results/my%20event/qualify/replay.json");
    expect(e!.group).toBe("my event");
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
