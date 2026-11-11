import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type EventResultsSource,
  formatEffort,
  formatResult,
  isEventResults,
  POINTS,
  racePoints,
  raceTracks,
  standings,
  summarizeDrivers,
} from "../src/lib/drivers.js";
import { trackOutline } from "../src/lib/outline.js";

const coords = (path: string) =>
  [...path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);

describe("trackOutline", () => {
  it("fits a circuit in its box, laid on its long side, and measures it", () => {
    const tall = [
      [0, 0],
      [10, 0],
      [10, 100],
      [0, 100],
    ];
    const o = trackOutline(tall, undefined, 160, 100)!;
    expect(o.length).toBe(220);
    expect(o.path.startsWith("M")).toBe(true);
    expect(o.path.endsWith("Z")).toBe(true);
    const pts = coords(o.path);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    for (const p of pts) {
      expect(p[0]).toBeGreaterThanOrEqual(-0.05);
      expect(p[0]).toBeLessThanOrEqual(160.05);
      expect(p[1]).toBeGreaterThanOrEqual(-0.05);
      expect(p[1]).toBeLessThanOrEqual(100.05);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(150);
  });

  it("keeps about maxPoints vertices", () => {
    const ring = Array.from({ length: 1000 }, (_, i) => {
      const a = (i / 1000) * 2 * Math.PI;
      return [Math.cos(a) * 500, Math.sin(a) * 300, 6, 6];
    });
    expect(coords(trackOutline(ring, undefined, 160, 100, 100)!.path)).toHaveLength(100);
  });

  it("refuses what is not a circuit", () => {
    expect(trackOutline(undefined)).toBeNull();
    expect(trackOutline([[0, 0], [1, 1], ["x", 2], null])).toBeNull();
  });
});

describe("drivers", () => {
  const race = (ev: string, track: string, rows: EventResultsSource["rows"]) => ({
    src: { event: { id: ev }, track, rows },
    trackName: track.toUpperCase(),
  });

  it("recognises a race's table", () => {
    expect(isEventResults({ event: { id: "e" }, track: "t", rows: [{ slug: "a", name: "A" }] })).toBe(true);
    expect(isEventResults(null)).toBe(false);
    expect(isEventResults({ event: { id: "e" }, rows: [] })).toBe(false);
    expect(isEventResults({ event: { id: 1 }, track: "t", rows: [] })).toBe(false);
    expect(isEventResults({ event: { id: "e" }, track: "t", rows: [{ slug: "a" }] })).toBe(false);
  });

  it("keeps one row per model and event, its races by circuit, rows by name then event", () => {
    const build = { settings: { effort: "cli-default" } };
    const rows = summarizeDrivers([
      race("e1", "b", [{ slug: "x", name: "Beta", manifest: build }]),
      race("e1", "a", [
        { slug: "x", name: "Beta", manifest: build },
        { slug: "y", name: "Alpha", position: 1, lapTime: 9 },
      ]),
      race("e0", "a", [
        { slug: "y", name: "Alpha", position: 2, lapTime: 8 },
        { slug: "z", name: "Alpha" },
      ]),
    ]);
    expect(rows.map((d) => `${d.id}@${d.event}`)).toEqual(["y@e0", "y@e1", "z@e0", "x@e1"]);
    expect(rows[3]).toMatchObject({ effort: "cli-default", provider: null, usage: null });
    expect(rows[3]!.results.map((r) => r.track)).toEqual(["a", "b"]);
    expect(rows[1]!.results).toEqual([{ track: "a", trackName: "A", position: 1, lapTime: 9 }]);
    expect(rows.map((d) => d.points)).toEqual([8, 10, 0, 0]);
    expect(raceTracks(rows)).toEqual([
      { track: "a", trackName: "A" },
      { track: "b", trackName: "B" },
    ]);
    expect(
      summarizeDrivers([
        race("e", "a", [{ slug: "q", name: "Q" }]),
        race("e", "b", [{ slug: "q", name: "Q" }]),
      ])[0]!.results,
    ).toHaveLength(2);
  });

  it("scores every race the same and orders the standings by points", () => {
    const rows = summarizeDrivers([
      race("e1", "a", [
        { slug: "x", name: "Xan", position: 1, lapTime: 60 },
        { slug: "y", name: "Ann", position: 2, lapTime: 61 },
        { slug: "z", name: "Bob", position: 3, lapTime: null },
      ]),
      race("e1", "b", [
        { slug: "y", name: "Ann", position: 1, lapTime: 70 },
        { slug: "x", name: "Xan", position: 2, lapTime: 71 },
        { slug: "z", name: "Bob", position: 3, lapTime: 72 },
      ]),
    ]);
    expect(rows.map((d) => [d.id, d.points])).toEqual([
      ["y", 18],
      ["z", 6],
      ["x", 18],
    ]);
    expect(standings(rows).map((d) => `${d.place} ${d.name}`)).toEqual(["1 Ann", "1 Xan", "3 Bob"]);
  });

  it("gives points to the first eight with a valid lap", () => {
    expect(POINTS).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
    expect(racePoints(8, 99)).toBe(1);
    expect(racePoints(9, 100)).toBe(0);
    expect(racePoints(1, null)).toBe(0);
    expect(racePoints(null, 90)).toBe(0);
  });

  it("gives the points the models are told about", () => {
    const task = readFileSync(
      new URL("../../../driver-development-kit/PROMPT_AGENTIC.md", import.meta.url),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(POINTS).toHaveLength(8);
    expect(task).toContain(`${POINTS.join(", ")} for the first eight valid laps`);
  });

  it("formats effort and result", () => {
    expect(formatEffort("cli-default")).toBe("CLI default");
    expect(formatEffort("low")).toBe("low");
    expect(formatEffort(null)).toBe("–");
    expect(formatResult({ position: 3, lapTime: 90 })).toBe("P3");
    expect(formatResult({ position: 3, lapTime: null })).toBe("DNF");
    expect(formatResult({ position: null, lapTime: 90 })).toBe("DNF");
  });
});
