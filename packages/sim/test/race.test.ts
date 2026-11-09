// Feature tests: full simulations through race control.
import { describe, expect, it } from "vitest";
import * as baseline from "../../../ddk/baseline-driver.js";
import { createReferenceDriver } from "../../reference-driver/src/driver.js";
import {
  CarSim,
  type Controls,
  CRASH_SPEED,
  LAUNCH_MAX_SPEED,
  LAUNCH_TICKS,
  LAUNCH_TIME,
  launchSpeed,
  type runSession,
  type SessionConfig,
  STALL_TIME,
  type Telemetry,
  Track,
} from "../src/index.js";
import { circleFile, fnDriver, follower, protoCar, protoRing } from "./helpers.js";

const car = protoCar();
const cfg = (c: Partial<SessionConfig> = {}): SessionConfig => ({ seed: 1, ...c });
const runOne = (
  runtime: Parameters<typeof runSession>[2][number]["runtime"],
  c: Partial<SessionConfig> = {},
  track = protoRing(),
) => new CarSim(track, car, { id: "x", name: "x", runtime }, cfg(c)).run();

describe("baseline and reference drivers (phase 1 acceptance)", () => {
  it("the DDK baseline sets a valid flying lap", () => {
    const r = runOne(baseline).result;
    expect(r.status).toBe("FINISHED");
    expect(r.lap!.valid).toBe(true);
    expect(r.lapTime).toBe(r.lap!.time);
    expect(r.lapTime!).toBeLessThan(120);
  });

  it("the reference driver is much faster than the baseline and reaches the plausibility targets", () => {
    const run = runOne(createReferenceDriver(), { recordTelemetry: true, infoLevel: "A" });
    const r = run.result;
    expect(r.status).toBe("FINISHED");
    expect(r.offTracks).toBe(0);
    const base = runOne(baseline).result;
    expect(base.lapTime! - r.lapTime!).toBeGreaterThan(10);
    expect(r.maxSpeed * 3.6).toBeGreaterThan(320);
    const tl = run.telemetry!;
    const g = 9.81;
    expect(Math.min(...tl.ax) / g).toBeLessThan(-4.3);
    expect(Math.max(...tl.ay.map(Math.abs)) / g).toBeGreaterThan(3.3);
    expect(tl.surface.every((s) => s === "track" || s === "kerb")).toBe(true);
    expect(tl.t.length).toBe(tl.speed.length);
    expect(tl.n.length).toBe(tl.t.length);
  });

  it("a slower reference pace gives a slower lap", () => {
    const fast = runOne(createReferenceDriver(), { infoLevel: "A" }).result.lapTime!;
    const slow = runOne(createReferenceDriver({ pace: 0.9 })).result.lapTime!;
    expect(slow).toBeGreaterThan(fast + 1);
  });
});

describe("flying start", () => {
  it("the launch speed is capped, and held down by a corner near the line", () => {
    expect(launchSpeed(protoRing())).toBeLessThanOrEqual(LAUNCH_MAX_SPEED);
    expect(launchSpeed(protoRing()) * 3.6).toBeGreaterThan(200);
    const circle = launchSpeed(Track.fromFile(circleFile(60)));
    expect(circle).toBeLessThanOrEqual(Math.sqrt(15 * 60) + 0.1);
    expect(circle).toBeGreaterThan(Math.sqrt(15 * 60) - 0.5);
  });

  it("every car gets the same run-up and crosses the line at the launch speed", () => {
    const seen: Telemetry[] = [];
    const a = runOne(
      fnDriver((t) => {
        seen.push(t);
        return { throttle: 1, brake: 0, steer: 0 };
      }),
      { timeLimit: 1 },
    );
    const b = runOne(follower({ speed: 20 }), { timeLimit: 1 });
    expect(a.frames.x.slice(0, LAUNCH_TICKS)).toEqual(b.frames.x.slice(0, LAUNCH_TICKS));
    expect(a.frames.speed.slice(0, LAUNCH_TICKS)).toEqual(b.frames.speed.slice(0, LAUNCH_TICKS));
    expect(a.frames.lap.slice(0, LAUNCH_TICKS).every((l) => l === 0)).toBe(true);
    const v0 = launchSpeed(protoRing());
    expect(a.frames.speed[0]!).toBeLessThan(v0);
    expect(a.frames.speed[LAUNCH_TICKS]!).toBeCloseTo(v0, 9);
    expect(a.frames.lap[LAUNCH_TICKS]).toBe(1);
    const first = seen[0]!;
    expect(first.t).toBe(LAUNCH_TIME);
    expect(first.lapTime).toBe(0);
    expect(first.s).toBeCloseTo(0, 6);
    expect(first.n).toBeCloseTo(0, 6);
    expect(first.speed).toBeCloseTo(v0, 9);
    expect(first.throttle).toBe(1);
  });
});

