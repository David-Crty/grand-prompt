import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSiteConfig, scanResults } from "../server/results-index.js";
import {
  clusterDots,
  fieldSpread,
  filterRaces,
  formatDate,
  formatLength,
  pickEvent,
  type RaceSource,
  sortEvents,
  sortRaces,
  summarizeRace,
  timedField,
  trackEvents,
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

const at = (event: string) => ({ track: "monaco", event });

describe("summarizeRace", () => {
  it("keeps the field in classification order", () => {
    const outline = { width: 160, height: 100, path: "M0 0Z", length: 3300 };
    const r = summarizeRace(at("r1-medium"), source(), { track: { name: "Monaco", outline }, time: 1000 });
    expect(r).toEqual({
      id: "monaco/r1-medium",
      track: "monaco",
      event: "r1-medium",
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
    const r = summarizeRace(at("demo"), source(), { time: 0 });
    expect(r.trackName).toBe("monaco");
    expect(r.outline).toBeNull();
  });
});

describe("race list helpers", () => {
  const mk = (event: string, time: number, name = "Monaco") =>
    summarizeRace(at(event), source(), { track: { name }, time });

  it("sorts by circuit, then newest first, ties by id", () => {
    const sorted = sortRaces([mk("b", 1), mk("a", 1), mk("c", 5), mk("d", 9, "Barcelona")]);
    expect(sorted.map((r) => r.event)).toEqual(["d", "c", "a", "b"]);
  });

  it("filters on the circuit name only, every term", () => {
    const races = [mk("race/monaco-001", 1), mk("race/silverstone-001", 1, "Silverstone Circuit")];
    expect(filterRaces(races, "")).toBe(races);
    expect(filterRaces(races, " silver ").map((r) => r.event)).toEqual(["race/silverstone-001"]);
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
    const one = summarizeRace(at("r"), source({ classification: [row({ id: "a", position: 1 })] }), {
      time: 0,
    });
    expect(fieldSpread(one)).toMatchObject({ dots: [{ id: "a", at: 0, gap: 0 }], span: 0 });
    const none = summarizeRace(at("r"), source({ classification: [] }), { time: 0 });
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

describe("events", () => {
  it("orders events by name, numbers by value", () => {
    expect(sortEvents(["r10-medium", "r2-medium", "r1-medium", "r1-high", "r2-medium"])).toEqual([
      "r1-high",
      "r1-medium",
      "r2-medium",
      "r10-medium",
    ]);
  });

  it("lists the events that raced on a circuit", () => {
    const races = [at("r2"), at("r10"), { track: "ring", event: "r3" }, at("r2")];
    expect(trackEvents(races, "monaco")).toEqual(["r2", "r10"]);
    expect(trackEvents(races, "nope")).toEqual([]);
  });

  it("shows the event asked for, else the default, else the first", () => {
    const events = ["r1-high", "r1-medium"];
    expect(pickEvent("r1-high", events, "r1-medium")).toBe("r1-high");
    expect(pickEvent(undefined, events, "r1-medium")).toBe("r1-medium");
    expect(pickEvent("nope", events, "r1-medium")).toBe("r1-medium");
    expect(pickEvent(undefined, events, "gone")).toBe("r1-high");
    expect(pickEvent(undefined, events, null)).toBe("r1-high");
    expect(pickEvent("r1-high", [], "r1-high")).toBeNull();
  });
});

describe("readSiteConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "site-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const config = (text: string) => {
    writeFileSync(join(dir, "site.json"), text);
    return readSiteConfig(join(dir, "site.json"));
  };

  it("reads the default event, and none without the file or the key", () => {
    expect(config('{ "defaultEvent": "r1-medium" }')).toEqual({ defaultEvent: "r1-medium" });
    expect(config("{}")).toEqual({ defaultEvent: null });
    expect(readSiteConfig(join(dir, "missing.json"))).toEqual({ defaultEvent: null });
  });

  it("refuses a broken file or a default that is not an id", () => {
    expect(() => config("{")).toThrow(/site.json/);
    expect(() => config('{ "defaultEvent": 1 }')).toThrow(/defaultEvent is an event id/);
    expect(() => config('{ "defaultEvent": "" }')).toThrow(/defaultEvent is an event id/);
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

  it("lists every race under results/races/<track>/<event>/, and skips bad entries", () => {
    const a = race("monaco/e1");
    touch(join(a, "replay.json.gz"), 100);
    touch(join(a, "results.json"), 200);
    const ev = race("ring/my event", source({ trackId: "ring" }));
    touch(join(ev, "replay.json.gz"), 50);
    touch(join(ev, "results.json"), 50);

    race("x/not-a-result", { not: "a result" });
    race("x/broken", "{");
    writeFileSync(join(dir("x/replay-less"), "results.json"), JSON.stringify(source()));
    race("x/.hidden");
    race(".hidden/e1");
    race("one-level");
    writeFileSync(join(results, "races", "stray.json"), "{}");
    writeFileSync(join(results, "races", "x", "stray.json"), "{}");
    const practice = join(results, "practice", "baseline-001");
    mkdirSync(practice, { recursive: true });
    writeFileSync(join(practice, "replay.json.gz"), gzipSync("{}"));
    writeFileSync(join(practice, "results.json"), JSON.stringify(source()));

    const { races } = scanResults(results, tracks);
    expect(races.map((r) => [r.id, r.track, r.event])).toEqual([
      ["monaco/e1", "monaco", "e1"],
      ["ring/my event", "ring", "my event"],
    ]);
    const [m, e] = races;
    expect(m!.trackName).toBe("Monaco");
    expect(m!.outline?.length).toBe(400);
    expect(m!.time).toBe(200_000);
    expect(e!.trackName).toBe("ring");
    expect(e!.outline).toBeNull();
  });

  it("uses no track name for unreadable track files", () => {
    race("broken/x", source({ trackId: "broken" }));
    race("broken/y", source({ trackId: "broken" }));
    expect(scanResults(results, tracks).races.map((r) => r.trackName)).toEqual(["broken", "broken"]);
  });

  it("lists the models that raced, one row per event, and the events with races", () => {
    const table = (id: string, ev: string, track: string, rows: object[]) => {
      writeFileSync(join(dir(id), "event-results.json"), JSON.stringify({ event: { id: ev }, track, rows }));
    };
    const manifest = {
      provider: "openai",
      usage: { inputTokens: 10, outputTokens: 2, wallTimeS: 60, practiceRuns: 3 },
      settings: { cli: "codex", effort: "low" },
    };
    table("monaco/old", "old", "monaco", [
      { slug: "m1", name: "Model One", position: 2, lapTime: 90 },
      { slug: "m2", name: "Another", position: 1, lapTime: 89, manifest },
    ]);
    table("monaco/new", "new", "monaco", [{ slug: "m1", name: "Model One", position: 1, lapTime: null }]);
    table("ring/new", "new", "ring", [{ slug: "m1", name: "Model One", position: 1, lapTime: 61 }]);
    race("ring/new");
    race("monaco/tableless");
    writeFileSync(join(dir("x/bad"), "event-results.json"), "{");
    writeFileSync(
      join(dir("x/other"), "event-results.json"),
      JSON.stringify({ event: { id: "x" }, rows: [] }),
    );

    const index = scanResults(results, tracks, { defaultEvent: "new" });
    expect(index.races.map((r) => [r.id, r.event]).sort()).toEqual([
      ["monaco/tableless", "tableless"],
      ["ring/new", "new"],
    ]);
    expect(index.events).toEqual(["new", "tableless"]);
    expect(index.defaultEvent).toBe("new");
    const { drivers } = index;
    expect(drivers.map((d) => [d.id, d.event])).toEqual([
      ["m2", "old"],
      ["m1", "new"],
      ["m1", "old"],
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
    expect(drivers[1]!.points).toBe(0 + 10);
    expect(drivers[2]!.points).toBe(8);
    expect(drivers[1]).toMatchObject({ provider: null, effort: null, usage: null });
    expect(drivers[1]!.results).toEqual([
      { track: "monaco", trackName: "Monaco", position: 1, lapTime: null },
      { track: "ring", trackName: "ring", position: 1, lapTime: 61 },
    ]);
  });

  it("returns nothing for a missing directory", () => {
    expect(scanResults(join(root, "nope"), tracks)).toEqual({
      races: [],
      drivers: [],
      events: [],
      defaultEvent: null,
    });
  });
});
