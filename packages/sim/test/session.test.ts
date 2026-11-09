import { describe, expect, it } from "vitest";
import * as baseline from "../../../ddk/baseline-driver.js";
import {
  type CarResult,
  classify,
  encodeFrames,
  fmtTime,
  replayDuration,
  runSession,
  sampleFrames,
  summarizeSession,
  Track,
  telemetryCsv,
} from "../src/index.js";
import { circleFile, fnDriver, follower, protoCar, protoRing } from "./helpers.js";

const car = protoCar();

describe("determinism", () => {
  it("same inputs give bit-identical state hashes and replays", () => {
    const run = () =>
      runSession(protoRing(), car, [{ id: "b", name: "baseline", runtime: baseline }], { seed: 7 });
    const a = run();
    const b = run();
    expect(a.results.stateHash).toBe(b.results.stateHash);
    expect(JSON.stringify(a.replay)).toBe(JSON.stringify(b.replay));
  });

  it("the hash changes when the driver changes", () => {
    const track = Track.fromFile(circleFile(60));
    const h = (speed: number) =>
      runSession(track, car, [{ id: "f", name: "f", runtime: follower({ speed }) }], { seed: 1 }).results
        .stateHash;
    expect(h(14)).toBe(h(14));
    expect(h(14)).not.toBe(h(14.001));
  });
});

describe("runSession (ghost mode)", () => {
  const track = Track.fromFile(circleFile(60));
  const out = runSession(
    track,
    car,
    [
      { id: "slow", name: "Slow", runtime: follower({ speed: 12 }), driverHash: "aaa" },
      { id: "fast", name: "Fast", runtime: follower({ speed: 16 }), driverHash: "abc" },
      { id: "dnf", name: "Broken", runtime: fnDriver(() => null) },
    ],
    { seed: 3 },
  );

  it("classifies by lap time, DNFs last, with gaps", () => {
    const c = out.results.classification;
    expect(c.map((r) => r.id)).toEqual(["fast", "slow", "dnf"]);
    expect(c[0]!.position).toBe(1);
    expect(c[0]!.gap).toBeNull();
    expect(c[1]!.gap!).toBeGreaterThan(1);
    expect(c[2]!.status).toBe("DNF: ECU FAILURE");
    expect(c[2]!.gap).toBeNull();
    expect(c[0]!.driverHash).toBe("abc");
    expect(c[1]!.driverHash).toBe("aaa");
    expect(c[2]!.driverHash).toBe("unknown");
  });

  it("writes a self-contained replay", () => {
    const r = out.replay;
    expect(r.format).toBe("bench-replay");
    expect(r.header.frameRate).toBe(50);
    expect(r.header.stateHash).toBe(out.results.stateHash);
    expect(r.track.x.length).toBe(track.count);
    expect(r.cars).toHaveLength(3);
    const fast = r.cars.find((c) => c.id === "fast")!;
    const n = fast.frames.x.length;
    for (const k of Object.keys(fast.frames) as (keyof typeof fast.frames)[])
      expect(fast.frames[k]).toHaveLength(n);
    expect(fast.events.some((e) => e.type === "lap")).toBe(true);
    const longest = Math.max(...r.cars.map((c) => c.frames.x.length));
    expect(replayDuration(r)).toBeCloseTo((longest - 1) / 50, 6);
  });

  it("summarizes for humans and LLMs", () => {
    const s = summarizeSession(out.results, out.runs);
    expect(s).toMatch(/^FLYING LAP on circle \| launch \d+ km\/h/);
    expect(s).toMatch(/P1 Fast \[FINISHED\] lap \d/);
    expect(s).toMatch(/P3 Broken \[DNF: ECU FAILURE\]/);
    expect(s).toMatch(/error: /);
    expect(s).toMatch(/gap \+\d/);
  });
});

describe("classify", () => {
  const base: CarResult = {
    id: "",
    name: "",
    status: "FINISHED",
    lap: null,
    lapTime: null,
    offTracks: 0,
    strikes: 0,
    maxSpeed: 0,
    distance: 0,
    stateHash: "",
    errors: [],
  };
  it("valid lap times first, then deleted laps, then retirements by distance", () => {
    const rs = [
      { ...base, id: "dnf2", status: "DNF: CRASHED" as const, distance: 900 },
      { ...base, id: "ecu", status: "DNF: ECU FAILURE" as const, distance: 3000 },
      { ...base, id: "dnf1", status: "DNF: STALLED" as const, distance: 950 },
      { ...base, id: "a", lapTime: 80 },
      { ...base, id: "deleted" },
      { ...base, id: "c", lapTime: 75 },
      { ...base, id: "out", status: "TIME UP" as const },
    ];
    expect(classify(rs).map((r) => r.id)).toEqual(["c", "a", "deleted", "out", "dnf1", "dnf2", "ecu"]);
  });
});

describe("replay helpers", () => {
  const frames = {
    x: [0, 1, 2],
    y: [0, 0, 0],
    yaw: [3.1, -3.1, -3.0],
    speed: [10, 20, 30],
    steer: [0, 0.5, 1],
    throttle: [1, 1, 1],
    brake: [0, 0, 0],
    surface: [0, 0, 2],
    lap: [1, 1, 2],
    s: [0, 1, 2],
  };
  it("interpolates linearly and the short way round for yaw", () => {
    const f = sampleFrames(frames, 50, 0.01);
    expect(f.x).toBeCloseTo(0.5);
    expect(f.speed).toBeCloseTo(15);
    expect(Math.abs(f.yaw)).toBeGreaterThan(3.1);
    expect(f.ended).toBe(false);
    const g = sampleFrames(frames, 50, 0.03);
    expect(g.yaw).toBeCloseTo(-3.05);
    const end = sampleFrames(frames, 50, 100);
    expect(end.x).toBe(2);
    expect(end.ended).toBe(true);
    expect(sampleFrames(frames, 50, -1).x).toBe(0);
    const wrapUp = sampleFrames({ ...frames, yaw: [-3.1, 3.1, 3.1] }, 50, 0.01);
    expect(Math.abs(wrapUp.yaw)).toBeGreaterThan(3.1);
  });
  it("encodes with bounded precision", () => {
    const e = encodeFrames({ ...frames, x: [1.23456, 2.5, 3] });
    expect(e.x[0]).toBe(1.23);
    expect(e.lap).toEqual([1, 1, 2]);
  });
});

describe("telemetry output", () => {
  it("writes CSV with the documented columns", () => {
    const out = runSession(
      Track.fromFile(circleFile(60)),
      car,
      [{ id: "f", name: "f", runtime: follower({ speed: 12 }) }],
      { seed: 1, recordTelemetry: true },
    );
    const csv = telemetryCsv(out.runs[0]!.telemetry!);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("t,s,speed,throttle,brake,steer,n,surface,ax,ay");
    expect(lines[1]!.split(",")).toHaveLength(10);
    expect(lines[1]).toMatch(/,track,/);
    expect(lines.length).toBe(out.runs[0]!.telemetry!.t.length + 1);
  });
  it("formats times", () => {
    expect(fmtTime(null)).toBe("-");
    expect(fmtTime(Number.POSITIVE_INFINITY)).toBe("-");
    expect(fmtTime(9.5)).toBe("9.500");
    expect(fmtTime(70.6)).toBe("1:10.600");
    expect(fmtTime(125.25)).toBe("2:05.250");
  });
});
