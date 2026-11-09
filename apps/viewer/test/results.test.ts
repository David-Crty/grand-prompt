import type { ClassifiedResult } from "@bench/sim";
import { describe, expect, it } from "vitest";
import {
  analysisPicks,
  bestProfiles,
  deltaSeries,
  lapProfile,
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
  fastestLap,
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

const lap = (n: number, time: number, sectors: number[]) => ({ lap: n, time, sectors, valid: true });
const row = (o: Partial<ClassifiedResult> & { id: string }): ClassifiedResult =>
  ({
    name: o.id,
    status: "FINISHED",
    position: 1,
    gap: null,
    totalTime: 100,
    bestLap: 50,
    bestLapNumber: 2,
    penalties: 0,
    laps: [],
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
  const incident = { carId: "son", lap: 1, corner: 2 } as Incident;
  const rows = classificationRows(
    [
      row({ id: "gpt-x", position: 1, totalTime: 489.8 }),
      row({ id: "claude-y", position: 2, gap: 5.057, bestLap: 49 }),
      row({ id: "son", position: 3, status: "DNF: CRASHED", totalTime: null, bestLap: null }),
      row({ id: "ecu", position: 4, status: "DNF: ECU FAILURE" }),
      row({ id: "st", position: 5, status: "DNF: STALLED" }),
      row({ id: "tu", position: 6, status: "TIME UP" }),
      row({ id: "odd", position: 7, status: "DNF: GONE" as ClassifiedResult["status"] }),
    ],
    [incident, { carId: "ecu", lap: 2, corner: null } as Incident],
    results,
    prices,
  );
  it("shapes the table: positions, gaps, how cars went out, build facts and points", () => {
    expect(rows.map((r) => r.position)).toEqual([1, 2, null, null, null, null, null]);
    expect(rows[0]!.gap).toBeNull();
    expect(rows[1]!.gap).toBe(5.057);
    expect(rows.map((r) => r.outText)).toEqual([
      null,
      null,
      "Crashed · L1 · T2",
      "Driver failed · L2",
      "Stalled",
      "Time up",
      "GONE",
    ]);
    expect(rows.map((r) => r.points)).toEqual([10, 8, 0, 0, 0, 0, 0]);
    expect(rows[0]!.build?.cost).toEqual({ usd: 3, estimated: true });
    expect(rows[2]!.totalTime).toBeNull();
    expect(fastestLap(rows)).toBe(49);
    expect(fastestLap([])).toBeNull();
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

  it("profiles best laps and measures the gap at equal distance", () => {
    const profiles = bestProfiles(cars, 10);
    expect(profiles.map((p) => p.id)).toEqual(["a", "b"]);
    const a = profiles[0]!;
    expect(a.speedKmh.every((v) => Math.abs(v - 180) < 1e-9)).toBe(true);
    expect(a.throttle[0]).toBe(1);
    expect(a.time).toBeCloseTo(track.length / 50 - 0.02, 6);
    expect(lapProfile(cars[0]!, 9)).toBeNull();
    const d = deltaSeries(cars[0]!, cars[1]!, 50)!;
    expect(d.s.at(-1)).toBe(track.length);
    const lapA = cars[0]!.laps.find((e) => e.lap === 2)!.value!;
    const lapB = cars[1]!.laps.find((e) => e.lap === 2)!.value!;
    expect(d.dt.at(-1)).toBeCloseTo(lapB - lapA, 9);
    expect(d.dt[10]!).toBeGreaterThan(0);
    expect(deltaSeries(cars[0]!, cars[2]!)).toBeNull();
    expect(analysisPicks(profiles, "b")).toEqual({ ref: "a", ids: ["a", "b"] });
    expect(analysisPicks(profiles, "zz", 1)).toEqual({ ref: "a", ids: ["a"] });
    expect(analysisPicks([], "a")).toEqual({ ref: null, ids: [] });
  });

  it("colours sectors like a timing screen and says where the time goes", () => {
    const cls = [
      row({ id: "ref", laps: [lap(1, 31, [10, 10, 11]), lap(2, 30, [9.5, 10, 10.5])] }),
      row({ id: "foc", laps: [lap(1, 32, [10.2, 11, 10.8]), lap(2, 31, [10, 10.6, 10.4])] }),
      row({ id: "dnf", laps: [] }),
    ];
    const rows = sectorRows(cls, 2);
    expect(rows.map((r) => r.id)).toEqual(["ref", "foc"]);
    expect(rows[0]!.sectors.map((s) => s.kind)).toEqual(["fastest", "fastest", "personal"]);
    expect(rows[1]!.sectors.map((s) => s.kind)).toEqual(["personal", "personal", "fastest"]);
    expect(rows[1]!.ideal).toBeCloseTo(10 + 10.6 + 10.4, 9);
    expect(sectorRows(cls, 1)[1]!.sectors.map((s) => s.kind)).toEqual(["personal", "personal", "fastest"]);
    expect(
      sectorRows([row({ id: "s", laps: [lap(1, 30, [9, 21]), lap(2, 31, [10, 21])] })], 2)[0]!.sectors[0]!
        .kind,
    ).toBe("slower");
    const code = (id: string) => id.toUpperCase();
    expect(whereTimeGoes(rows, "foc", "ref", code)).toBe(
      "FOC loses 0.50 s in sector 1 and 0.60 s in sector 2 to REF, then gets 0.10 s back in sector 3, where it is the fastest of anyone.",
    );
    expect(whereTimeGoes(rows, "ref", "foc", code)).toBe(
      "REF loses 0.10 s in sector 3 to FOC, then gets 0.50 s back in sector 1 and 0.60 s back in sector 2, where it is the fastest of anyone.",
    );
    const even = sectorRows(
      [row({ id: "x", laps: [lap(1, 30, [10, 20])] }), row({ id: "y", laps: [lap(1, 30, [10, 20])] })],
      1,
    );
    expect(whereTimeGoes(even, "x", "y", code)).toBe("X matches Y in every sector.");
    const ahead = sectorRows(
      [row({ id: "x", laps: [lap(1, 29, [9, 20])] }), row({ id: "y", laps: [lap(1, 30, [10, 20])] })],
      1,
    );
    expect(whereTimeGoes(ahead, "x", "y", code)).toBe(
      "X gains 1.00 s back in sector 1 on Y, where it is the fastest of anyone.",
    );
    expect(whereTimeGoes(rows, "foc", "foc", code)).toBeNull();
    expect(whereTimeGoes(rows, "nope", "ref", code)).toBeNull();
  });
});
