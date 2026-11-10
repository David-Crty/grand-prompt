import { describe, expect, it } from "vitest";
import { indexReplay, sampleCar } from "../src/lib/frames.js";
import {
  carPlacement,
  findPacks,
  holdPack,
  labelPack,
  PACK_JOIN_HOLD,
  PACK_LEAVE_HOLD,
  type PackCar,
  type PackHold,
  packChips,
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
    expect(findPacks([car("a", 0), car("b", 100)], 8.4)).toEqual([]);
    const two = findPacks([car("a", 0), car("b", 1), car("c", 50), car("d", 51), car("e", 52)], 8.4);
    expect(two.map((p) => p.ids)).toEqual([
      ["e", "d", "c"],
      ["b", "a"],
    ]);
  });

  it("labels one pack of three or more besides the followed car", () => {
    const lp = labelPack(packs, "ast")!;
    expect(lp.others).toEqual(["fab", "hai", "son", "lun", "ter", "opu"]);
  });

  it("lists the pack's cars by code, whatever the running order, up to a maximum, and counts the rest", () => {
    const code = (id: string) => id.toUpperCase();
    const others = ["fab", "hai", "son", "lun", "ter", "opu"];
    expect(packChips(others, code, 4)).toEqual({ ids: ["fab", "hai", "lun", "opu"], hidden: 2 });
    expect(packChips([...others].reverse(), code, 4)).toEqual(packChips(others, code, 4));
    expect(packChips(others, code, 9)).toEqual({
      ids: ["fab", "hai", "lun", "opu", "son", "ter"],
      hidden: 0,
    });
    expect(packChips(["b", "a"], () => "X", 9).ids).toEqual(["a", "b"]);
    expect(packChips([], code, 4)).toEqual({ ids: [], hidden: 0 });
    expect(labelPack(findPacks([car("a", 0), car("b", 1), car("c", 2)], 8.4), "a")).toBeNull();
  });
});

describe("held pack label", () => {
  const alive = new Set(["f", "a", "b", "c"]);
  const step = 0.25;
  const run = (raws: string[][], start: PackHold | null) => {
    let h = start;
    const seen: string[][] = [];
    for (const raw of raws) {
      h = holdPack(h, raw, "f", alive, step);
      seen.push(h.ids);
    }
    return { h: h!, seen };
  };

  it("decides at once on a new focus or with no history", () => {
    expect(holdPack(null, ["a", "b", "x"], "f", alive, step).ids).toEqual(["a", "b"]);
    const other = { focusId: "z", ids: ["c"], wait: {} };
    expect(holdPack(other, ["a"], "f", alive, step).ids).toEqual(["a"]);
  });

  it("lets cars join only after the join hold, and restarts it when they drift out", () => {
    const start = { focusId: "f", ids: [], wait: {} };
    const n = Math.ceil(PACK_JOIN_HOLD / step);
    const { h, seen } = run(Array(n).fill(["a", "b", "c"]), start);
    expect(seen.slice(0, -1).every((ids) => ids.length === 0)).toBe(true);
    expect(h.ids).toEqual(["a", "b", "c"]);
    expect(h.wait).toEqual({});
    const flicker = run([["a"], [], ["a"], [], ["a"]], start);
    expect(flicker.seen.every((ids) => ids.length === 0)).toBe(true);
  });

  it("keeps cars for the leave hold, but drops a stopped car and the focus at once", () => {
    const start = { focusId: "f", ids: ["a", "b", "c"], wait: {} };
    const n = Math.ceil(PACK_LEAVE_HOLD / step);
    const { h, seen } = run(Array(n).fill([]), start);
    expect(seen.slice(0, -1).every((ids) => ids.length === 3)).toBe(true);
    expect(h.ids).toEqual([]);
    const gone = holdPack(start, ["a", "b", "c"], "f", new Set(["a", "b"]), step);
    expect(gone.ids).toEqual(["a", "b"]);
    expect(holdPack({ ...start, ids: ["a", "f"] }, ["a"], "f", new Set(["a", "f"]), step).ids).toEqual(["a"]);
  });
});

describe("what viewers see is what was timed", () => {
  it("draws every car exactly at its replay sample, in a pack or not", () => {
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
      findPacks(
        samples.map((s, k) => ({
          id: cars[k]!.car.id,
          x: s.x,
          y: s.y,
          progress: s.progress,
          ended: s.ended,
        })),
        8.4,
      );
      samples.forEach((s, k) => {
        const p = carPlacement(s);
        expect(p.position).toEqual([s.x, 0, -s.y]);
        expect(p.yaw).toBe(s.yaw);
        expect(sampleCar(cars[k]!, t)).toEqual(s);
      });
    }
  });
});
