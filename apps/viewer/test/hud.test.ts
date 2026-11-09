import { describe, expect, it } from "vitest";
import { detectCorners, whereOnLap } from "../src/lib/corners.js";
import { indexReplay, sampleCar } from "../src/lib/frames.js";
import { justOut, mapCars, mapPins, outTime } from "../src/lib/hud.js";
import { impactKmh } from "../src/lib/messages.js";
import { buildModel } from "../src/lib/model.js";
import { timelineMarkers } from "../src/lib/timeline.js";
import { liveStandings } from "../src/lib/timing.js";
import { makeCar, makeReplay, stadiumTrack } from "./fixtures.js";

const track = stadiumTrack();

describe("corners", () => {
  const corners = detectCorners(track);
  it("finds the two ends of the stadium, numbered from the line", () => {
    expect(corners.map((c) => c.n)).toEqual([1, 2]);
    expect(corners[0]!.sStart).toBeCloseTo(300, 0);
    expect(corners[0]!.dir).toBe("L");
    expect(corners[0]!.minRadius).toBeCloseTo(60, 3);
  });
  it("says where a distance is", () => {
    expect(whereOnLap(corners, 400, track.length)?.text).toBe("Turn 1");
    expect(whereOnLap(corners, 520, track.length)?.text).toBe("Turn 1 exit");
    expect(whereOnLap(corners, 700, track.length)?.text).toBe("before Turn 2");
    expect(whereOnLap(corners, track.length - 1, track.length)?.text).toBe("Turn 2 exit");
    expect(whereOnLap(corners, 100 + track.length, track.length)?.text).toBe("before Turn 1");
    expect(whereOnLap([], 100, track.length)).toBeNull();
  });
  it("ignores kinks and merges close runs", () => {
    const n = 200;
    const curvature = Array.from({ length: n }, (_, i) =>
      (i >= 10 && i < 14) || (i >= 50 && i < 60) || (i >= 64 && i < 70) ? -0.02 : 0,
    );
    const c = detectCorners({ length: n * 2, spacing: 2, curvature });
    expect(c).toHaveLength(1);
    expect(c[0]!.dir).toBe("R");
    expect([c[0]!.sStart, c[0]!.sEnd]).toEqual([100, 138]);
    const ending = detectCorners({
      length: 40,
      spacing: 2,
      curvature: Array.from({ length: 20 }, () => 0.02),
    });
    expect(ending).toHaveLength(1);
  });
});

describe("hud data", () => {
  const replay = makeReplay(
    [
      makeCar(track, { id: "a", speed: 50 }),
      makeCar(track, { id: "b", speed: 48 }),
      makeCar(track, { id: "c", speed: 45, dnfAt: 12 }),
    ],
    track,
  );
  replay.classification = [{ ...replay.cars[0]!.result, position: 1, gap: null, color: "", driverHash: "" }];
  const model = buildModel(replay, 10);
  const project = (x: number, y: number): [number, number] => [x / 10, y / 10];

  it("orders minimap cars back to front, followed car last, retired cars as pins", () => {
    const t = 20;
    const rows = liveStandings(model.cars, t);
    const s = model.cars.map((c, k) => ({ ...sampleCar(c, t), x: k * 10, y: 0 }));
    const cars = mapCars(model, rows, s, "b", project);
    expect(cars.map((c) => c.id)).toEqual(["a", "b"]);
    expect(cars.find((c) => c.id === "b")?.focused).toBe(true);
    expect(mapCars(model, rows, s, "a", project).map((c) => c.id)).toEqual(["b", "a"]);
    expect(mapCars(model, rows, [], "a", project)).toEqual([]);
    const pins = mapPins(model, t, project);
    expect(pins.map((p) => p.id)).toEqual(["c"]);
    expect(pins[0]!.label).toBe(`${model.entries.get("c")!.code} out`);
    expect(mapPins(model, 5, project)).toEqual([]);
  });

  it("knows who retired and when", () => {
    const c = model.cars.find((x) => x.car.id === "c")!;
    expect(outTime(c)).toBeCloseTo(12, 6);
    expect(outTime(model.cars[0]!)).toBeNull();
    expect([...justOut(model.cars, 13)]).toEqual(["c"]);
    expect(justOut(model.cars, 30).size).toBe(0);
    expect(justOut(model.cars, 5).size).toBe(0);
  });

  it("builds timeline markers", () => {
    const kinds = model.markers.map((m) => m.kind);
    expect(kinds[0]).toBe("start");
    expect(kinds).toContain("fastest");
    expect(kinds).toContain("dnf");
    expect(kinds).toContain("finish");
    expect(model.markers.find((m) => m.kind === "dnf")?.label).toBe(`${model.entries.get("c")!.code} out`);
    const warn = timelineMarkers(
      [
        { t: 1, carId: "a", name: "", color: "", kind: "deleted", text: "Lap deleted: track limits" },
        { t: 2, carId: "a", name: "", color: "", kind: "impact", text: "x" },
        { t: 3, carId: "zz", name: "", color: "", kind: "finish", text: "P2 · 1:00.000" },
      ],
      model.entries,
    );
    expect(warn).toEqual([
      {
        t: 1,
        kind: "warn",
        label: `${model.entries.get("a")!.code} Lap deleted: track limits`,
        carIds: ["a"],
      },
    ]);
    expect(model.ghost).toBe(true);
    expect(model.corners).toHaveLength(2);
  });

  it("takes the impact speed from the sim's status when it has one", () => {
    const cars = indexReplay(
      makeReplay(
        [
          makeCar(track, {
            id: "x",
            speed: 40,
            extraEvents: [
              { t: 5, type: "status", lap: 1, detail: "DNF: CRASHED (hit the barrier at 106 km/h)" },
            ],
          }),
        ],
        track,
      ),
    );
    expect(impactKmh(cars[0]!, 29.3)).toBe(106);
    const plain = indexReplay(makeReplay([makeCar(track, { id: "y", speed: 40 })], track));
    expect(impactKmh(plain[0]!, 29.3)).toBe(105);
  });
});
