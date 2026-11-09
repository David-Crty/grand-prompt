import { describe, expect, it } from "vitest";
import {
  blendWeight,
  cameraAhead,
  cameraPassed,
  chasePose,
  fitFov,
  heliPose,
  mapPose,
  onboardPose,
  tracksidePose,
} from "../src/lib/camera.js";
import { indexCar } from "../src/lib/frames.js";
import { loft, openWheelerSections } from "../src/lib/loft.js";
import {
  BARRIER_HEIGHT,
  buildBarriers,
  buildGantry,
  buildGrandstands,
  buildLayout,
  buildLines,
  buildSurface,
  clearance,
  findStraights,
  KERB_WIDTH,
  MeshBuilder,
  placeGrandstands,
  placeTrackside,
  placeTrees,
  pointAt,
  TrackProximity,
  trackBounds,
} from "../src/lib/track.js";
import { ribbonIndices, trailRibbon } from "../src/lib/trail.js";
import { makeCar, stadiumTrack } from "./fixtures.js";

const track = stadiumTrack();
const layout = buildLayout(track);

describe("track layout", () => {
  it("keeps barriers inside the turn radius and clear of the opposite straight", () => {
    const n = layout.n;
    for (let i = 0; i < n; i++) {
      const minL = layout.wl[i]! + (layout.kerbL[i] ? KERB_WIDTH : 0) + 0.8 - 1e-9;
      expect(layout.barrierL[i]!).toBeGreaterThanOrEqual(minL);
      expect(layout.barrierL[i]!).toBeLessThanOrEqual(6 + 15 + 1e-9);
      expect(layout.barrierR[i]!).toBeLessThanOrEqual(6 + 25 + 1e-9);
    }
    const mid = Math.round(150 / track.spacing);
    expect(layout.barrierL[mid]!).toBeCloseTo(21, 0);
    const lim = clearance(track, 1);
    const apex = Math.round((300 + (Math.PI * 60) / 2) / track.spacing);
    expect(lim[apex]!).toBeLessThanOrEqual(0.9 * 60);
  });

  it("clamps to half the distance to a nearby parallel straight", () => {
    const tight = stadiumTrack(300, 20, 2);
    const lim = clearance(tight, 1);
    const mid = Math.round(150 / tight.spacing);
    expect(lim[mid]!).toBeCloseTo(19.5, 0);
    const lay = buildLayout(tight);
    expect(lay.barrierL[mid]!).toBeLessThan(20);
  });

  it("interpolates centerline frames, wrapping s", () => {
    const p = pointAt(layout, 10.5);
    expect(p.x).toBeCloseTo(10.5, 3);
    expect(p.y).toBeCloseTo(0);
    expect(pointAt(layout, track.length + 10.5).x).toBeCloseTo(10.5, 3);
    const q = pointAt(layout, -1);
    expect(q.heading).toBeGreaterThan(Math.PI);
    expect(Math.hypot(q.nx, q.ny)).toBeCloseTo(1);
  });

  it("generates surface, barrier and line meshes with consistent buffers", () => {
    const s = buildSurface(layout);
    const a = s.toArrays();
    expect(a.positions.length).toBe(a.normals.length);
    expect(a.colors.length).toBe(a.positions.length);
    expect(s.vertexCount % 6).toBe(0);
    const kerbs = layout.kerbL.reduce((x, y) => x + y, 0) + layout.kerbR.reduce((x, y) => x + y, 0);
    expect(s.vertexCount).toBe(6 * (layout.n * 5 + kerbs));
    for (let k = 1; k < a.positions.length; k += 3) {
      expect(a.positions[k]!).toBeGreaterThanOrEqual(0);
      expect(a.positions[k]!).toBeLessThan(0.1);
    }
    const b = buildBarriers(layout);
    expect(b.vertexCount).toBe(layout.n * 2 * 2 * 6);
    expect(Math.max(...b.positions.filter((_, k) => k % 3 === 1))).toBeCloseTo(BARRIER_HEIGHT);
    const lines = buildLines(layout, track.sectors);
    expect(lines.vertexCount).toBe((3 * 16 + 2) * 6);
  });

  it("builds outward-facing boxes", () => {
    const m = new MeshBuilder();
    m.box(10, 5, 0, Math.PI / 2, 4, 2, 3, [1, 0, 0], [0, 1, 0]);
    expect(m.vertexCount).toBe(36);
    const pos = m.positions;
    const nrm = m.normals;
    const cx = 10;
    const cy = 1.5;
    const cz = -5;
    for (let f = 0; f < 6; f++) {
      const o = f * 18;
      const px = (pos[o]! + pos[o + 3]! + pos[o + 6]!) / 3 - cx;
      const py = (pos[o + 1]! + pos[o + 4]! + pos[o + 7]!) / 3 - cy;
      const pz = (pos[o + 2]! + pos[o + 5]! + pos[o + 8]!) / 3 - cz;
      const dot = px * nrm[o]! + py * nrm[o + 1]! + pz * nrm[o + 2]!;
      expect(dot).toBeGreaterThan(0);
      const [ax, ay, az] = [pos[o]!, pos[o + 1]!, pos[o + 2]!];
      const ux = pos[o + 3]! - ax;
      const uy = pos[o + 4]! - ay;
      const uz = pos[o + 5]! - az;
      const vx = pos[o + 6]! - ax;
      const vy = pos[o + 7]! - ay;
      const vz = pos[o + 8]! - az;
      const cross = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      expect(cross[0]! * nrm[o]! + cross[1]! * nrm[o + 1]! + cross[2]! * nrm[o + 2]!).toBeGreaterThan(0);
    }
    expect(m.colors.slice(0, 3)).toEqual([0, 1, 0]);
  });

  it("finds straights and places grandstands, trees and cameras off the circuit", () => {
    const st = findStraights(track);
    expect(st).toHaveLength(2);
    expect(st[0]!.length).toBeGreaterThan(250);
    const allStraight = { ...track, curvature: track.curvature.map(() => 0) };
    expect(findStraights(allStraight)).toEqual([{ mid: 0, length: track.length }]);
    const prox = new TrackProximity(layout);
    expect(prox.clearanceAt(150, 0)).toBeLessThan(0);
    expect(prox.clearanceAt(150, -500)).toBe(Number.POSITIVE_INFINITY);
    const stands = placeGrandstands(layout, track);
    expect(stands.length).toBeGreaterThanOrEqual(1);
    for (const g of stands) expect(prox.clearanceAt(g.x, g.y)).toBeGreaterThan(2);
    const trees = placeTrees(layout, 300, 1, stands);
    expect(trees).toHaveLength(300);
    for (const t of trees) {
      expect(prox.clearanceAt(t.x, t.y)).toBeGreaterThanOrEqual(7);
      for (const g of stands)
        expect(Math.hypot(g.x - t.x, g.y - t.y)).toBeGreaterThanOrEqual(g.length / 2 + 12);
    }
    const cams = placeTrackside(layout, 200);
    expect(cams).toHaveLength(Math.floor(track.length / 200));
    for (const c of cams) expect(prox.clearanceAt(c.x, c.y)).toBeGreaterThan(-6);
    expect(placeTrackside(layout, 1e6)).toHaveLength(1);
    const b = trackBounds(layout);
    expect(b.minX).toBeLessThan(-60);
    expect(b.maxY).toBeGreaterThan(120);
  });

  it("builds grandstand and gantry meshes", () => {
    const stands = placeGrandstands(layout, track);
    expect(buildGrandstands(stands).vertexCount).toBeGreaterThan(36 * 8 * stands.length);
    expect(buildGrandstands([]).vertexCount).toBe(0);
    expect(buildGantry(layout).vertexCount).toBe(36 * 9);
  });
});

