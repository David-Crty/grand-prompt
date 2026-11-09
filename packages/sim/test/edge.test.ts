import { describe, expect, it } from "vitest";
import { CarSim, runSession, summarizeSession, Track } from "../src/index.js";
import { circleFile, fnDriver, follower, protoCar, protoRing } from "./helpers.js";

const car = protoCar();

describe("edge cases", () => {
  it("low-speed barrier contact on the right side, and a summary with many events", () => {
    const out = runSession(
      protoRing(),
      car,
      [
        {
          id: "r",
          name: "Righty",
          runtime: fnDriver((t) => ({ throttle: t.speed < 6 ? 0.2 : 0, brake: 0, steer: -0.5 })),
        },
      ],
      { type: "race", laps: 1, seed: 1, timeLimit: 120 },
    );
    const run = out.runs[0]!;
    const impacts = run.events.filter((e) => e.type === "impact");
    expect(impacts.length).toBeGreaterThan(5);
    for (let i = 0; i < 30; i++) run.events.push({ t: 100 + i, type: "impact", lap: 1, value: 1 });
    const text = summarizeSession(out.results, out.runs);
    expect(text).toMatch(/more events/);
    expect(summarizeSession(out.results, [])).toMatch(/P1 Righty/);
  });

  it("race summary shows penalties and invalid laps", () => {
    const track = Track.fromFile(circleFile(60));
    const wide = follower({ speed: 14, offset: (s) => (s > 100 && s < 140 ? -9 : 0) });
    const out = runSession(track, car, [{ id: "w", name: "Wide", runtime: wide }], {
      type: "race",
      laps: 5,
      seed: 1,
    });
    const text = summarizeSession(out.results, out.runs);
    expect(text).toMatch(/incl\. \+10s penalties/);
    expect(text).toMatch(/INVALID \(track limits\)/);
    expect(text).toMatch(/penalty 5 track limits/);
  });

  it("a driver returning null every step is an ECU failure without exceptions", () => {
    const run = new CarSim(
      protoRing(),
      car,
      { id: "n", name: "n", runtime: fnDriver(() => null) },
      { type: "race", laps: 1, seed: 1 },
    ).run();
    expect(run.result.status).toBe("DNF: ECU FAILURE");
    expect(run.result.errors).toHaveLength(3);
  });
});
