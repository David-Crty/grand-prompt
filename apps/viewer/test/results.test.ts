import type { ClassifiedResult } from "@bench/sim";
import { describe, expect, it } from "vitest";
import {
  analysisPicks,
  deltaSeries,
  lapProfile,
  lapProfiles,
  sectorRows,
  whereTimeGoes,
} from "../src/lib/analysis.js";
import { indexReplay } from "../src/lib/frames.js";
import type { Incident } from "../src/lib/incidents.js";
import {
  buildCost,
  buildFacts,
  caveat,
  classificationRows,
  type EventResults,
  formatBuildTime,
  formatTokens,
  POINTS,
} from "../src/lib/results.js";
import { makeCar, makeReplay, stadiumTrack } from "./fixtures.js";

const track = stadiumTrack();
const prices = { models: { "gpt-x": { inputPerM: 1, outputPerM: 10 } } };
const manifest = (cli: string, effort: string, usage: object, extra: object = {}) => ({
  usage,
  settings: { cli, effort, timeLimitMin: 30, ...extra },
  provider: cli === "codex" ? "openai" : "anthropic",
});
const results: EventResults = {
  event: { id: "gp-1", name: "gp-1" },
  rows: [
    {
      slug: "gpt-x",
      manifest: manifest("codex", "low", {
        inputTokens: 2e6,
        outputTokens: 1e5,
        wallTimeS: 882,
        practiceRuns: 10,
      }),
    },
    {
      slug: "claude-y",
      manifest: manifest("claude", "cli-default", {
        inputTokens: 5e5,
        outputTokens: 1e4,
        costUsd: 0.59,
        wallTimeS: 153,
        practiceRuns: 8,
      }),
    },
    { slug: "gpt-z", manifest: manifest("codex", "medium", { inputTokens: 1e6, outputTokens: 1e4 }) },
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
    expect(buildCost("gpt-z", { inputTokens: 1, outputTokens: 1 }, prices)).toBeNull();
    expect(buildCost("gpt-x", { inputTokens: 1 }, prices)).toBeNull();
    expect(buildCost("gpt-x", undefined, prices)).toBeNull();
    const f = buildFacts("claude-y", results, prices)!;
    expect(f).toMatchObject({
      tokensIn: 5e5,
      wallTimeS: 153,
      practiceRuns: 8,
      practiceLimit: 10,
      effort: "cli-default",
      cli: "claude",
    });
    const z = buildFacts("gpt-z", results, prices)!;
    expect([z.wallTimeS, z.practiceRuns]).toEqual([null, null]);
    expect(buildFacts("none", results, prices)).toBeNull();
    expect(buildFacts("gpt-x", null, prices)).toBeNull();
    const bare = buildFacts(
      "b",
      { event: results.event, rows: [{ slug: "b", manifest: { usage: {} } }] },
      prices,
    )!;
    expect([bare.tokensIn, bare.effort, bare.cli]).toEqual([0, null, null]);
    expect(formatTokens(2.17e6)).toBe("2.17M");
    expect(formatTokens(649e3)).toBe("649k");
    expect(formatBuildTime(882)).toBe("14m42");
    expect(formatBuildTime(57)).toBe("0m57");
    expect(formatBuildTime(null)).toBe("–");
  });

  it("calls the result a trial when the builds differ", () => {
    expect(caveat(results)).toBe(
      "Reasoning effort was not fixed: Codex builds ran at low or medium, Claude builds ran at the CLI default. Read it as a dry run, not a ranking.",
    );
    const same = (p: object) => ({
      event: results.event,
      rows: [
        { slug: "a", manifest: manifest("claude", "medium", {}, p) },
        { slug: "b", manifest: manifest("claude", "medium", {}) },
      ],
    });
    expect(caveat(same({ timeLimitMin: 20 }))).toBe(
      "Builds had different time limits. Every entry is from one provider. Read it as a dry run, not a ranking.",
    );
    expect(caveat(same({ practiceLimit: 5 }))).toContain("different practice budgets");
    const mixed = {
      event: results.event,
      rows: [
        { slug: "a", manifest: manifest("claude", "medium", {}) },
        { slug: "b", manifest: manifest("codex", "medium", {}) },
      ],
    };
    expect(caveat(mixed)).toBeNull();
    expect(caveat(null)).toBeNull();
    const unset = {
      event: results.event,
      rows: [
        { slug: "a", manifest: { usage: {} } },
        { slug: "b", manifest: { usage: {}, settings: { effort: "high" } } },
      ],
    };
    expect(caveat(unset)).toContain("Other builds ran at unset or high");
  });
});

