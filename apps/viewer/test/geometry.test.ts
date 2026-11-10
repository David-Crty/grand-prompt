import { describe, expect, it } from "vitest";
import {
  chasePose,
  clampZoom,
  fitFov,
  mapPose,
  onboardPose,
  stepZoom,
  TV_JOIN,
  TV_JOIN_HOLD,
  TV_LEAVE_HOLD,
  TV_MARGIN,
  TV_MAX_SPAN,
  TV_MIN_SPAN,
  TV_PAD,
  TV_STRETCH,
  TV_TILT,
  TV_ZOOM_MAX,
  TV_ZOOM_MIN,
  tvFrame,
  tvPose,
} from "../src/lib/camera.js";
import { indexCar } from "../src/lib/frames.js";
import { buildMinimap } from "../src/lib/minimap.js";
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
  it("places chase and onboard cameras relative to the car", () => {
    const ch = chasePose(car, 0);
    expect(ch.pos).toEqual([0.5, 3.2, -20]);
    expect(ch.look[0]).toBeGreaterThan(10);
    const ob = onboardPose(car);
    expect(ob.pos[0]).toBeLessThan(10);
    expect(ob.pos[1]).toBeGreaterThan(1);
  });
  it("fits the map", () => {
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
  it("widens the FOV on narrow screens", () => {
    expect(fitFov(30, 16 / 9)).toBe(30);
    expect(fitFov(30, 2.4)).toBe(30);
    const portrait = fitFov(30, 390 / 844);
    expect(portrait).toBeGreaterThan(60);
    expect(portrait).toBeLessThanOrEqual(80);
    expect(fitFov(70, 0.3)).toBe(80);
  });
  it("clamps and steps the TV zoom", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0)).toBe(TV_ZOOM_MIN);
    expect(clampZoom(99)).toBe(TV_ZOOM_MAX);
    expect(stepZoom(1, 1)).toBeCloseTo(1.15);
    expect(stepZoom(1, -1)).toBeCloseTo(1 / 1.15);
    expect(stepZoom(TV_ZOOM_MAX, 1)).toBe(TV_ZOOM_MAX);
  });
  it("frames the focus alone at the tightest zoom", () => {
    const f = tvFrame({ id: "a", x: 10, y: 20 }, [{ id: "z", x: 900, y: 20 }], 0, 16 / 9);
    expect(f).toEqual({ x: 10, y: 20, span: TV_MIN_SPAN, ids: ["a"], wait: {} });
  });
  it("zooms out for nearby cars, nearest first, up to the max span", () => {
    const focus = { id: "a", x: 0, y: 0 };
    const near = { id: "b", x: -40, y: 0 };
    const mid = { id: "c", x: -55, y: 0 };
    const far = { id: "d", x: -400, y: 0 };
    const f = tvFrame(focus, [far, mid, near, { id: "a", x: 0, y: 0 }], 0, 16 / 9);
    expect(f.ids).toEqual(["a", "b", "c"]);
    expect(f.span).toBeCloseTo((55 + 2 * TV_PAD) / (1 - 2 * TV_MARGIN));
    expect(f.x).toBeCloseTo(-27.5);
    expect(f.y).toBeCloseTo(0);
    const tight = tvFrame(focus, [near, mid], 0, 16 / 9, { maxSpan: 90 });
    expect(tight.ids).toEqual(["a", "b"]);
    expect(tight.span).toBeLessThanOrEqual(90);
  });
  it("measures the gap across the screen when the heading turns", () => {
    const side = { id: "b", x: 0, y: 20 };
    const along = tvFrame({ id: "a", x: 0, y: 0 }, [side], Math.PI / 2, 16 / 9);
    expect(along.span).toBeCloseTo((20 + 2 * TV_PAD) / (1 - 2 * TV_MARGIN));
    expect(along.x).toBeCloseTo(0);
    expect(along.y).toBeCloseTo(10);
    const across = tvFrame({ id: "a", x: 0, y: 0 }, [side], 0, 16 / 9);
    expect(across.span).toBeCloseTo(((20 + 2 * TV_PAD) * (16 / 9)) / (1 - 2 * TV_MARGIN));
  });
  it("keeps a framed car a little longer than a new one may join", () => {
    const gap = ((TV_MAX_SPAN * (TV_JOIN + 1)) / 2) * (1 - 2 * TV_MARGIN) - 2 * TV_PAD;
    const cars = [{ id: "b", x: gap, y: 0 }];
    expect(tvFrame({ id: "a", x: 0, y: 0 }, cars, 0, 16 / 9).ids).toEqual(["a"]);
    const kept = tvFrame({ id: "a", x: 0, y: 0 }, cars, 0, 16 / 9, { prev: ["a", "b"] });
    expect(kept.ids).toEqual(["a", "b"]);
    expect(kept.span).toBeLessThanOrEqual(TV_MAX_SPAN);
  });
  const gapAt = (share: number) => share * TV_MAX_SPAN * (1 - 2 * TV_MARGIN) - 2 * TV_PAD;
  const run = (xs: number[], dt: number, prev: string[]) => {
    let f = { ids: prev, wait: {} as Record<string, number> };
    const seen: string[][] = [];
    for (const x of xs) {
      f = tvFrame({ id: "a", x: 0, y: 0 }, [{ id: "b", x, y: 0 }], 0, 16 / 9, {
        prev: f.ids,
        wait: f.wait,
        dt,
      });
      seen.push(f.ids);
    }
    return { f, seen };
  };
  it("lets a car join only once it has fitted for the join hold", () => {
    const inside = gapAt(TV_JOIN * 0.9);
    const steps = Math.ceil(TV_JOIN_HOLD / 0.25);
    const { f, seen } = run(Array(steps).fill(inside), 0.25, ["a"]);
    expect(seen.slice(0, -1).every((ids) => ids.length === 1)).toBe(true);
    expect(f.ids).toEqual(["a", "b"]);
    expect(f.wait).toEqual({});
  });
  it("restarts the hold when a car drifts back across the limit", () => {
    const xs = [gapAt(0.5), gapAt(0.5), gapAt(0.95), gapAt(0.5), gapAt(0.95), gapAt(0.5)];
    const { seen } = run(xs, TV_JOIN_HOLD / 3, ["a"]);
    expect(seen.every((ids) => ids.length === 1)).toBe(true);
  });
  it("holds a framed car past the limit for the leave hold, then lets it go", () => {
    const out = gapAt(1.1);
    const steps = Math.ceil(TV_LEAVE_HOLD / 0.25);
    const { f, seen } = run(Array(steps).fill(out), 0.25, ["a", "b"]);
    expect(seen.slice(0, -1).every((ids) => ids.length === 2)).toBe(true);
    expect(seen[0]!.length).toBe(2);
    expect(f.ids).toEqual(["a"]);
  });
  it("drops a framed car at once past the stretch, and decides at once on a new focus", () => {
    expect(run([gapAt(TV_STRETCH * 1.05)], 0.01, ["a", "b"]).f.ids).toEqual(["a"]);
    expect(run([gapAt(0.5)], 0.01, ["z", "b"]).f.ids).toEqual(["a", "b"]);
    expect(run([gapAt(0.5)], 0.01, []).f.ids).toEqual(["a", "b"]);
  });
  it("looks straight down with the heading pointing right, clear of the HUD", () => {
    const top = (f: { x: number; y: number; span: number }, h: number, ins?: Parameters<typeof tvPose>[4]) =>
      tvPose(f, h, 1600, 900, ins, 24, 0);
    const p = top({ x: 100, y: 50, span: 60 }, 0);
    expect(p.pos[0]).toBeCloseTo(100);
    expect(p.pos[2]).toBeCloseTo(-50);
    expect(p.look).toEqual([p.pos[0], 0, p.pos[2]]);
    expect(p.up?.[0]).toBeCloseTo(0);
    expect(p.up?.[2]).toBeCloseTo(-1);
    const wide = top({ x: 100, y: 50, span: 120 }, 0);
    expect(wide.pos[1]).toBeCloseTo(p.pos[1] * 2);
    const hud = top({ x: 100, y: 50, span: 60 }, 0, {
      left: 400,
      right: 0,
      top: 100,
      bottom: 0,
    });
    expect(hud.pos[0]).toBeLessThan(100);
    expect(-hud.pos[2]).toBeGreaterThan(50);
    const north = top({ x: 0, y: 0, span: 60 }, Math.PI / 2, {
      left: 400,
      right: 0,
      top: 0,
      bottom: 0,
    });
    expect(north.pos[0]).toBeCloseTo(0);
    expect(-north.pos[2]).toBeLessThan(0);
    expect(north.up?.[0]).toBeCloseTo(-1);
  });
  it("leans off the vertical from the car's right, at the same distance", () => {
    const flat = tvPose({ x: 100, y: 50, span: 60 }, 0, 1600, 900, undefined, 24, 0);
    const lean = tvPose({ x: 100, y: 50, span: 60 }, 0, 1600, 900);
    expect(lean.look).toEqual(flat.look);
    const [bx, by, bz] = [lean.pos[0] - lean.look[0], lean.pos[1], lean.pos[2] - lean.look[2]];
    expect(Math.hypot(bx, by, bz)).toBeCloseTo(flat.pos[1]);
    expect(bx).toBeCloseTo(0);
    expect(bz).toBeGreaterThan(0);
    expect((Math.atan2(Math.hypot(bx, bz), by) * 180) / Math.PI).toBeCloseTo(TV_TILT);
  });
});

