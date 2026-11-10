import { describe, expect, it } from "vitest";
import {
  analysisData,
  analysisPair,
  brakeText,
  bySector,
  type CornerFacts,
  cornerFacts,
  cornerSegments,
  cornerTimes,
  deltaSeries,
  fastestCounts,
  fieldGrid,
  type LapProfile,
  lapProfile,
  lapProfiles,
  type PairRow,
  pairRows,
  pairSummary,
  watchTime,
} from "../src/lib/analysis.js";
import { type Corner, detectCorners } from "../src/lib/corners.js";
import { indexReplay } from "../src/lib/frames.js";
import { buildMinimap, cornerLabelAt, stretchPath } from "../src/lib/minimap.js";
import { buildLayout } from "../src/lib/track.js";
import { makeCar, makeReplay, stadiumTrack } from "./fixtures.js";

const track = stadiumTrack();
const replay = makeReplay(
  [
    makeCar(track, { id: "b", speed: 45 }),
    makeCar(track, { id: "a", speed: 50 }),
    makeCar(track, { id: "c", speed: 40, dnfAt: 5 }),
  ],
  track,
);
const cars = indexReplay(replay);
const [carB, carA, carC] = cars as [(typeof cars)[0], (typeof cars)[0], (typeof cars)[0]];
const corners = detectCorners(track);

const corner = (n: number, sStart: number, sEnd: number, dir: "L" | "R" = "L"): Corner => ({
  n,
  sStart,
  sEnd,
  sApex: (sStart + sEnd) / 2,
  dir,
  minRadius: 30,
});
const facts = (brakeS: number | null, peakBrake = 0.5, apexKmh = 100): CornerFacts => ({
  apexKmh,
  apexS: 0,
  brakeS,
  peakBrake,
});

describe("laps and gaps", () => {
  it("profiles the timed laps, fastest first, and measures the gap at equal distance", () => {
    const profiles = lapProfiles(cars, 10);
    expect(profiles.map((p) => p.id)).toEqual(["a", "b"]);
    const a = profiles[0]!;
    expect(a.speedKmh.every((v) => Math.abs(v - 180) < 1e-9)).toBe(true);
    expect(a.throttle[0]).toBe(1);
    expect(a.time).toBe(carA.car.result.lapTime);
    expect(lapProfile({ ...carA, car: { ...carA.car, frames: { ...carA.car.frames, lap: [] } } })).toBeNull();
    const d = deltaSeries(carA, carB, 50)!;
    expect(d.s.at(-1)).toBe(track.length);
    expect(d.dt.at(-1)).toBeCloseTo(carB.car.result.lapTime! - carA.car.result.lapTime!, 9);
    expect(d.dt[10]!).toBeGreaterThan(0);
    expect(deltaSeries(carA, carC)).toBeNull();
  });
});

