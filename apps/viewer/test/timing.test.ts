import { describe, expect, it } from "vitest";
import { DEFAULT_DIRECTOR, directorStep, pickFocus, type Shot } from "../src/lib/director.js";
import {
  frameAt,
  indexCar,
  indexReplay,
  lapInfoAt,
  overallBestAt,
  progressAt,
  sampleCar,
  statusAt,
  timeAtProgress,
} from "../src/lib/frames.js";
import { leaderLap, liveStandings, type StandingRow, timeGap } from "../src/lib/timing.js";
import { makeCar, makeReplay, stadiumTrack } from "./fixtures.js";

const track = stadiumTrack();
const L = track.length;

describe("frames", () => {
  const car = makeCar(track, { id: "a", speed: 50, laps: 2, invalidLaps: [2] });
  const c = indexCar(car, 0, 10, L);

  it("builds monotonic race distance", () => {
    expect(c.frameCount).toBe(car.frames.x.length);
    expect(c.progress[0]).toBe(0);
    expect(c.endTime).toBeCloseTo((c.frameCount - 1) / 10);
    expect(c.finishTime).toBeCloseTo((2 * L) / 50);
    expect(c.laps).toHaveLength(2);
    expect(frameAt(c, -1)).toEqual({ i: 0, j: 1, a: 0 });
    expect(frameAt(c, 1e9).i).toBe(c.frameCount - 1);
  });

  it("interpolates progress and inverts it", () => {
    expect(progressAt(c, 1.05)).toBeCloseTo(52.5, 1);
    expect(timeAtProgress(c, -5)).toBe(0);
    expect(timeAtProgress(c, 100)).toBeCloseTo(2, 2);
    expect(timeAtProgress(c, 1e9)).toBeNull();
  });

  it("samples with continuous s across the line", () => {
    const tLine = L / 50;
    const before = sampleCar(c, tLine - 0.05);
    const after = sampleCar(c, tLine + 0.05);
    expect(before.s).toBeGreaterThan(L - 5);
    expect(after.s).toBeLessThan(5);
    expect(after.progress).toBeGreaterThan(before.progress);
    expect(sampleCar(c, 1e9).ended).toBe(true);
  });

  it("tracks status and laps over time", () => {
    expect(statusAt(c, 0)).toBe("RUNNING");
    expect(statusAt(c, 1e9)).toBe("FINISHED");
    const mid = lapInfoAt(c, L / 50 + 1);
    expect(mid.completed).toBe(1);
    expect(mid.best).toBeCloseTo(L / 50 + 1);
    const end = lapInfoAt(c, 1e9);
    expect(end.completed).toBe(2);
    expect(end.lastValid).toBe(false);
    expect(end.best).toBeCloseTo(L / 50 + 1);
    expect(lapInfoAt(c, 0)).toEqual({
      completed: 0,
      last: null,
      lastValid: true,
      best: null,
      currentLapStart: 0,
    });
  });

  it("falls back to the result status when no status event exists", () => {
    const bare = { ...car, events: car.events.filter((e) => e.type !== "status") };
    const ci = indexCar(bare, 0, 10, L);
    expect(ci.statuses).toEqual([{ t: ci.endTime, status: "FINISHED" }]);
    const running = { ...bare, result: { ...bare.result, status: "RUNNING" as const } };
    expect(indexCar(running, 0, 10, L).statuses).toEqual([]);
  });

  it("finds the overall best lap", () => {
    const cars = indexReplay(
      makeReplay([makeCar(track, { id: "a", speed: 50 }), makeCar(track, { id: "b", speed: 52 })], track),
    );
    expect(overallBestAt(cars, 0)).toBeNull();
    expect(overallBestAt(cars, 1e9)!.id).toBe("b");
  });
});

describe("liveStandings", () => {
  const cars = indexReplay(
    makeReplay(
      [
        makeCar(track, { id: "slow", speed: 40 }),
        makeCar(track, { id: "fast", speed: 50 }),
        makeCar(track, { id: "mid", speed: 48 }),
        makeCar(track, { id: "dnf", speed: 49, dnfAt: 5 }),
        makeCar(track, { id: "crawl", speed: 20 }),
      ],
      track,
    ),
  );

  it("orders running cars by distance with time gaps", () => {
    const rows = liveStandings(cars, 4, 2);
    expect(rows.map((r) => r.id)).toEqual(["fast", "dnf", "mid", "slow", "crawl"]);
    expect(rows[0]!.gapText).toBe("LEADER");
    expect(rows[0]!.intervalText).toBe("INTERVAL");
    expect(rows[2]!.gap).toBeCloseTo(4 - (48 * 4) / 50, 1);
    expect(rows[2]!.gapText).toMatch(/^\+0\.1/);
    expect(rows[1]!.lap).toBe(1);
  });

  it("puts retirements last and finished cars first", () => {
    const t = (2 * L) / 48 + 0.5;
    const rows = liveStandings(cars, t, 2);
    expect(rows.map((r) => r.id)).toEqual(["fast", "mid", "slow", "crawl", "dnf"]);
    expect(rows[0]!.gapText).toBe("WINNER");
    expect(rows[0]!.intervalText).toBe("WINNER");
    expect(rows[1]!.finished).toBe(true);
    expect(rows[1]!.gap).toBeCloseTo((2 * L) / 48 - (2 * L) / 50, 2);
    expect(rows[4]!.out).toBe(true);
    expect(rows[4]!.gapText).toBe("OUT");
    expect(rows[3]!.lapsDown).toBe(1);
    expect(rows[3]!.gapText).toBe("+1 LAP");
    expect(leaderLap(rows, 2)).toBe(2);
    expect(leaderLap([], 2)).toBe(0);
  });

  it("uses the gap to leader as interval behind a retired car", () => {
    const only = indexReplay(
      makeReplay(
        [
          makeCar(track, { id: "a", speed: 50 }),
          makeCar(track, { id: "b", speed: 45 }),
          makeCar(track, { id: "x", speed: 49, dnfAt: 1 }),
        ],
        track,
      ),
    );
    const rows = liveStandings(only, 3, 2);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "x"]);
    expect(leaderLap(rows, 2)).toBe(1);
  });

  it("reports interval laps and unreachable distances", () => {
    const a = cars[1]!;
    const crawl = cars[4]!;
    expect(timeGap(a, crawl, 35).lapsDown).toBe(1);
    const ahead = indexCar(makeCar(track, { id: "z", speed: 50, startS: 100 }), 9, 10, L);
    const behind = indexCar(makeCar(track, { id: "y", speed: 50 }), 8, 10, L);
    expect(timeGap(ahead, behind, 0)).toEqual({ gap: 0, lapsDown: 0 });
    expect(timeGap(behind, ahead, 1)).toEqual({ gap: null, lapsDown: 0 });
  });
});

