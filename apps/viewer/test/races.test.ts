import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanResults } from "../server/results-index.js";
import {
  clusterDots,
  fieldSpread,
  filterRaces,
  formatDate,
  formatLength,
  type RaceSource,
  readReveal,
  sortRaces,
  summarizeRace,
  timedField,
  writeReveal,
} from "../src/lib/races.js";

type Row = RaceSource["classification"][number];

function row(over: Partial<Row> & Pick<Row, "id" | "position">): Row {
  return {
    name: over.id,
    lapTime: 80,
    ...over,
  };
}

function source(over: Partial<RaceSource> = {}): RaceSource {
  return {
    trackId: "monaco",
    classification: [
      row({ id: "b", position: 2, lapTime: 80.5 }),
      row({ id: "a", position: 1, lapTime: 80 }),
      row({ id: "c", position: 3, lapTime: null }),
    ],
    ...over,
  };
}

describe("summarizeRace", () => {
  it("keeps the field in classification order", () => {
    const outline = { width: 160, height: 100, path: "M0 0Z", length: 3300 };
    const r = summarizeRace("monaco-001", source(), { track: { name: "Monaco", outline }, time: 1000 });
    expect(r).toEqual({
      id: "monaco-001",
      trackName: "Monaco",
      outline,
      time: 1000,
      drivers: [
        { id: "a", name: "a", time: 80 },
        { id: "b", name: "b", time: 80.5 },
        { id: "c", name: "c", time: null },
      ],
    });
  });

  it("falls back to the track id", () => {
    const r = summarizeRace("demo", source(), { time: 0 });
    expect(r.trackName).toBe("monaco");
    expect(r.outline).toBeNull();
  });
});

describe("race list helpers", () => {
  const mk = (id: string, time: number, name = "Monaco") =>
    summarizeRace(id, source(), { track: { name }, time });

  it("sorts by circuit, then newest first, ties by id", () => {
    const sorted = sortRaces([mk("b", 1), mk("a", 1), mk("c", 5), mk("d", 9, "Barcelona")]);
    expect(sorted.map((r) => r.id)).toEqual(["d", "c", "a", "b"]);
  });

  it("filters on the circuit name only, every term", () => {
    const races = [mk("race/monaco-001", 1), mk("race/silverstone-001", 1, "Silverstone Circuit")];
    expect(filterRaces(races, "")).toBe(races);
    expect(filterRaces(races, " silver ").map((r) => r.id)).toEqual(["race/silverstone-001"]);
    expect(filterRaces(races, "SILVERSTONE circ")).toHaveLength(1);
    expect(filterRaces(races, "race")).toHaveLength(0);
    expect(filterRaces(races, "o")).toHaveLength(2);
    expect(filterRaces(races, "monaco silverstone")).toHaveLength(0);
  });

  it("formats dates and lengths", () => {
    expect(formatDate(new Date(2026, 10, 9, 8, 5).getTime())).toBe("9 Nov 2026");
    expect(formatDate(Number.NaN)).toBe("--");
    expect(formatLength(3307)).toBe("3.31 km");
  });

  it("places the timed field between pole and the slowest timed car", () => {
    const r = mk("race/a", 1);
    expect(timedField(r).map((d) => [d.id, d.gap])).toEqual([
      ["a", 0],
      ["b", 0.5],
    ]);
    expect(fieldSpread(r)).toMatchObject({
      dots: [
        { id: "a", at: 0, gap: 0 },
        { id: "b", at: 1, gap: 0.5 },
      ],
      span: 0.5,
    });
    expect(fieldSpread(r).dots[1]).toMatchObject({ name: r.drivers[1]!.name, time: r.drivers[1]!.time });
    const one = summarizeRace("r", source({ classification: [row({ id: "a", position: 1 })] }), {
      time: 0,
    });
    expect(fieldSpread(one)).toMatchObject({ dots: [{ id: "a", at: 0, gap: 0 }], span: 0 });
    const none = summarizeRace("r", source({ classification: [] }), { time: 0 });
    expect(fieldSpread(none)).toEqual({ dots: [], span: 0 });
  });
});

describe("spread clusters", () => {
  it("groups dots closer than the limit to their neighbour, in order", () => {
    const at = (...xs: number[]) => xs.map((x, i) => ({ id: String(i), at: x }));
    const groups = clusterDots(at(0.5, 0, 0.03, 0.06, 1), 0.04);
    expect(groups.map((g) => [g.from, g.to, g.dots.map((d) => d.id)])).toEqual([
      [0, 0.06, ["1", "2", "3"]],
      [0.5, 0.5, ["0"]],
      [1, 1, ["4"]],
    ]);
    expect(clusterDots([], 0.1)).toEqual([]);
  });
});

