import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMinimap } from "../src/lib/minimap.js";
import { mapAngle, OFFICIAL_MAP_ANGLE, rotatedBounds } from "../src/lib/orientation.js";
import { trackOutline } from "../src/lib/outline.js";
import { buildLayout } from "../src/lib/track.js";
import { stadiumTrack } from "./fixtures.js";

const coords = (path: string) =>
  [...path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);

const repoTrack = (id: string) =>
  JSON.parse(readFileSync(new URL(`../../../tracks/${id}.json`, import.meta.url), "utf8")) as {
    points: number[][];
  };

describe("mapAngle", () => {
  it("draws a circuit with an official map at its angle", () => {
    const { points } = repoTrack("portimao");
    const xs = points.map((p) => p[0]!);
    const ys = points.map((p) => p[1]!);
    expect(mapAngle("portimao", xs, ys)).toBeCloseTo((OFFICIAL_MAP_ANGLE.portimao! * Math.PI) / 180);
    // Portimão's official map has the main straight along the bottom, driven right to left.
    const o = trackOutline(points, "portimao")!;
    const [p0, p1] = coords(o.path);
    expect(p1![0]).toBeLessThan(p0![0]);
    expect(p0![1]).toBeGreaterThan(o.height * 0.8);
  });

  it("turns any other circuit the same way whatever box it is drawn in, start line in the lower half", () => {
    const L = buildLayout(stadiumTrack());
    const a = mapAngle(undefined, L.cx, L.cy);
    for (const [w, h] of [
      [316, 150],
      [340, 240],
      [200, 400],
    ] as const) {
      expect(buildMinimap(L, undefined, w, h).angle).toBe(a);
    }
    const b = rotatedBounds(L.cx, L.cy, a);
    const v0 = L.cx[0]! * Math.sin(a) + L.cy[0]! * Math.cos(a);
    expect(v0 - b.minV).toBeLessThanOrEqual(b.spanV / 2);
    const upside = { ...L, cx: L.cx.map((x) => -x), cy: L.cy.map((y) => -y) };
    const m = buildMinimap(upside, undefined, 340, 190);
    expect(m.project(upside.cx[0]!, upside.cy[0]!)[1]).toBeGreaterThan(m.height / 2);
  });

  it("gives the race list and the minimap the same picture", () => {
    for (const id of Object.keys(OFFICIAL_MAP_ANGLE)) {
      const { points } = repoTrack(id);
      const xs = points.map((p) => p[0]!);
      const ys = points.map((p) => p[1]!);
      const b = rotatedBounds(xs, ys, mapAngle(id, xs, ys));
      const o = trackOutline(points, id)!;
      const pts = coords(o.path);
      const spanX = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
      const spanY = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
      expect(spanX / spanY).toBeCloseTo(b.spanU / b.spanV, 0);
    }
  });

  it("copes with no points", () => {
    expect(mapAngle(undefined, [], [])).toBe(0);
  });
});