describe("loft", () => {
  const signedVolume = (m: { positions: number[]; indices: number[] }) => {
    let v = 0;
    for (let k = 0; k < m.indices.length; k += 3) {
      const [a, b, c] = [m.indices[k]!, m.indices[k + 1]!, m.indices[k + 2]!].map((i) => [
        m.positions[i * 3]!,
        m.positions[i * 3 + 1]!,
        m.positions[i * 3 + 2]!,
      ]) as [number[], number[], number[]];
      v +=
        (a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) -
          a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) +
          a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)) /
        6;
    }
    return v;
  };
  it("produces closed, outward-wound bodies in either direction", () => {
    const fwd = loft([
      { x: 0, halfWidth: 1, bottom: 0, top: 1 },
      { x: 2, halfWidth: 1, bottom: 0, top: 1 },
    ]);
    expect(signedVolume(fwd)).toBeCloseTo(4);
    const back = loft([
      { x: 2, halfWidth: 1, bottom: 0, top: 1, topScale: 1 },
      { x: 0, halfWidth: 1, bottom: 0, top: 1 },
    ]);
    expect(signedVolume(back)).toBeCloseTo(4);
    expect(() => loft([{ x: 0, halfWidth: 1, bottom: 0, top: 1 }])).toThrow();
  });
  it("describes an open-wheeler within the car's footprint", () => {
    const s = openWheelerSections(5.6, 2);
    for (const part of [s.tub, s.sidepods, s.engine]) {
      for (const sec of part) {
        expect(Math.abs(sec.x)).toBeLessThanOrEqual(2.8);
        expect(sec.halfWidth).toBeLessThanOrEqual(1);
      }
      expect(signedVolume(loft(part))).toBeGreaterThan(0);
    }
  });
});

