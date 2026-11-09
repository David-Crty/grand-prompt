// Feature tests: full simulations through race control.
import { describe, expect, it } from "vitest";
import * as baseline from "../../../ddk/baseline-driver.js";
import { createReferenceDriver } from "../../reference-driver/src/driver.js";
import {
  CarSim,
  type Controls,
  CRASH_SPEED,
  defaultTimeLimit,
  type runSession,
  type SessionConfig,
  STALL_TIME,
  type Telemetry,
  Track,
} from "../src/index.js";
import { circleFile, fnDriver, follower, protoCar, protoRing } from "./helpers.js";

const car = protoCar();
const cfg = (c: Partial<SessionConfig> = {}): SessionConfig => ({ type: "practice", laps: 1, seed: 1, ...c });
const runOne = (
  runtime: Parameters<typeof runSession>[2][number]["runtime"],
  c: Partial<SessionConfig> = {},
  track = protoRing(),
) => new CarSim(track, car, { id: "x", name: "x", runtime }, cfg(c)).run();

describe("baseline and reference drivers (phase 1 acceptance)", () => {
  it("the DDK baseline completes 3 laps without DNF", () => {
    const r = runOne(baseline, { laps: 3 }).result;
    expect(r.status).toBe("FINISHED");
    expect(r.lapsCompleted).toBe(3);
    expect(r.laps.every((l) => l.valid)).toBe(true);
    expect(r.bestLap).not.toBeNull();
    expect(r.bestLap!).toBeLessThan(120);
  });

  it("the reference driver is much faster than the baseline and reaches the plausibility targets", () => {
    const run = runOne(createReferenceDriver(), { laps: 2, recordTelemetry: true, infoLevel: "A" });
    const r = run.result;
    expect(r.status).toBe("FINISHED");
    expect(r.offTracks).toBe(0);
    const base = runOne(baseline, { laps: 2 }).result;
    expect(base.bestLap! - r.bestLap!).toBeGreaterThan(10);
    expect(r.maxSpeed * 3.6).toBeGreaterThan(320);
    const tl = run.telemetry!;
    const g = 9.81;
    expect(Math.min(...tl.ax) / g).toBeLessThan(-4.3);
    expect(Math.max(...tl.ay.map(Math.abs)) / g).toBeGreaterThan(3.3);
    expect(tl.surface.every((s) => s === "track" || s === "kerb")).toBe(true);
    // telemetry arrays are aligned
    expect(tl.t.length).toBe(tl.speed.length);
    expect(tl.n.length).toBe(tl.lap.length);
  });

  it("a slower reference pace gives a slower lap", () => {
    const fast = runOne(createReferenceDriver(), { laps: 2, infoLevel: "A" }).result.bestLap!;
    const slow = runOne(createReferenceDriver({ pace: 0.9 }), { laps: 2 }).result.bestLap!;
    expect(slow).toBeGreaterThan(fast + 1);
  });
});

