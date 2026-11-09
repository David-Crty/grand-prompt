import { describe, expect, it } from "vitest";
import { PeriodicSpline, Track, trackFileHash } from "../src/index.js";
import { circleFile, hairpinOvalFile, protoRing, protoRingFile } from "./helpers.js";

describe("PeriodicSpline", () => {
  it("interpolates the knots and has the right curvature on a circle", () => {
    const n = 36;
    const xs = Array.from({ length: n }, (_, i) => 50 * Math.cos((i / n) * 2 * Math.PI));
    const ys = Array.from({ length: n }, (_, i) => 50 * Math.sin((i / n) * 2 * Math.PI));
    const sp = new PeriodicSpline(xs, ys);
    for (let i = 0; i < n; i++) {
      const e = sp.eval(sp.t[i]!);
      expect(e.x).toBeCloseTo(xs[i]!, 6);
      expect(e.y).toBeCloseTo(ys[i]!, 6);
    }
    const e = sp.eval(sp.period * 0.37);
    const sp2 = e.dx * e.dx + e.dy * e.dy;
    const k = (e.dx * e.ddy - e.dy * e.ddx) / sp2 ** 1.5;
    expect(k).toBeCloseTo(1 / 50, 4);
    // wraps negative parameters
    expect(sp.eval(-1).x).toBeCloseTo(sp.eval(sp.period - 1).x, 9);
  });

  it("rejects degenerate input", () => {
    expect(() => new PeriodicSpline([0, 1, 2], [0, 1, 0])).toThrow(/at least 4/);
    expect(() => new PeriodicSpline([0, 0, 1, 1], [0, 0, 1, 0])).toThrow(/Duplicate/);
  });
});

