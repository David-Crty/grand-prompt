import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as baseline from "../../../ddk/baseline-driver.js";
import {
  CarSim,
  chainWays,
  importedTrackFile,
  parseTumftmCsv,
  prepareCenterline,
  projectLonLat,
  resampleClosed,
  signedArea,
  smoothClosed,
  Track,
  type TrackFile,
  type Vec2,
} from "../src/index.js";
import { protoCar } from "./helpers.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const square: Vec2[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];
const meta = {
  id: "t",
  name: "T",
  sectors: [0.3, 0.6] as [number, number],
  runoff: { default: { type: "grass" as const, width: 10 } },
  license: "test",
  source: "test",
};

describe("TUMFTM CSV", () => {
  it("parses rows and skips the header and blank lines", () => {
    const rows = parseTumftmCsv("# x_m,y_m,w_tr_right_m,w_tr_left_m\n1,2,3,4\r\n\n5.5,6,7,8\n");
    expect(rows).toEqual([
      [1, 2, 3, 4],
      [5.5, 6, 7, 8],
    ]);
  });
  it("rejects malformed rows", () => {
    expect(() => parseTumftmCsv("1,2,3")).toThrow(/bad TUMFTM row/);
    expect(() => parseTumftmCsv("1,2,x,4")).toThrow(/bad TUMFTM row/);
  });
});

describe("geometry helpers", () => {
  it("projects lon/lat to metres around an origin", () => {
    const [a, b] = projectLonLat(
      [
        [7, 43],
        [7.001, 43.001],
      ],
      [7, 43],
    );
    expect(a).toEqual([0, 0]);
    expect(b![1]).toBeCloseTo(111.19, 1);
    expect(b![0]).toBeCloseTo(111.19 * Math.cos((43 * Math.PI) / 180), 1);
  });

  it("measures orientation with the signed area", () => {
    expect(signedArea(square)).toBeCloseTo(20000);
    expect(signedArea([...square].reverse())).toBeCloseTo(-20000);
  });

  it("resamples a closed ring evenly and smooths it", () => {
    const r = resampleClosed(square, 10);
    expect(r).toHaveLength(40);
    expect(r[5]).toEqual([50, 0]);
    expect(resampleClosed(square, 1000)).toHaveLength(4);
    const s = smoothClosed(r, 1);
    expect(s).toHaveLength(40);
    // a corner is pulled inwards, a mid-side point stays on its side
    expect(s[10]![0]).toBeLessThan(100);
    expect(s[10]![1]).toBeGreaterThan(0);
    expect(s[5]![1]).toBeCloseTo(0, 6);
    expect(smoothClosed(r, 0)).toEqual(r);
  });
});

describe("chainWays", () => {
  it("joins ways in any order and direction into a ring", () => {
    const ring = chainWays([
      [
        [0, 0],
        [10, 0],
      ],
      [
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [10, 10],
        [10, 0],
      ],
    ]);
    expect(ring).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });

  it("joins at an interior node, keeping the forward direction, and bridges small gaps", () => {
    const ring = chainWays(
      [
        [
          [0, 0],
          [10, 0],
        ],
        // entered at its middle node: the stub behind it is dropped
        [
          [10, 5],
          [10, 0],
          [20, 0],
        ],
        [
          [20, 0],
          [20, 10],
        ],
        // entered at its middle node and followed backwards, the way that keeps heading on
        [
          [-1, 10],
          [20, 10],
          [30, 8],
        ],
        // a 1 m gap back to the first way
        [
          [-1, 9],
          [0, 1],
        ],
      ],
      1.5,
    );
    expect(ring).toEqual([
      [0, 0],
      [10, 0],
      [20, 0],
      [20, 10],
      [-1, 10],
      [-1, 9],
      [0, 1],
    ]);
  });

  it("reports ways that do not form a loop", () => {
    expect(() => chainWays([])).toThrow(/no ways/);
    expect(() =>
      chainWays([
        [
          [0, 0],
          [1, 0],
        ],
        [
          [5, 5],
          [6, 6],
        ],
      ]),
    ).toThrow(/no way continues/);
    expect(() =>
      chainWays([
        [
          [0, 0],
          [1, 0],
        ],
        [
          [1, 0],
          [2, 0],
        ],
      ]),
    ).toThrow(/do not close/);
  });
});

describe("prepareCenterline and importedTrackFile", () => {
  const circle: Vec2[] = Array.from({ length: 90 }, (_, i) => {
    const a = (i / 90) * 2 * Math.PI;
    return [200 * Math.cos(a), 200 * Math.sin(a)];
  });

  it("orients, starts at the given point and spaces the points evenly", () => {
    for (const clockwise of [true, false]) {
      const p = prepareCenterline(circle, { start: [0, 200], clockwise, spacing: 10 });
      expect(signedArea(p) < 0).toBe(clockwise);
      expect(p[0]![0]).toBeCloseTo(0, 0);
      expect(p[0]![1]).toBeCloseTo(200, 0);
      const d = Math.hypot(p[1]![0] - p[0]![0], p[1]![1] - p[0]![1]);
      expect(d).toBeCloseTo(10, 0);
    }
  });

  it("builds a loadable track file from points with or without widths", () => {
    const pts = prepareCenterline(circle, { start: [200, 0], clockwise: false });
    const f = importedTrackFile(meta, pts, { left: 5, right: 6 });
    expect(f.points[0]![0]).toBeCloseTo(200, 0);
    expect(f.points[0]!.slice(1)).toEqual([0, 6, 5]);
    const t = Track.fromFile(f);
    expect(t.length).toBeCloseTo(2 * Math.PI * 200, -1);
    const g = importedTrackFile(meta, [[1.234, 2.345, 3, 4]]);
    expect(g.points).toEqual([[1.23, 2.35, 3, 4]]);
    expect(() => importedTrackFile(meta, pts)).toThrow(/need a width/);
  });
});

describe("imported circuits (feature)", () => {
  const circuits = [
    { id: "monaco", official: 3337 },
    { id: "silverstone", official: 5891 },
    { id: "portimao", official: 4653 },
  ];
  for (const c of circuits) {
    it(`${c.id}: real length, licensed, and the DDK baseline laps it cleanly`, () => {
      const file = JSON.parse(readFileSync(`${root}tracks/${c.id}.json`, "utf8")) as TrackFile;
      expect(file.id).toBe(c.id);
      expect(file.license).toBeTruthy();
      expect(file.source).toBeTruthy();
      const track = Track.fromFile(file);
      expect(Math.abs(track.length - c.official) / c.official).toBeLessThan(0.015);
      const run = new CarSim(
        track,
        protoCar(),
        { id: "b", name: "b", runtime: baseline },
        { type: "practice", laps: 1, seed: 1 },
      ).run();
      expect(run.result.status).toBe("FINISHED");
      expect(run.result.offTracks).toBe(0);
      expect(run.result.bestLap).toBeGreaterThan(60);
    });
  }
});
