import { gapLabel } from "@bench/ui";
import { describe, expect, it } from "vitest";
import {
  frameAt,
  indexCar,
  indexReplay,
  progressAt,
  sampleCar,
  statusAt,
  timeAtProgress,
} from "../src/lib/frames.js";
import { liveStandings, timeGap } from "../src/lib/timing.js";
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
    expect(c.lapValid).toBe(false);
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

  it("tracks status over time", () => {
    expect(statusAt(c, 0)).toBe("RUNNING");
    expect(statusAt(c, 1e9)).toBe("FINISHED");
  });

  it("falls back to the result status when no status event exists", () => {
    const bare = { ...car, events: car.events.filter((e) => e.type !== "status") };
    const ci = indexCar(bare, 0, 10, L);
    expect(ci.statuses).toEqual([{ t: ci.endTime, status: "FINISHED" }]);
    const running = { ...bare, result: { ...bare.result, status: "RUNNING" as const } };
    expect(indexCar(running, 0, 10, L).statuses).toEqual([]);
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
    const rows = liveStandings(cars, 4);
    expect(rows.map((r) => r.id)).toEqual(["fast", "dnf", "mid", "slow", "crawl"]);
    expect(gapLabel(rows[0]!).text).toBe("LEADER");
    expect(gapLabel(rows[0]!, "interval").text).toBe("INTERVAL");
    expect(rows[2]!.gap).toBeCloseTo(4 - (48 * 4) / 50, 1);
    expect(gapLabel(rows[2]!).text).toMatch(/^\+0\.1/);
  });

  it("puts retirements last and finished cars first", () => {
    const t = (2 * L) / 48 + 0.5;
    const rows = liveStandings(cars, t);
    expect(rows.map((r) => r.id)).toEqual(["fast", "mid", "slow", "crawl", "dnf"]);
    expect(gapLabel(rows[0]!).text).toBe("POLE");
    expect(gapLabel(rows[0]!, "interval").text).toBe("POLE");
    expect(rows[1]!.finished).toBe(true);
    expect(rows[1]!.gap).toBeCloseTo((2 * L) / 48 - (2 * L) / 50, 2);
    expect(rows[1]!.interval).toBeCloseTo(rows[1]!.gap!, 6);
    expect(rows[4]!.out).toBe(true);
    expect(rows[4]!.gap).toBeNull();
    expect(gapLabel(rows[4]!).text).toBe("OUT");
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
    const rows = liveStandings(only, 3);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "x"]);
    expect(rows[1]!.interval).toBeCloseTo(rows[1]!.gap!, 6);
  });

  it("puts a finished car whose lap was deleted after the running cars, without a time", () => {
    const mixed = indexReplay(
      makeReplay(
        [
          makeCar(track, { id: "deleted", speed: 50, invalidLaps: [1, 2] }),
          makeCar(track, { id: "timed", speed: 48 }),
          makeCar(track, { id: "running", speed: 20 }),
          makeCar(track, { id: "out", speed: 49, dnfAt: 1 }),
        ],
        track,
      ),
    );
    expect(mixed[0]!.lapValid).toBe(false);
    const rows = liveStandings(mixed, (2 * L) / 48 + 0.5);
    expect(rows.map((r) => r.id)).toEqual(["timed", "running", "deleted", "out"]);
    expect(gapLabel(rows[2]!).text).toBe("NO TIME");
    expect(rows[2]!.finished).toBe(true);
    expect(rows[2]!.gap).toBeNull();
    expect(gapLabel(rows[3]!, "interval").text).toBe("OUT");
  });

  it("reports a gap only once the car ahead has been where the other is", () => {
    const ahead = indexCar(makeCar(track, { id: "z", speed: 50, startS: 100 }), 9, 10, L);
    const behind = indexCar(makeCar(track, { id: "y", speed: 50 }), 8, 10, L);
    expect(timeGap(ahead, behind, 0)).toBe(0);
    expect(timeGap(behind, ahead, 1)).toBeNull();
  });
});
