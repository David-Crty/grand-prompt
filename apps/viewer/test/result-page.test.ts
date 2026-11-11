import { describe, expect, it } from "vitest";
import {
  alsoRaced,
  circuitDrivers,
  circuits,
  eventEffort,
  formatSpeed,
  formatTick,
  labelLanes,
  stripAt,
  stripScale,
} from "../src/lib/result-page.js";
import type { EventResults } from "../src/lib/results.js";

const builds = (...efforts: (string | undefined)[]): EventResults => ({
  event: { id: "e", name: "e" },
  rows: efforts.map((effort, i) => ({ slug: `m${i}`, manifest: effort ? { settings: { effort } } : null })),
});

describe("results page", () => {
  it("names the effort the event's builds share", () => {
    expect(eventEffort(builds("high", "high", undefined))).toBe("high");
    expect(eventEffort(builds("high", "medium"))).toBeNull();
    expect(eventEffort(builds(undefined))).toBeNull();
    expect(eventEffort(null)).toBeNull();
  });

  it("puts every event of a circuit on one axis of whole ticks", () => {
    const s = stripScale([94.51, 130.2, 114.6])!;
    expect(s).toEqual({ from: 90, to: 140, ticks: [90, 100, 110, 120, 130, 140] });
    expect(stripScale([94.51, 129.69])?.ticks).toEqual([90, 95, 100, 105, 110, 115, 120, 125, 130]);
    expect(stripAt(90, s)).toBe(0);
    expect(stripAt(115, s)).toBe(0.5);
    expect(stripAt(200, s)).toBe(1);
    expect(stripAt(10, s)).toBe(0);
    expect(stripScale([61])).toEqual({ from: 61, to: 62, ticks: [61, 62] });
    expect(stripScale([60, 1000])?.ticks.length).toBeLessThanOrEqual(9);
    expect(stripScale([])).toBeNull();
    expect(formatTick(95)).toBe("1:35");
    expect(formatTick(119.6)).toBe("2:00");
    expect(formatSpeed(92.4169)).toBe("333 km/h");
  });

  it("keeps labels apart, row by row", () => {
    expect(labelLanes([0, 100, 200], 40, 3)).toEqual([0, 0, 0]);
    expect(labelLanes([110, 100, 120, 300], 40, 2)).toEqual([1, 0, 0, 0]);
    expect(labelLanes([0, 10, 20], 40, 1)).toEqual([0, 0, 0]);
    expect(labelLanes([0, 1], 40, 0)).toEqual([0, 0]);
  });

  it("lists who raced the circuit only in other events, and every model once", () => {
    const races = [
      { event: "high", drivers: [{ id: "a", name: "A" }] },
      {
        event: "medium",
        drivers: [
          { id: "a", name: "A" },
          { id: "c", name: "C" },
          { id: "b", name: "B" },
        ],
      },
      { event: "low", drivers: [{ id: "b", name: "B" }] },
    ];
    expect(alsoRaced(races, "high")).toEqual([
      { id: "b", name: "B", events: ["medium", "low"] },
      { id: "c", name: "C", events: ["medium"] },
    ]);
    expect(alsoRaced(races, "medium")).toEqual([]);
    expect(alsoRaced(races, "nope").map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(circuitDrivers(races).map((d) => d.id)).toEqual(["a", "c", "b"]);
  });

  it("lists each circuit once, by name", () => {
    expect(
      circuits([
        { track: "ring", trackName: "Ring" },
        { track: "monaco", trackName: "Monaco" },
        { track: "ring", trackName: "Ring" },
      ]),
    ).toEqual([
      { track: "monaco", name: "Monaco" },
      { track: "ring", name: "Ring" },
    ]);
  });
});