describe("corners", () => {
  it("cuts the lap halfway along each straight, or on the sector line that lies there", () => {
    const segs = cornerSegments(
      [corner(1, 100, 200), corner(2, 400, 500), corner(3, 800, 900)],
      1000,
      [300, 950],
    );
    expect(segs).toEqual([
      { n: 1, from: 0, to: 300, sector: 0 },
      { n: 2, from: 300, to: 650, sector: 1 },
      { n: 3, from: 650, to: 1000, sector: 2 },
    ]);
    expect(cornerSegments([], 1000, [300])).toEqual([]);
  });

  it("times each corner so the corners add up to the lap", () => {
    expect(corners).toHaveLength(2);
    const segs = cornerSegments(corners, track.length, track.sectors);
    const a = cornerTimes(carA, segs)!;
    expect(a.reduce((x, y) => x + y, 0)).toBeCloseTo(carA.car.result.lapTime!, 9);
    expect(a[0]!).toBeCloseTo(segs[0]!.to / 50, 1);
    expect(cornerTimes(carC, segs)).toBeNull();
    expect(
      cornerTimes({ ...carA, car: { ...carA.car, frames: { ...carA.car.frames, lap: [] } } }, segs),
    ).toBeNull();
  });

  it("finds the apex speed, the braking point and the peak brake", () => {
    const p: LapProfile = {
      id: "p",
      time: 10,
      s: [5, 15, 25, 35, 45, 55, 65, 75],
      speedKmh: [200, 200, 180, 150, 100, 90, 120, 160],
      throttle: [1, 1, 0, 0, 0, 0, 1, 1],
      brake: [0, 0.02, 0.3, 0.5, 0.1, 0, 0, 0],
    };
    expect(cornerFacts(p, corner(1, 40, 60), 0)).toEqual({
      apexKmh: 90,
      apexS: 55,
      brakeS: 25,
      peakBrake: 0.5,
    });
    const rising = { ...p, speedKmh: [100, 120, 140, 130, 125, 135, 150, 170] };
    expect(cornerFacts(rising, corner(1, 40, 60), 0)).toMatchObject({ apexKmh: 125, apexS: 45 });
    const climbing = { ...p, speedKmh: [100, 110, 120, 130, 140, 150, 160, 170] };
    expect(cornerFacts(climbing, corner(1, 40, 60), 0)).toMatchObject({ apexKmh: 140, apexS: 45 });
    const lift = { ...p, brake: p.brake.map(() => 0.03) };
    expect(cornerFacts(lift, corner(1, 40, 60), 0)).toMatchObject({ brakeS: null, peakBrake: 0 });
    expect(cornerFacts(p, corner(1, 400, 420), 300)).toEqual({
      apexKmh: 0,
      apexS: 410,
      brakeS: null,
      peakBrake: 0,
    });
  });

  it("says where and how hard the car brakes against the reference", () => {
    const t = (a: CornerFacts, b: CornerFacts) => brakeText({ car: a, ref: b }, "AST");
    expect(t(facts(null), facts(null))).toBe("–");
    expect(t(facts(null), facts(20))).toBe("lifts, AST brakes");
    expect(t(facts(20), facts(null))).toBe("brakes, AST lifts");
    expect(t(facts(103), facts(100))).toBe("same point");
    expect(t(facts(107), facts(100))).toBe("5 m later");
    expect(t(facts(115, 0.3), facts(100, 0.5))).toBe("15 m later, softer");
    expect(t(facts(88, 0.7), facts(100, 0.5))).toBe("10 m earlier, harder");
  });
});

describe("the pair", () => {
  const row = (n: number, sector: number, dt: number, car: number, ref: number): PairRow => ({
    k: n - 1,
    n,
    sector,
    dt,
    car: facts(10, 0.5, car),
    ref: facts(10, 0.5, ref),
  });
  const rows = [
    row(1, 0, 0.16, 87, 91),
    row(2, 0, 0.52, 157, 171),
    row(3, 1, 0.3, 103, 115),
    row(8, 2, -0.34, 51, 43),
    row(5, 2, 0.02, 221, 219),
  ];

  it("sums up where the gap is made and given back", () => {
    expect(pairSummary(rows, "FAB", "AST", 1.13, { car: 331, ref: 332 })).toEqual({
      lead: "FAB is 1.130 s slower than AST.",
      rest: "It loses the most in T2 (0.52 s, 14 km/h slower at the apex) and T3 (0.30 s), and gets 0.34 s back in T8, 8 km/h faster at the apex.",
    });
    const flip = rows.map((r) => ({ ...r, dt: -r.dt, car: r.ref, ref: r.car }));
    expect(pairSummary(flip, "AST", "FAB", -1.13, { car: 332, ref: 331 }).rest).toBe(
      "It gains the most in T2 (0.52 s, 14 km/h faster at the apex) and T3 (0.30 s), and gives 0.34 s away in T8, 8 km/h slower at the apex.",
    );
  });

  it("mentions the top speed when it differs, and stays quiet about small corners", () => {
    const small = rows.map((r) => ({ ...r, dt: 0.01 }));
    expect(pairSummary(small, "SOL", "AST", 0.05, { car: 313, ref: 332 }).rest).toBe(
      "Its top speed is 313 km/h, 19 below AST's.",
    );
    expect(pairSummary(small, "OPU", "AST", 0.05, { car: 340, ref: 332 }).rest).toBe(
      "Its top speed is 340 km/h, 8 above AST's.",
    );
    const one = [row(1, 0, 0.4, 90, 91)];
    expect(pairSummary(one, "X", "Y", 0.4, { car: 300, ref: 300 }).rest).toBe(
      "It loses the most in T1 (0.40 s).",
    );
  });

  it("groups rows by sector with each sector's total", () => {
    const g = bySector(rows.slice(0, 4));
    expect(g.map((s) => s.sector)).toEqual([0, 1, 2]);
    expect(g[0]!.dt).toBeCloseTo(0.68);
    expect(g[0]!.rows).toHaveLength(2);
    expect(bySector([])).toEqual([]);
  });

  it("picks the followed car against pole, or P2 for the pole car", () => {
    const profiles = lapProfiles(cars);
    expect(analysisPair(profiles, "b")).toEqual({ car: "b", ref: "a" });
    expect(analysisPair(profiles, "a")).toEqual({ car: "a", ref: "b" });
    expect(analysisPair(profiles, "c")).toEqual({ car: "a", ref: "b" });
    expect(analysisPair(profiles, "a", "b")).toEqual({ car: "a", ref: "b" });
    expect(analysisPair(profiles, "b", "b")).toEqual({ car: "b", ref: "a" });
    expect(analysisPair(profiles, "b", "zz")).toEqual({ car: "b", ref: "a" });
    expect(analysisPair([], "a")).toEqual({ car: null, ref: null });
  });

  it("compares a real pair corner by corner, adding up to the lap gap", () => {
    const data = analysisData(cars, corners, track.sectors);
    expect(data.profiles.map((p) => p.id)).toEqual(["a", "b"]);
    expect([...data.times.keys()].sort()).toEqual(["a", "b"]);
    const [pa, pb] = data.profiles as [LapProfile, LapProfile];
    const r = pairRows(
      data.segments,
      corners,
      { times: data.times.get("b")!, profile: pb },
      { times: data.times.get("a")!, profile: pa },
    );
    expect(r.reduce((x, y) => x + y.dt, 0)).toBeCloseTo(pb.time! - pa.time!, 9);
    expect(r[0]!.car.apexKmh).toBeCloseTo(162);
    expect(r[0]!.ref.brakeS).toBeNull();
    expect(data.field.ids).toEqual(["a", "b"]);
    expect(data.field.fastest).toEqual(["a", "a"]);
    expect(data.field.ideal).toBeCloseTo(pa.time!, 9);
    expect(analysisData([], [], []).profiles).toEqual([]);
  });

  it("seeks a little before the car reaches the corner", () => {
    expect(watchTime(carA, 100)).toBeCloseTo(0.5);
    expect(watchTime(carA, 10)).toBe(0);
    expect(watchTime(carC, 1e6)).toBe(0);
  });
});