describe("minimap", () => {
  const layout = buildLayout(stadiumTrack());
  it("fits the circuit into the box, keeping its shape", () => {
    const m = buildMinimap(layout, 340, 190);
    expect(m.angle).toBeGreaterThanOrEqual(0);
    expect(m.angle).toBeLessThan(Math.PI);
    expect(m.width).toBe(340);
    expect(m.height).toBeLessThanOrEqual(190);
    expect(m.path.startsWith("M")).toBe(true);
    expect(m.path.endsWith("Z")).toBe(true);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < layout.n; i++) {
      const [px, py] = m.project(layout.cx[i]!, layout.cy[i]!);
      expect(py).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(py).toBeLessThanOrEqual(m.height - 10 + 1e-6);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
    }
    expect(minX).toBeGreaterThanOrEqual(10 - 1e-6);
    expect(maxX).toBeLessThanOrEqual(330 + 1e-6);
    const o = m.project(0, 0);
    const ex = m.project(100, 0);
    const ey = m.project(0, 100);
    const len = (p: [number, number]) => Math.hypot(p[0] - o[0], p[1] - o[1]);
    expect(len(ex)).toBeCloseTo(len(ey));
    // A rotation, not a mirror: sim x -> y is counter-clockwise, which is clockwise in y-down SVG.
    const cross = (ex[0] - o[0]) * (ey[1] - o[1]) - (ex[1] - o[1]) * (ey[0] - o[0]);
    expect(cross).toBeLessThan(0);
    const [sx, sy] = m.project(layout.cx[0]!, layout.cy[0]!);
    expect((m.start[0] + m.start[2]) / 2).toBeCloseTo(sx);
    expect((m.start[1] + m.start[3]) / 2).toBeCloseTo(sy);
    expect(Math.hypot(m.start[2] - m.start[0], m.start[3] - m.start[1])).toBeCloseTo(10);
  });
  it("lays a tall circuit on its side", () => {
    const tall = buildLayout(stadiumTrack());
    const swap = { ...tall, cx: tall.cy, cy: tall.cx, nx: tall.ny, ny: tall.nx };
    const m = buildMinimap(swap, 340, 190);
    const flat = buildMinimap(tall, 340, 190);
    expect(m.angle).toBeGreaterThan(0);
    expect(m.height).toBeCloseTo(flat.height, -1);
  });
  it("keeps every point when the track is short", () => {
    const m = buildMinimap(layout, 200, 200, 5, layout.n * 2);
    expect(m.path.split("L")).toHaveLength(layout.n);
  });
});