describe("race control", () => {
  it("counts laps with sector times that sum to the lap time", () => {
    const r = runOne(follower({ speed: 15 }), { laps: 1 }, Track.fromFile(circleFile(60))).result;
    expect(r.status).toBe("FINISHED");
    const lap = r.laps[0]!;
    expect(lap.sectors).toHaveLength(3);
    expect(lap.sectors.reduce((a, b) => a + b, 0)).toBeCloseTo(lap.time, 9);
    expect(r.finishTime).toBeCloseTo(lap.time, 9);
  });

  it("a car that never moves stalls after 10 s", () => {
    const run = runOne(fnDriver(() => ({ throttle: 0, brake: 0, steer: 0 })));
    expect(run.result.status).toBe("DNF: STALLED");
    expect(run.events.at(-1)!.t).toBeCloseTo(STALL_TIME, 1);
    expect(run.result.lapsCompleted).toBe(0);
  });

  it("driving backwards across the line never counts a lap", () => {
    // U-turn on a wide circle, then drive the wrong way round
    const track = Track.fromFile(circleFile(100, 34));
    let phase = 0;
    const driver = fnDriver((t): Controls => {
      if (phase === 0 && Math.abs(t.headingError) > 2.8) phase = 1;
      if (phase === 0) return { throttle: t.speed < 3 ? 0.1 : 0, brake: 0, steer: 1 };
      // follow the centre going backwards
      const target = track.toWorld(t.s - 12, 0);
      const alpha = Math.atan2(target.y - t.y, target.x - t.x) - t.yaw;
      return { throttle: t.speed < 12 ? 0.3 : 0, brake: 0, steer: Math.sin(alpha) * 3 };
    });
    const r = runOne(driver, { laps: 1, timeLimit: 90 }, track).result;
    expect(r.lapsCompleted).toBe(0);
    expect(r.distance).toBeLessThan(-200);
    expect(r.status).toBe("TIME UP");
  });

  it("cutting across the infield is not a shortcut: the car hits the barrier", () => {
    // Drive straight on at the end of the main straight instead of taking the hairpin.
    const r = runOne(
      fnDriver(() => ({ throttle: 0.6, brake: 0, steer: 0 })),
      { laps: 1 },
    ).result;
    expect(r.lapsCompleted).toBe(0);
    expect(["DNF: CRASHED", "DNF: STALLED"]).toContain(r.status);
  });

  it("a high-speed barrier hit is a crash", () => {
    // accelerate down the main straight, then drift gently off towards the barrier at speed
    const run = runOne(
      fnDriver((t) => ({ throttle: t.speed < 50 ? 0.6 : 0.3, brake: 0, steer: t.speed > 45 ? 0.04 : 0 })),
    );
    expect(run.result.status).toBe("DNF: CRASHED");
    const crash = run.events.find((e) => e.type === "crash")!;
    expect(crash.value!).toBeGreaterThan(CRASH_SPEED);
  });

  it("a low-speed barrier contact stops the car, which can continue", () => {
    // circle slowly on a 20 m radius: wider than track + runoff, so the car touches the barrier
    const run = runOne(
      fnDriver((t) => ({ throttle: t.speed < 6 ? 0.2 : 0, brake: 0, steer: 0.5 })),
      {
        timeLimit: 40,
      },
    );
    expect(run.events.some((e) => e.type === "impact")).toBe(true);
    expect(run.result.status).not.toBe("DNF: CRASHED");
  });

  it("practice and qualifying: leaving the track deletes the lap", () => {
    const track = Track.fromFile(circleFile(60));
    const wide = follower({ speed: 14, offset: (s) => (s > 100 && s < 140 ? -9 : 0) });
    const r = runOne(wide, { laps: 2 }, track).result;
    expect(r.offTracks).toBeGreaterThanOrEqual(2);
    expect(r.laps.every((l) => !l.valid)).toBe(true);
    expect(r.bestLap).toBeNull();
    expect(r.warnings).toBe(0);
  });

  it("race: three warnings, then +5 s penalties", () => {
    const track = Track.fromFile(circleFile(60));
    const wide = follower({ speed: 14, offset: (s) => (s > 100 && s < 140 ? -9 : 0) });
    const r = runOne(wide, { type: "race", laps: 5 }, track).result;
    expect(r.offTracks).toBe(5);
    expect(r.warnings).toBe(3);
    expect(r.penalties).toBe(10);
    expect(r.totalTime).toBeCloseTo(r.finishTime! + 10, 9);
  });

  it("qualifying times only flying laps; practice falls back to the standing lap", () => {
    const track = Track.fromFile(circleFile(60));
    const q = runOne(follower({ speed: 15 }), { type: "qualify", laps: 1 }, track).result;
    expect(q.lapsCompleted).toBe(2);
    expect(q.bestLapNumber).toBe(2);
    const p = runOne(follower({ speed: 15 }), { laps: 1 }, track).result;
    expect(p.bestLapNumber).toBe(1);
  });

  it("time limit ends the session", () => {
    const r = runOne(follower({ speed: 10 }), { laps: 50, timeLimit: 5 }).result;
    expect(r.status).toBe("TIME UP");
    expect(defaultTimeLimit({ type: "qualify", laps: 1, seed: 1 })).toBe(60 + 2 * 240);
  });
});