describe("the field", () => {
  it("measures every car against the fastest through each corner", () => {
    const f = fieldGrid([
      { id: "a", times: [1, 2, 3] },
      { id: "b", times: [1.5, 1.8, 3] },
    ]);
    expect(f.ids).toEqual(["a", "b"]);
    expect(f.loss[0]![1]).toBeCloseTo(0.2);
    expect(f.loss[1]![0]).toBeCloseTo(0.5);
    expect(f.loss[1]![1]).toBe(0);
    expect(f.fastest).toEqual(["a", "b", "a"]);
    expect(f.ideal).toBeCloseTo(5.8);
    expect(fastestCounts(f)).toEqual([
      { id: "a", count: 2 },
      { id: "b", count: 1 },
    ]);
    expect(fieldGrid([])).toEqual({ ids: [], loss: [], fastest: [], ideal: 0 });
  });

  it("draws each corner's stretch of the map and labels it on the outside", () => {
    const layout = buildLayout(track);
    const m = buildMinimap(layout, 340, 190);
    const d = stretchPath(layout, m, 0, 100);
    expect(d.startsWith("M")).toBe(true);
    expect(d.split("L")).toHaveLength(14);
    const c = corners[0]!;
    const at = cornerLabelAt(layout, m, c);
    const i = Math.round(c.sApex / layout.spacing);
    const [x, y] = m.project(layout.cx[i]!, layout.cy[i]!);
    expect(Math.hypot(at.x - x, at.y - y)).toBeCloseTo(14, 0);
    const mid = [m.width / 2, m.height / 2];
    expect(Math.hypot(at.x - mid[0]!, at.y - mid[1]!)).toBeGreaterThan(Math.hypot(x - mid[0]!, y - mid[1]!));
    const right = cornerLabelAt(layout, m, { ...c, dir: "R" });
    expect(Math.hypot(right.x - mid[0]!, right.y - mid[1]!)).toBeLessThan(
      Math.hypot(x - mid[0]!, y - mid[1]!),
    );
  });
});