describe("classification rows", () => {
  const incident = { carId: "son", corner: 2 } as Incident;
  const rows = classificationRows(
    [
      row({ id: "gpt-x", position: 1, lapTime: 48.5 }),
      row({ id: "claude-y", position: 2, gap: 5.057, lapTime: 53.557 }),
      row({ id: "del", position: 3, lapTime: null }),
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
  it("shapes the table: positions, gaps, why a car has no time, build facts and points", () => {
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
    expect(rows.map((r) => r.points)).toEqual([10, 8, 0, 0, 0, 0, 0, 0]);
    expect(rows[0]!.build?.cost).toEqual({ usd: 3, estimated: true });
    expect(rows[2]!.lapTime).toBeNull();
    expect(POINTS).toHaveLength(8);
    const ninth = classificationRows([row({ id: "n", position: 9 })], [], null, prices);
    expect(ninth[0]!.points).toBe(0);
  });
});

describe("analysis", () => {
  const replay = makeReplay(
    [
      makeCar(track, { id: "a", speed: 50 }),
      makeCar(track, { id: "b", speed: 45 }),
      makeCar(track, { id: "c", speed: 40, dnfAt: 5 }),
    ],
    track,
  );
  const cars = indexReplay(replay);

  it("profiles timed laps and measures the gap at equal distance", () => {
    const profiles = lapProfiles(cars, 10);
    expect(profiles.map((p) => p.id)).toEqual(["a", "b"]);
    const a = profiles[0]!;
    expect(a.speedKmh.every((v) => Math.abs(v - 180) < 1e-9)).toBe(true);
    expect(a.throttle[0]).toBe(1);
    expect(a.time).toBe(cars[0]!.car.result.lapTime);
    expect(
      lapProfile({ ...cars[0]!, car: { ...cars[0]!.car, frames: { ...cars[0]!.car.frames, lap: [] } } }),
    ).toBeNull();
    const d = deltaSeries(cars[0]!, cars[1]!, 50)!;
    expect(d.s.at(-1)).toBe(track.length);
    expect(d.dt.at(-1)).toBeCloseTo(cars[1]!.car.result.lapTime! - cars[0]!.car.result.lapTime!, 9);
    expect(d.dt[10]!).toBeGreaterThan(0);
    expect(deltaSeries(cars[0]!, cars[2]!)).toBeNull();
    expect(analysisPicks(profiles, "b")).toEqual({ ref: "a", ids: ["a", "b"] });
    expect(analysisPicks(profiles, "zz", 1)).toEqual({ ref: "a", ids: ["a"] });
    expect(analysisPicks([], "a")).toEqual({ ref: null, ids: [] });
  });

  it("colours sectors like a timing screen and says where the time goes", () => {
    const cls = [
      row({ id: "ref", lap: lap(30, [9.5, 10, 10.5]) }),
      row({ id: "foc", lap: lap(31, [10, 10.6, 10.4]) }),
      row({ id: "del", lap: lap(29, [9, 10, 10], false), lapTime: null }),
      row({ id: "dnf", lap: null, lapTime: null }),
    ];
    const rows = sectorRows(cls);
    expect(rows.map((r) => r.id)).toEqual(["ref", "foc"]);
    expect(rows[0]!.time).toBe(30);
    expect(rows[0]!.sectors.map((s) => s.kind)).toEqual(["fastest", "fastest", "slower"]);
    expect(rows[1]!.sectors.map((s) => s.kind)).toEqual(["slower", "slower", "fastest"]);
    expect(sectorRows([])).toEqual([]);
    const code = (id: string) => id.toUpperCase();
    expect(whereTimeGoes(rows, "foc", "ref", code)).toBe(
      "FOC loses 0.50 s in sector 1 and 0.60 s in sector 2 to REF, then gets 0.10 s back in sector 3, where it is the fastest of anyone.",
    );
    expect(whereTimeGoes(rows, "ref", "foc", code)).toBe(
      "REF loses 0.10 s in sector 3 to FOC, then gets 0.50 s back in sector 1 and 0.60 s back in sector 2, where it is the fastest of anyone.",
    );
    const even = sectorRows([
      row({ id: "x", lap: lap(30, [10, 20]) }),
      row({ id: "y", lap: lap(30, [10, 20]) }),
    ]);
    expect(whereTimeGoes(even, "x", "y", code)).toBe("X matches Y in every sector.");
    const ahead = sectorRows([
      row({ id: "x", lap: lap(29, [9, 20]) }),
      row({ id: "y", lap: lap(30, [10, 20]) }),
    ]);
    expect(whereTimeGoes(ahead, "x", "y", code)).toBe(
      "X gains 1.00 s back in sector 1 on Y, where it is the fastest of anyone.",
    );
    expect(whereTimeGoes(rows, "foc", "foc", code)).toBeNull();
    expect(whereTimeGoes(rows, "nope", "ref", code)).toBeNull();
  });
});