describe("Track", () => {
  it("resamples a circle: length, curvature, heading", () => {
    const t = Track.fromFile(circleFile(100));
    expect(t.length).toBeCloseTo(2 * Math.PI * 100, 0);
    expect(t.spacing).toBeCloseTo(2, 1);
    for (let i = 0; i < t.count; i += 17) {
      expect(t.curvature[i]).toBeCloseTo(0.01, 4);
      const expected = Math.atan2(t.y[i]!, t.x[i]!) + Math.PI / 2;
      expect(Math.cos(t.heading[i]! - expected)).toBeCloseTo(1, 6);
    }
    expect(t.sectorOf(0)).toBe(1);
    expect(t.sectorOf(t.length * 0.5)).toBe(2);
    expect(t.sectorOf(t.length * 0.9)).toBe(3);
  });

  it("projects to Frenet and back (round trip)", () => {
    const t = protoRing();
    for (const s of [0, 1.3, 500, 1000.7, 2222.2, t.length - 0.5]) {
      for (const n of [-5, 0, 3.3]) {
        const w = t.toWorld(s, n);
        const p = t.project(w.x, w.y);
        expect(p.s).toBeCloseTo(s, 1);
        expect(p.n).toBeCloseTo(n, 1);
        const local = t.project(w.x, w.y, t.indexAt(s) + 3);
        expect(local.s).toBeCloseTo(s, 1);
      }
    }
  });

  it("local projection never snaps onto a nearby parallel section", () => {
    const t = Track.fromFile(hairpinOvalFile());
    // A point on the first straight, offset 15 m towards the parallel return straight (36 m away).
    const s0 = 200;
    const w = t.toWorld(s0, 15);
    const global = t.project(w.x, w.y);
    const local = t.project(w.x, w.y, t.indexAt(s0));
    expect(local.s).toBeCloseTo(s0, 0);
    expect(local.n).toBeCloseTo(15, 0);
    // a point even closer to the other straight: global search jumps, local search does not
    const w2 = t.toWorld(s0, 28);
    expect(Math.abs(t.project(w2.x, w2.y).s - s0)).toBeGreaterThan(100);
    expect(t.project(w2.x, w2.y, t.indexAt(s0)).s).toBeCloseTo(s0, 0);
    expect(global.s).toBeCloseTo(s0, 0);
  });

  it("local search follows a hint that is far behind", () => {
    const t = protoRing();
    const w = t.toWorld(300, 0);
    const p = t.project(w.x, w.y, t.indexAt(240));
    expect(p.s).toBeCloseTo(300, 0);
    const back = t.project(w.x, w.y, t.indexAt(360));
    expect(back.s).toBeCloseTo(300, 0);
  });

  it("classifies surfaces by lateral offset", () => {
    const t = protoRing();
    // find a sample with a left kerb (left-hand corner)
    const i = t.kerbLeft.indexOf(1);
    expect(i).toBeGreaterThanOrEqual(0);
    const wl = t.widthLeft[i]!;
    const wr = t.widthRight[i]!;
    expect(t.surfaceAt(i, 0, wl, wr)).toBe("track");
    expect(t.surfaceAt(i, wl + 0.5, wl, wr)).toBe("kerb");
    const runoff = t.runoffWidthLeft[i]!;
    const type = t.runoffTypeLeft[i] === 1 ? "gravel" : "grass";
    expect(t.surfaceAt(i, wl + Math.min(runoff - 0.1, 2), wl, wr)).toBe(type);
    expect(t.surfaceAt(i, wl + runoff + 0.1, wl, wr)).toBe("barrier");
    expect(t.barrierOffset(i, true)).toBeCloseTo(wl + runoff);
    // the main straight has no kerbs: just beyond the line is grass
    expect(t.surfaceAt(100, -(t.widthRight[100]! + 0.5), t.widthLeft[100]!, t.widthRight[100]!)).toBe(
      "grass",
    );
    expect(t.barrierOffset(100, false)).toBeCloseTo(t.widthRight[100]! + t.runoffWidthRight[100]!);
  });

  it("applies runoff zones, including ones that wrap past the line", () => {
    const t = Track.fromFile(hairpinOvalFile());
    expect(t.runoffTypeLeft[0]).toBe(1);
    expect(t.runoffTypeLeft[t.count - 1]).toBe(1);
    expect(t.runoffTypeRight[0]).toBe(0);
    expect(t.runoffTypeLeft[Math.floor(t.count / 2)]).toBe(0);
  });

  it("clips runoff where another section runs close by", () => {
    const t = Track.fromFile(hairpinOvalFile());
    // straights are 36 m apart centre to centre, widths 6 + 6: barrier halfway in the 24 m gap
    const i = t.indexAt(200);
    const inner = t.runoffWidthLeft[i]!;
    expect(inner).toBeLessThan(15);
    expect(inner).toBeGreaterThan(5);
    expect(t.runoffWidthRight[i]).toBe(15);
  });

  it("serializes and restores (TrackData), exposes TrackInfo", () => {
    const t = protoRing();
    const d = t.toData();
    const t2 = Track.fromData(d);
    expect(t2.length).toBe(t.length);
    expect(t2.count).toBe(t.count);
    expect(t2.project(t.x[50]!, t.y[50]!).s).toBeCloseTo(50 * t.spacing, 1);
    const info = t.toInfo();
    expect(info.samples).toHaveLength(t.count);
    expect(info.samples[10]!.s).toBeCloseTo(10 * t.spacing);
    expect(info.sectors).toEqual(t.sectors);
    expect(info.apiVersion).toMatch(/^\d+\.\d+$/);
  });

  it("supports reversing the driving direction", () => {
    const f = circleFile(80);
    f.points = f.points.map(([x, y]) => [x, y, 5, 7]);
    const fwd = Track.fromFile(f);
    const rev = Track.fromFile({ ...f, reverse: true });
    expect(fwd.curvature[5]).toBeGreaterThan(0);
    expect(rev.curvature[5]).toBeLessThan(0);
    expect(fwd.widthLeft[3]).toBeCloseTo(7);
    expect(rev.widthLeft[3]).toBeCloseTo(5);
  });

  it("the Prototype Ring has the required features", () => {
    const t = protoRing();
    expect(t.length).toBeGreaterThan(3800);
    expect(t.length).toBeLessThan(4300);
    let maxK = 0;
    let longestStraight = 0;
    let run = 0;
    for (let i = 0; i < t.count; i++) {
      const k = Math.abs(t.curvature[i]!);
      maxK = Math.max(maxK, k);
      run = k < 1e-3 ? run + t.spacing : 0;
      longestStraight = Math.max(longestStraight, run);
    }
    expect(1 / maxK).toBeLessThan(20); // heavy-braking hairpin
    expect(longestStraight).toBeGreaterThan(850); // ~1 km straight
    const widths = Array.from(t.widthLeft, (w, i) => w + t.widthRight[i]!);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(12);
    expect(Math.max(...widths)).toBeLessThanOrEqual(15.01);
    expect(trackFileHash(protoRingFile())).toBe(t.hash);
  });
});