describe("hidden results", () => {
  it("keeps results hidden unless the viewer chose to see them", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(readReveal(storage)).toBe(false);
    writeReveal(storage, true);
    expect(readReveal(storage)).toBe(true);
    writeReveal(storage, false);
    expect(readReveal(storage)).toBe(false);
    expect(readReveal(null)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readReveal(broken)).toBe(false);
    expect(() => writeReveal(broken, true)).not.toThrow();
    expect(() => writeReveal(undefined, true)).not.toThrow();
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
    const square = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    writeFileSync(
      join(tracks, "monaco.json"),
      JSON.stringify({ id: "monaco", name: "Monaco", points: square }),
    );
    writeFileSync(join(tracks, "broken.json"), "{");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const dir = (id: string) => {
    const d = join(results, "races", id);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const touch = (path: string, sec: number) => utimesSync(path, sec, sec);
  const race = (id: string, src: object | string = source()) => {
    const d = dir(id);
    writeFileSync(join(d, "replay.json.gz"), gzipSync("{}"));
    writeFileSync(join(d, "results.json"), typeof src === "string" ? src : JSON.stringify(src));
    return d;
  };

  it("lists every race under results/races/, and skips bad entries", () => {
    const a = race("monaco-001");
    touch(join(a, "replay.json.gz"), 100);
    touch(join(a, "results.json"), 200);
    const ev = race("my event", source({ trackId: "ring" }));
    touch(join(ev, "replay.json.gz"), 50);
    touch(join(ev, "results.json"), 50);

    race("not-a-result", { not: "a result" });
    race("broken", "{");
    writeFileSync(join(dir("replay-less"), "results.json"), JSON.stringify(source()));
    race(".hidden");
    writeFileSync(join(results, "races", "stray.json"), "{}");
    const practice = join(results, "practice", "baseline-001");
    mkdirSync(practice, { recursive: true });
    writeFileSync(join(practice, "replay.json.gz"), gzipSync("{}"));
    writeFileSync(join(practice, "results.json"), JSON.stringify(source()));

    const { races } = scanResults(results, tracks);
    expect(races.map((r) => r.id)).toEqual(["monaco-001", "my event"]);
    const [m, e] = races;
    expect(m!.trackName).toBe("Monaco");
    expect(m!.outline?.length).toBe(400);
    expect(m!.time).toBe(200_000);
    expect(e!.trackName).toBe("ring");
    expect(e!.outline).toBeNull();
  });

  it("uses no track name for unreadable track files", () => {
    race("x", source({ trackId: "broken" }));
    race("y", source({ trackId: "broken" }));
    expect(scanResults(results, tracks).races.map((r) => r.trackName)).toEqual(["broken", "broken"]);
  });

  it("lists the models that raced, with their results in their newest event", () => {
    const table = (id: string, ev: string, track: string, sec: number, rows: object[]) => {
      const f = join(dir(id), "event-results.json");
      writeFileSync(f, JSON.stringify({ event: { id: ev }, track, rows }));
      touch(f, sec);
    };
    const manifest = {
      provider: "openai",
      usage: { inputTokens: 10, outputTokens: 2, wallTimeS: 60, practiceRuns: 3 },
      settings: { cli: "codex", effort: "low" },
    };
    table("old-monaco", "old", "monaco", 100, [
      { slug: "m1", name: "Model One", position: 2, lapTime: 90 },
      { slug: "m2", name: "Another", position: 1, lapTime: 89, manifest },
    ]);
    table("new-monaco", "new", "monaco", 200, [
      { slug: "m1", name: "Model One", position: 1, lapTime: null },
    ]);
    table("new-ring", "new", "ring", 150, [{ slug: "m1", name: "Model One", position: 1, lapTime: 61 }]);
    writeFileSync(join(dir("bad"), "event-results.json"), "{");
    writeFileSync(join(dir("other"), "event-results.json"), JSON.stringify({ event: { id: "x" }, rows: [] }));

    const { drivers } = scanResults(results, tracks);
    expect(drivers.map((d) => [d.id, d.event])).toEqual([
      ["m2", "old"],
      ["m1", "new"],
    ]);
    expect(drivers[0]).toEqual({
      id: "m2",
      name: "Another",
      provider: "openai",
      effort: "low",
      event: "old",
      usage: manifest.usage,
      results: [{ track: "monaco", trackName: "Monaco", position: 1, lapTime: 89 }],
      points: 10,
    });
    expect(drivers[1]!.points).toBe(8 + 0 + 10);
    expect(drivers[1]).toMatchObject({ provider: null, effort: null, usage: null });
    expect(drivers[1]!.results).toEqual([
      { track: "monaco", trackName: "Monaco", position: 1, lapTime: null },
      { track: "ring", trackName: "ring", position: 1, lapTime: 61 },
    ]);
  });

  it("returns nothing for a missing directory", () => {
    expect(scanResults(join(root, "nope"), tracks)).toEqual({ races: [], drivers: [] });
  });
});