describe("race control", () => {
  it("times the lap from the line, with sector times that sum to the lap time", () => {
    const run = runOne(follower({ speed: 15 }), {}, Track.fromFile(circleFile(60)));
    const r = run.result;
    expect(r.status).toBe("FINISHED");
    const lap = r.lap!;
    expect(lap.sectors).toHaveLength(3);
    expect(lap.sectors.reduce((a, b) => a + b, 0)).toBeCloseTo(lap.time, 9);
    expect(run.events.find((e) => e.type === "lap")!.t).toBeCloseTo(LAUNCH_TIME + lap.time, 2);
  });

  it("a car that stops stalls after 10 s", () => {
    const run = runOne(fnDriver(() => ({ throttle: 0, brake: 1, steer: 0 })));
    expect(run.result.status).toBe("DNF: STALLED");
    const t = run.events.at(-1)!.t;
    expect(t).toBeGreaterThan(LAUNCH_TIME + STALL_TIME);
    expect(t).toBeLessThan(LAUNCH_TIME + STALL_TIME + 5);
    expect(run.result.lap).toBeNull();
  });

  it("driving backwards across the line never counts a lap", () => {
    // stop, U-turn on a wide circle, then drive the wrong way round
    const track = Track.fromFile(circleFile(100, 34));
    let phase = -1;
    const driver = fnDriver((t): Controls => {
      if (phase === -1) {
        if (t.speed > 2) return { throttle: 0, brake: 1, steer: 0 };
        phase = 0;
      }
      if (phase === 0 && Math.abs(t.headingError) > 2.8) phase = 1;
      if (phase === 0) return { throttle: t.speed < 3 ? 0.1 : 0, brake: 0, steer: 1 };
      const target = track.toWorld(t.s - 12, 0);
      const alpha = Math.atan2(target.y - t.y, target.x - t.x) - t.yaw;
      return { throttle: t.speed < 12 ? 0.3 : 0, brake: 0, steer: Math.sin(alpha) * 3 };
    });
    const r = runOne(driver, { timeLimit: 90 }, track).result;
    expect(r.lap).toBeNull();
    expect(r.distance).toBeLessThan(-200);
    expect(r.status).toBe("TIME UP");
  });

  it("cutting across the infield is not a shortcut: the car hits the barrier", () => {
    const r = runOne(fnDriver(() => ({ throttle: 0.6, brake: 0, steer: 0 }))).result;
    expect(r.lap).toBeNull();
    expect(["DNF: CRASHED", "DNF: STALLED"]).toContain(r.status);
  });

  it("a high-speed barrier hit is a crash", () => {
    const run = runOne(fnDriver(() => ({ throttle: 0.5, brake: 0, steer: 0.04 })));
    expect(run.result.status).toBe("DNF: CRASHED");
    const crash = run.events.find((e) => e.type === "crash")!;
    expect(crash.value!).toBeGreaterThan(CRASH_SPEED);
  });

  it("a low-speed barrier contact stops the car, which can continue", () => {
    // slow down, then circle on a 20 m radius: wider than track + runoff, so the car touches the barrier
    let slowed = false;
    const run = runOne(
      fnDriver((t) => {
        slowed ||= t.speed < 6;
        if (!slowed) return { throttle: 0, brake: 1, steer: 0 };
        return { throttle: t.speed < 6 ? 0.2 : 0, brake: 0, steer: 0.5 };
      }),
      { timeLimit: 40 },
    );
    expect(run.events.some((e) => e.type === "impact")).toBe(true);
    expect(run.result.status).not.toBe("DNF: CRASHED");
  });

  it("leaving the track deletes the lap", () => {
    const track = Track.fromFile(circleFile(60));
    const wide = follower({ speed: 14, offset: (s) => (s > 100 && s < 140 ? -9 : 0) });
    const r = runOne(wide, {}, track).result;
    expect(r.status).toBe("FINISHED");
    expect(r.offTracks).toBe(1);
    expect(r.lap!.valid).toBe(false);
    expect(r.lapTime).toBeNull();
  });

  it("the time limit counts from the line", () => {
    const run = runOne(follower({ speed: 10 }), { timeLimit: 5 });
    expect(run.result.status).toBe("TIME UP");
    expect(run.events.at(-1)!.t).toBeCloseTo(LAUNCH_TIME + 5, 6);
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
        return { throttle: n < 50 ? 0.4 : 0, brake: 0, steer: 0 };
      }),
      { timeLimit: 3 },
    );
    expect(run.result.strikes).toBe(1);
    expect(run.result.errors[0]).toMatch(/throttle, steer/);
    expect(run.result.status).toBe("TIME UP");
    // the previous throttle (0.4) was held for that step
    expect(seen[50]!.throttle).toBeCloseTo(0.4, 6);
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
    expect(run.frames.x).toHaveLength(LAUNCH_TICKS + 1);
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
    expect(seen[0]!.t).toBe(LAUNCH_TIME);
    expect(seen[1]!.t).toBeCloseTo(LAUNCH_TIME + 0.02, 12);
    const last = seen.at(-1)!;
    expect(last.lap).toBe(1);
    expect(last.sector).toBe(1);
    expect(last.surface).toBe("track");
    expect(last.speed).toBeGreaterThan(10);
    expect(last.throttle).toBeCloseTo(0.5);
    expect(last.lapTime).toBeCloseTo(last.t - LAUNCH_TIME);
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
