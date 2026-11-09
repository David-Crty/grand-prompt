import { describe, expect, it } from "vitest";
import { detectCorners } from "../src/lib/corners.js";
import { indexReplay } from "../src/lib/frames.js";
import { bestLapNumber, bestLapTraces, lapTrace, tracePath } from "../src/lib/laps.js";
import { dnfText, raceMessages, TOAST_KIND, toastLife, visibleToasts } from "../src/lib/messages.js";
import { buildModel } from "../src/lib/model.js";
import { makeCar, makeReplay, stadiumTrack } from "./fixtures.js";

const track = stadiumTrack();

describe("laps", () => {
  const cars = indexReplay(
    makeReplay(
      [
        makeCar(track, { id: "a", speed: 50 }),
        makeCar(track, { id: "b", speed: 45, bestLapNumber: null, invalidLaps: [2] }),
        makeCar(track, { id: "c", speed: 45, bestLapNumber: null, invalidLaps: [1, 2] }),
      ],
      track,
    ),
  );
  it("picks the best lap from the result or the events", () => {
    expect(bestLapNumber(cars[0]!)).toBe(2);
    expect(bestLapNumber(cars[1]!)).toBe(1);
    expect(bestLapNumber(cars[2]!)).toBeNull();
  });
  it("bins speed against distance", () => {
    const tr = lapTrace(cars[0]!, 1, 10)!;
    expect(tr.s[0]).toBe(5);
    expect(tr.speed.every((v) => v === 50)).toBe(true);
    expect(tr.time).toBeCloseTo(track.length / 50 + 1);
    expect(lapTrace(cars[0]!, 9)).toBeNull();
    const all = bestLapTraces(cars, 20);
    expect(all.map((t) => t.carId)).toEqual(["a", "b"]);
    const path = tracePath(tr, track.length, 0, 100, 100, 50);
    expect(path.split(" ")[0]).toBe("0.5,25.0");
    expect(tracePath({ ...tr, s: [0], speed: [3] }, 10, 3, 3, 10, 10)).toBe("0.0,10.0");
    const noEvent = { ...cars[0]!, laps: [] };
    expect(lapTrace(noEvent, 1)!.time).toBeNull();
  });
});

describe("messages", () => {
  const car = makeCar(track, {
    id: "a",
    speed: 50,
    invalidLaps: [2],
    extraEvents: [
      { t: 1, type: "penalty", lap: 1, value: 5, detail: "track limits" },
      { t: 2, type: "penalty", lap: 1 },
      { t: 3, type: "warning", lap: 1, value: 2 },
      { t: 3.5, type: "warning", lap: 1 },
      { t: 4, type: "crash", lap: 1, value: 30 },
      { t: 4.2, type: "crash", lap: 1 },
      { t: 5, type: "impact", lap: 1, value: 5 },
      { t: 5.5, type: "impact", lap: 1 },
      { t: 6, type: "strike", lap: 1, detail: "TypeError" },
      { t: 6.5, type: "strike", lap: 1 },
      { t: 7, type: "offTrack", lap: 1, value: 2 },
      { t: 7.5, type: "status", lap: 1, detail: "RUNNING" },
      { t: 8, type: "sector", lap: 1, value: 1 },
    ],
  });
  const dnf = makeCar(track, { id: "b", speed: 49, dnfAt: 9 });
  const msgs = raceMessages(indexReplay(makeReplay([car, dnf], track)), detectCorners(track));
  it("turns events into race-control messages", () => {
    const texts = msgs.map((m) => m.text);
    expect(texts).toContain("5s penalty: track limits");
    expect(texts).toContain("0s penalty");
    expect(texts).toContain("Track limits warning 2");
    expect(texts).toContain("Track limits warning");
    expect(texts).toContain("Lights out · 2 cars · ghost race");
    expect(texts).toContain("Crashed at 108 km/h · before Turn 1");
    expect(texts).toContain("Crashed at 0 km/h · before Turn 1");
    expect(texts).toContain("Barrier contact at 18 km/h");
    expect(texts).toContain("Barrier contact at 0 km/h");
    expect(texts).toContain("Driver code fault: TypeError");
    expect(texts).toContain("Driver code fault");
    expect(texts).toContain("Crashed: barrier · Turn 1");
    expect(texts).toContain("Lap 2 deleted: track limits");
    expect(texts).toContain("Chequered flag · Car a wins");
    expect(msgs.filter((m) => m.kind === "fastest")).toHaveLength(1);
    for (let k = 1; k < msgs.length; k++) expect(msgs[k]!.t).toBeGreaterThanOrEqual(msgs[k - 1]!.t);
  });
  it("shows toasts for their lifetime, retirements longest, folding warnings into them", () => {
    const at = (t: number, speed = 1) => visibleToasts(msgs, t, speed, 3).map((m) => m.kind);
    expect(at(0.5)).toEqual(["start"]);
    expect(at(6.2)).toEqual(["impact", "impact", "strike"]);
    // b retires at 9; its own warnings would fold, a's stay.
    expect(at(9.1)).toContain("dnf");
    expect(at(30)).toEqual(["crash", "crash", "dnf"]);
    expect(at(60)).toEqual(["finish"]);
    expect(at(90)).toEqual([]);
    // At 8x every message lives four times longer; still three at most.
    expect(at(60, 8)).toHaveLength(3);
    const warnBeforeOut = [
      { t: 10, carId: "x", name: "", color: "", kind: "warning" as const, text: "w", lap: 1 },
      { t: 11, carId: "x", name: "", color: "", kind: "dnf" as const, text: "out", lap: 1 },
    ];
    expect(visibleToasts(warnBeforeOut, 11.5, 1).map((m) => m.kind)).toEqual(["dnf"]);
    expect(TOAST_KIND.fastest).toBe("fastest");
    expect(toastLife(warnBeforeOut[0]!)).toBe(8);
    expect(toastLife(warnBeforeOut[1]!)).toBe(30);
  });
  it("words retirements", () => {
    expect(dnfText("DNF: STALLED", "Turn 3")).toBe("Stalled · Turn 3");
    expect(dnfText("DNF: ECU FAILURE (TypeError: x)", "")).toBe("Ecu failure: TypeError: x");
    expect(dnfText("odd", "Turn 1")).toBe("odd · Turn 1");
  });
});

describe("buildModel", () => {
  it("derives everything the viewer needs", () => {
    const r = makeReplay(
      [makeCar(track, { id: "a", speed: 50 }), makeCar(track, { id: "b", speed: 48 })],
      track,
    );
    const m = buildModel(r, 100);
    expect(m.cars).toHaveLength(2);
    expect(m.duration).toBeCloseTo((2 * track.length) / 48, 0);
    expect(m.totalLaps).toBe(2);
    expect(m.trees).toHaveLength(100);
    expect(m.traces).toHaveLength(2);
    expect(m.messages.length).toBeGreaterThan(0);
    const unseeded = buildModel({ ...r, header: { ...r.header, seed: 0 } }, 10);
    expect(unseeded.trees).toHaveLength(10);
  });
});