describe("ECU error policy", () => {
  it("exceptions in step are strikes; three strikes is an ECU failure", () => {
    let n = 0;
    const run = runOne(
      fnDriver(() => {
        n++;
        if (n % 10 === 0) throw new Error("boom");
        return { throttle: 0.3, brake: 0, steer: 0 };
      }),
    );
    expect(run.result.status).toBe("DNF: ECU FAILURE");
    expect(run.result.strikes).toBe(3);
    expect(run.result.errors[0]).toMatch(/boom/);
    expect(run.events.filter((e) => e.type === "strike")).toHaveLength(3);
  });

  it("NaN or missing fields keep the previous command and cost a strike", () => {
    const seen: Telemetry[] = [];
    let n = 0;
    const run = runOne(
      fnDriver((t) => {
        seen.push(t);
        n++;
        if (n === 50) return { throttle: Number.NaN, brake: 0 };
        return { throttle: 0.4, brake: 0, steer: 0 };
      }),
      { timeLimit: 3 },
    );
    expect(run.result.strikes).toBe(1);
    expect(run.result.errors[0]).toMatch(/throttle, steer/);
    expect(run.result.status).toBe("TIME UP");
    // the previous throttle (0.4) was held, so the car kept accelerating
    expect(seen[60]!.speed).toBeGreaterThan(seen[49]!.speed);
  });

  it("non-object outputs are strikes; out-of-range values are clamped silently", () => {
    const outs: unknown[] = [null, 5, { throttle: 9, brake: -3, steer: 7 }];
    let n = 0;
    const run = runOne(
      fnDriver(() => outs[Math.min(n++, 2)]),
      { timeLimit: 2 },
    );
    expect(run.result.strikes).toBe(2);
    expect(run.result.errors.join(" ")).toMatch(/returned null/);
    expect(run.result.errors.join(" ")).toMatch(/returned number/);
  });

  it("a failure in init is an immediate ECU failure", () => {
    const run = runOne({
      init: () => {
        throw new Error("bad init");
      },
      step: () => ({ throttle: 1, brake: 0, steer: 0 }),
    });
    expect(run.result.status).toBe("DNF: ECU FAILURE");
    expect(run.result.errors[0]).toMatch(/bad init/);
    expect(run.frames.x).toHaveLength(1);
  });

  it("non-Error throws are reported", () => {
    const run = runOne(
      fnDriver(() => {
        throw "plain string";
      }),
    );
    expect(run.result.errors[0]).toMatch(/plain string/);
  });
});

describe("telemetry", () => {
  it("reports a consistent state to the driver", () => {
    const seen: Telemetry[] = [];
    runOne(
      fnDriver((t) => {
        seen.push(t);
        return { throttle: 0.5, brake: 0, steer: 0 };
      }),
      { timeLimit: 4 },
    );
    expect(seen[0]!.t).toBe(0);
    expect(seen[1]!.t).toBeCloseTo(0.02, 12);
    const last = seen.at(-1)!;
    expect(last.lap).toBe(1);
    expect(last.sector).toBe(1);
    expect(last.surface).toBe("track");
    expect(last.speed).toBeGreaterThan(10);
    expect(last.throttle).toBeCloseTo(0.5);
    expect(last.lapTime).toBeCloseTo(last.t);
    expect(Math.abs(last.headingError)).toBeLessThan(0.01);
  });

  it("sensor noise is seeded: same seed same noise, different seed different noise", () => {
    const collect = (seed: number) => {
      const xs: number[] = [];
      runOne(
        fnDriver((t) => {
          xs.push(t.x, t.speed);
          return { throttle: 0.5, brake: 0, steer: 0 };
        }),
        { timeLimit: 1, seed, sensorNoise: { position: 0.1, speed: 0.1 } },
      );
      return xs;
    };
    expect(collect(1)).toEqual(collect(1));
    expect(collect(1)).not.toEqual(collect(2));
  });
});
