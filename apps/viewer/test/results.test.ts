import type { ClassifiedResult } from "@bench/sim";
import { describe, expect, it } from "vitest";
import type { Incident } from "../src/lib/incidents.js";
import {
  buildCost,
  buildFacts,
  classificationRows,
  type EventResults,
  formatBuildTime,
  formatTokens,
} from "../src/lib/results.js";

const prices = {
  models: {
    "gpt-x": { inputPerM: 1, cachedInputPerM: 0.1, cacheWritePerM: 1.25, outputPerM: 10 },
    "gpt-y": { inputPerM: 1, outputPerM: 10 },
  },
};
const manifest = (usage: object) => ({ usage, settings: { timeLimitMin: 30 } });
const results: EventResults = {
  event: { id: "r1-medium", name: "r1-medium" },
  rows: [
    {
      slug: "gpt-x",
      manifest: manifest({ inputTokens: 2e6, outputTokens: 1e5, wallTimeS: 882 }),
    },
    {
      slug: "claude-y",
      manifest: manifest({ inputTokens: 5e5, outputTokens: 1e4, costUsd: 0.59, wallTimeS: 153 }),
    },
    { slug: "gpt-z", manifest: manifest({ inputTokens: 1e6, outputTokens: 1e4 }) },
    { slug: "none", manifest: null },
  ],
};

const lap = (time: number, sectors: number[], valid = true) => ({ time, sectors, valid });
const row = (o: Partial<ClassifiedResult> & { id: string }): ClassifiedResult =>
  ({
    name: o.id,
    status: "FINISHED",
    position: 1,
    gap: null,
    lap: null,
    lapTime: 50,
    color: "",
    driverHash: "",
    ...o,
  }) as ClassifiedResult;

describe("build facts and cost", () => {
  it("takes the CLI's cost, or estimates it from tokens and list prices, marked as such", () => {
    expect(buildCost("claude-y", { costUsd: 0.59 }, prices)).toEqual({ usd: 0.59, estimated: false });
    expect(buildCost("gpt-x", { inputTokens: 2e6, outputTokens: 1e5 }, prices)).toEqual({
      usd: 3,
      estimated: true,
    });
    const cached = { inputTokens: 2e6, cachedInputTokens: 1.5e6, cacheWriteTokens: 1e5, outputTokens: 1e5 };
    expect(buildCost("gpt-x", cached, prices)!.usd).toBeCloseTo(0.4 * 1 + 1.5 * 0.1 + 0.1 * 1.25 + 0.1 * 10);
    expect(buildCost("gpt-y", cached, prices)!.usd).toBeCloseTo(3);
    expect(buildCost("gpt-z", { inputTokens: 1, outputTokens: 1 }, prices)).toBeNull();
    expect(buildCost("gpt-x", { inputTokens: 1 }, prices)).toBeNull();
    expect(buildCost("gpt-x", undefined, prices)).toBeNull();
    const f = buildFacts("claude-y", results, prices)!;
    expect(f).toMatchObject({ tokensIn: 5e5, wallTimeS: 153 });
    expect(buildFacts("gpt-z", results, prices)!.wallTimeS).toBeNull();
    expect(buildFacts("none", results, prices)).toBeNull();
    expect(buildFacts("gpt-x", null, prices)).toBeNull();
    const bare = buildFacts(
      "b",
      { event: results.event, rows: [{ slug: "b", manifest: { usage: {} } }] },
      prices,
    )!;
    expect([bare.tokensIn, bare.tokensOut]).toEqual([0, 0]);
    expect(formatTokens(2.17e6)).toBe("2.17M");
    expect(formatTokens(649e3)).toBe("649k");
    expect(formatBuildTime(882)).toBe("14m42");
    expect(formatBuildTime(57)).toBe("0m57");
    expect(formatBuildTime(null)).toBe("–");
  });
});

describe("classification rows", () => {
  const incident = { carId: "son", corner: 2 } as Incident;
  const rows = classificationRows(
    [
      row({ id: "gpt-x", position: 1, lapTime: 48.5, lap: lap(48.5, [16, 17, 15.5]) }),
      row({ id: "claude-y", position: 2, gap: 5.057, lapTime: 53.557, lap: lap(53.557, [15.9, 19, 18.657]) }),
      row({ id: "del", position: 3, lapTime: null, lap: lap(40, [10, 10, 20], false) }),
      row({ id: "tu", position: 4, status: "TIME UP", lapTime: null }),
      row({ id: "son", position: 5, status: "DNF: CRASHED", lapTime: null }),
      row({ id: "ecu", position: 6, status: "DNF: ECU FAILURE", lapTime: null }),
      row({ id: "st", position: 7, status: "DNF: STALLED", lapTime: null }),
      row({ id: "odd", position: 8, status: "DNF: GONE" as ClassifiedResult["status"], lapTime: null }),
    ],
    [incident, { carId: "ecu", corner: null } as Incident],
    results,
    prices,
  );
  it("shapes the table: positions, gaps, why a car has no time, sectors and build facts", () => {
    expect(rows.map((r) => r.position)).toEqual([1, 2, null, null, null, null, null, null]);
    expect(rows[0]!.gap).toBeNull();
    expect(rows[1]!.gap).toBe(5.057);
    expect(rows.map((r) => r.outText)).toEqual([
      null,
      null,
      "Lap deleted: track limits",
      "Time up",
      "Crashed · T2",
      "Driver failed",
      "Stalled",
      "GONE",
    ]);
    expect(rows.map((r) => [r.out, r.deleted])).toEqual([
      [false, false],
      [false, false],
      [false, true],
      [false, false],
      [true, false],
      [true, false],
      [true, false],
      [true, false],
    ]);
    expect(rows[0]!.sectors).toEqual([
      { time: 16, fastest: false },
      { time: 17, fastest: true },
      { time: 15.5, fastest: true },
    ]);
    expect(rows[1]!.sectors!.map((s) => s.fastest)).toEqual([true, false, false]);
    expect(rows[2]!.sectors).toBeNull();
    expect(rows[0]!.build?.cost).toEqual({ usd: 3, estimated: true });
    expect(rows[2]!.lapTime).toBeNull();
    expect(classificationRows([row({ id: "n", position: 9 })], [], null, prices)[0]!.sectors).toBeNull();
  });
});