function row(
  id: string,
  position: number,
  interval: number | null,
  extra: Partial<StandingRow> = {},
): StandingRow {
  return {
    id,
    index: position - 1,
    position,
    name: id,
    color: "#fff",
    progress: 0,
    lap: 1,
    status: "RUNNING",
    finished: false,
    out: false,
    gap: interval,
    interval,
    lapsDown: 0,
    gapText: "",
    intervalText: "",
    ...extra,
  };
}

describe("director", () => {
  it("follows the leader without battles, else the closest battle", () => {
    expect(pickFocus([row("a", 1, null), row("b", 2, 3)])).toEqual({
      primary: "a",
      secondary: null,
      reason: "leader",
    });
    expect(pickFocus([row("a", 1, null)]).reason).toBe("solo");
    const f = pickFocus([
      row("a", 1, null),
      row("b", 2, 1.1),
      row("c", 3, 0.2),
      row("d", 4, 0.1, { lapsDown: 1 }),
    ]);
    expect(f).toEqual({ primary: "c", secondary: "b", reason: "battle" });
    expect(pickFocus([row("a", 1, null, { finished: true }), row("b", 2, null, { out: true })])).toEqual({
      primary: "a",
      secondary: null,
      reason: "solo",
    });
    expect(pickFocus([]).primary).toBe("");
    expect(
      pickFocus([row("a", 1, null, { finished: true }), row("b", 2, 0.3), row("c", 3, 0.1)]).primary,
    ).toBe("c");
  });

  const ctx = (wallTime: number, over: Partial<Parameters<typeof directorStep>[2]> = {}) => ({
    wallTime,
    speed: 1,
    nextCam: () => 3,
    camPassed: () => false,
    ...over,
  });

  it("holds shots, switches focus after the minimum hold and cuts to trackside", () => {
    const leaderOnly = [row("a", 1, null), row("b", 2, 5)];
    const battle = [row("a", 1, null), row("b", 2, 0.3)];
    const s0 = directorStep(null, leaderOnly, ctx(0));
    expect(s0).toMatchObject({ kind: "heli", primary: "a", start: 0 });
    expect(directorStep(s0, battle, ctx(1))).toBe(s0);
    const s1 = directorStep(s0, battle, ctx(DEFAULT_DIRECTOR.minHold + 0.1));
    expect(s1).toMatchObject({ kind: "heli", primary: "b", secondary: "a" });
    const s2 = directorStep(s1, battle, ctx(s1.start + DEFAULT_DIRECTOR.heliMax + 0.1));
    expect(s2).toMatchObject({ kind: "trackside", cam: 3 });
    expect(directorStep(s2, battle, ctx(s2.start + 1))).toBe(s2);
    const s3 = directorStep(s2, battle, ctx(s2.start + 1, { camPassed: () => true }));
    expect(s3.kind).toBe("heli");
    const s4 = directorStep(s2, battle, ctx(s2.start + DEFAULT_DIRECTOR.tracksideMax));
    expect(s4.kind).toBe("heli");
    const fast = directorStep(s2, battle, ctx(s2.start + 1, { speed: 30 }));
    expect(fast.kind).toBe("heli");
    const noCam = directorStep(s1, battle, ctx(s1.start + 100, { nextCam: () => null }));
    expect(noCam).toBe(s1);
  });

  it("leaves a finished car at once and honours a forced car", () => {
    const s: Shot = { primary: "a", secondary: null, reason: "leader", kind: "heli", cam: -1, start: 0 };
    const rows = [row("a", 1, null, { finished: true }), row("b", 2, null)];
    expect(directorStep(s, rows, ctx(0.5)).primary).toBe("b");
    expect(directorStep(s, [row("b", 1, null)], ctx(0.5)).primary).toBe("b");
    const forced = directorStep(s, rows, ctx(0.5, { forced: "a" }));
    expect(forced).toBe(s);
    const forcedB = directorStep(s, rows, ctx(10, { forced: "b" }));
    expect(forcedB.primary).toBe("b");
  });
});