describe("trail", () => {
  const c = indexCar(makeCar(track, { id: "a", speed: 50 }), 0, 10, track.length);
  it("builds a ribbon along the recent path fading at both ends", () => {
    const pts = 20;
    const out = new Float32Array(pts * 6);
    const alpha = new Float32Array(pts * 2);
    expect(trailRibbon(c, 3, 2, pts, 0.5, 0.1, out, alpha)).toBe(pts);
    expect(out[0]).toBeCloseTo(50, 0);
    expect(out[1]).toBeCloseTo(0.1);
    expect(out[2]).toBeCloseTo(-0.5, 1);
    expect(out[5]).toBeCloseTo(0.5, 1);
    expect(out[(pts - 1) * 6]).toBeCloseTo(150, 0);
    expect(alpha[0]).toBe(0);
    expect(alpha[(pts - 1) * 2]).toBeCloseTo(0.05);
    expect(Math.max(...alpha)).toBeGreaterThan(0.5);
    expect(trailRibbon(c, 0, 2, pts, 0.5, 0.1, out, alpha)).toBe(0);
    expect(trailRibbon(c, 1, 2, 1, 0.5, 0.1, out, alpha)).toBe(1);
  });
  it("indexes ribbon quads", () => {
    expect(Array.from(ribbonIndices(3))).toEqual([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
    expect(ribbonIndices(0)).toHaveLength(0);
  });
});

describe("camera", () => {
  const car = { x: 10, y: 20, yaw: 0 };
  it("places chase, onboard and heli cameras relative to the car", () => {
    const ch = chasePose(car, 0);
    expect(ch.pos).toEqual([0.5, 3.2, -20]);
    expect(ch.look[0]).toBeGreaterThan(10);
    const ob = onboardPose(car);
    expect(ob.pos[0]).toBeLessThan(10);
    expect(ob.pos[1]).toBeGreaterThan(1);
    const h0 = heliPose(10, 20, 0, 0);
    const h1 = heliPose(10, 20, 0, 50);
    expect(h1.pos[1]).toBeGreaterThan(h0.pos[1]);
    expect(h0.look).toEqual([10, 0.5, -20]);
  });
  it("zooms trackside and fits the map", () => {
    const near = tracksidePose({ x: 0, y: 0, h: 5 }, { x: 10, y: 0 });
    const far = tracksidePose({ x: 0, y: 0, h: 5 }, { x: 400, y: 0 });
    expect(near.fov).toBeGreaterThan(far.fov);
    expect(far.fov).toBeGreaterThanOrEqual(5);
    expect(tracksidePose({ x: 0, y: 0, h: 5 }, { x: 0.1, y: 0 }).fov).toBe(50);
    const b = { minX: 0, maxX: 1000, minY: 0, maxY: 500 };
    const m = mapPose(b, 1600, 900);
    expect(m.pos[0]).toBeCloseTo(500);
    expect(m.pos[2]).toBeCloseTo(-250);
    const shifted = mapPose(b, 1600, 900, { left: 400, right: 0, top: 0, bottom: 0 });
    expect(shifted.pos[0]).toBeLessThan(500);
    expect(shifted.pos[1]).toBeGreaterThan(m.pos[1]);
    const down = mapPose(b, 1600, 900, { left: 0, right: 0, top: 200, bottom: 0 });
    expect(down.pos[2]).toBeLessThan(-250);
  });
  it("eases blends and widens the FOV on narrow screens", () => {
    expect(blendWeight(-1, 2)).toBe(0);
    expect(blendWeight(1, 2)).toBe(0.5);
    expect(blendWeight(5, 2)).toBe(1);
    expect(blendWeight(0, 0)).toBe(1);
    expect(fitFov(30, 16 / 9)).toBe(30);
    expect(fitFov(30, 2.4)).toBe(30);
    const portrait = fitFov(30, 390 / 844);
    expect(portrait).toBeGreaterThan(60);
    expect(portrait).toBeLessThanOrEqual(80);
    expect(fitFov(70, 0.3)).toBe(80);
  });
  it("finds the next camera ahead and detects passing", () => {
    const cams = [{ s: 100 }, { s: 300 }, { s: 900 }];
    expect(cameraAhead(cams, 0, 1000)).toBe(0);
    expect(cameraAhead(cams, 80, 1000)).toBe(1);
    expect(cameraAhead(cams, 800, 1000)).toBe(2);
    expect(cameraAhead(cams, 950, 1000)).toBe(0);
    expect(cameraAhead(cams, 500, 1000)).toBeNull();
    expect(cameraPassed(100, 140, 1000)).toBe(true);
    expect(cameraPassed(100, 110, 1000)).toBe(false);
    expect(cameraPassed(990, 30, 1000)).toBe(true);
    expect(cameraPassed(10, 900, 1000)).toBe(false);
  });
});
