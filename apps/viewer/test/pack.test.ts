import { describe, expect, it } from "vitest";
import { indexReplay, sampleCar } from "../src/lib/frames.js";
import {
  carPlacement,
  findPacks,
  ghostIds,
  labelPack,
  launchBoard,
  type PackCar,
  packGroups,
  startBoardVisible,
} from "../src/lib/pack.js";
import { makeCar, makeReplay, stadiumTrack } from "./fixtures.js";

const car = (id: string, progress: number, o: Partial<PackCar> = {}): PackCar => ({
  id,
  x: progress,
  y: 0,
  progress,
  ended: false,
  ...o,
});

describe("packs", () => {
  // A ghost start: three identical launches at 15.7 m, a chain up to the leader, one car clear ahead.
  const field = [
    car("opu", 15.6),
    car("son", 15.7),
    car("lun", 15.7),
    car("ter", 15.7),
    car("hai", 18.3),
    car("ast", 24.3),
    car("fab", 29.9),
    car("far", 60),
    car("out", 16, { ended: true }),
  ];
  const packs = findPacks(field, 8.4);

  it("chains cars closer than the pack distance, in running order, leaving stopped cars out", () => {
    expect(packs).toHaveLength(1);
    expect(packs[0]!.ids).toEqual(["fab", "ast", "hai", "son", "lun", "ter", "opu"]);
    expect(packs[0]!.same).toEqual([["son", "lun", "ter"]]);
    expect(findPacks([car("a", 0), car("b", 100)], 8.4)).toEqual([]);
    const two = findPacks([car("a", 0), car("b", 1), car("c", 50), car("d", 51), car("e", 52)], 8.4);
    expect(two.map((p) => p.ids)).toEqual([
      ["e", "d", "c"],
      ["b", "a"],
    ]);
  });

  it("keeps the followed car solid, or the front car when the followed car is elsewhere", () => {
    const g = ghostIds(packs, "ast");
    expect(g.has("ast")).toBe(false);
    expect(g.has("fab")).toBe(true);
    expect(g.size).toBe(6);
    const away = ghostIds(packs, "far");
    expect(away.has("fab")).toBe(false);
    expect(away.size).toBe(6);
  });

  it("labels one pack of three or more besides the followed car, with identical places grouped", () => {
    const lp = labelPack(packs, "ast")!;
    expect(lp.others).toEqual(["fab", "hai", "son", "lun", "ter", "opu"]);
    expect(packGroups(lp, lp.others)).toEqual([["fab"], ["hai"], ["son", "lun", "ter"], ["opu"]]);
    expect(packGroups(lp, ["lun", "opu"])).toEqual([["lun"], ["opu"]]);
    expect(labelPack(findPacks([car("a", 0), car("b", 1), car("c", 2)], 8.4), "a")).toBeNull();
  });
});

describe("start board", () => {
  it("lists distance from the line, front first, with identical launches", () => {
    const b = launchBoard([
      { id: "a", progress: 15.71, ended: false },
      { id: "b", progress: 29.9, ended: false },
      { id: "c", progress: 15.69, ended: false },
      { id: "d", progress: -0.2, ended: false },
    ]);
    expect(b.rows.map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
    expect(b.rows[3]!.distance).toBe(0);
    expect(b.same).toEqual([["a", "c"]]);
    expect(b.scale).toBe(60);
    expect(b.spread).toBeCloseTo(30.1, 6);
    expect(launchBoard([{ id: "a", progress: 75, ended: false }]).scale).toBe(80);
    expect(launchBoard([{ id: "a", progress: 5, ended: true }]).spread).toBe(0);
  });
  it("shows for the first 15 s while the field is within 60 m", () => {
    expect(startBoardVisible(2.5, 14)).toBe(true);
    expect(startBoardVisible(15, 14)).toBe(false);
    expect(startBoardVisible(8, 60)).toBe(false);
  });
});

describe("what viewers see is what was timed", () => {
  it("draws every car exactly at its replay sample, ghost or not", () => {
    const track = stadiumTrack();
    // Identical launches: every car on the same line at the same time.
    const cars = indexReplay(
      makeReplay(
        [
          makeCar(track, { id: "a", speed: 50 }),
          makeCar(track, { id: "b", speed: 50 }),
          makeCar(track, { id: "c", speed: 48 }),
        ],
        track,
      ),
    );
    for (const t of [0, 0.5, 2.5, 10, 30]) {
      const samples = cars.map((c) => sampleCar(c, t));
      const packs = findPacks(
        samples.map((s, k) => ({
          id: cars[k]!.car.id,
          x: s.x,
          y: s.y,
          progress: s.progress,
          ended: s.ended,
        })),
        8.4,
      );
      ghostIds(packs, "a");
      samples.forEach((s, k) => {
        const p = carPlacement(s);
        expect(p.position).toEqual([s.x, 0, -s.y]);
        expect(p.yaw).toBe(s.yaw);
        expect(sampleCar(cars[k]!, t)).toEqual(s);
      });
    }
  });
});
