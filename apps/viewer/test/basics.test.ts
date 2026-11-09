import { describe, expect, it } from "vitest";
import { hexToRgb, linearRgb, srgbToLinear } from "../src/lib/color.js";
import { angleDelta, damp, dampAngle, dampFactor, lerp, toThree } from "../src/lib/coords.js";
import { stackLabels } from "../src/lib/labels.js";
import { parseParams, stepSpeed } from "../src/lib/params.js";
import { PlaybackClock } from "../src/lib/playback.js";

describe("coords", () => {
  it("maps sim x/y/z-up to three y-up", () => {
    expect(toThree(1, 2, 3)).toEqual([1, 3, -2]);
    expect(toThree(1, 2)).toEqual([1, 0, -2]);
  });
  it("interpolates and damps", () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(dampFactor(1, -1)).toBe(0);
    expect(damp(0, 10, 1e9, 1)).toBeCloseTo(10);
  });
  it("takes the short way round angles", () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
    expect(angleDelta(0, Math.PI)).toBeCloseTo(Math.PI);
    expect(dampAngle(3, -3, 1e9, 1)).toBeCloseTo(3 + 2 * Math.PI - 6);
  });
});

describe("color", () => {
  it("parses hex", () => {
    expect(hexToRgb("#ff0000")).toEqual([1, 0, 0]);
    expect(hexToRgb("#0f0")).toEqual([0, 1, 0]);
    expect(hexToRgb("nope")).toEqual([0.5, 0.5, 0.5]);
    expect(srgbToLinear(0.01)).toBeCloseTo(0.01 / 12.92);
    expect(linearRgb("#ffffff", 2)).toEqual([2, 2, 2]);
  });
});

describe("params", () => {
  it("parses viewer URL params", () => {
    const p = parseParams(
      "?replay=/r.json.gz&t=42.5&cam=map&car=a&speed=4&play=0&hud=0&trails=false&analysis=1&fps",
    );
    expect(p).toEqual({
      replay: "/r.json.gz",
      t: 42.5,
      cam: "map",
      car: "a",
      speed: 4,
      play: false,
      hud: false,
      trails: false,
      analysis: true,
      fps: true,
      zoom: null,
    });
    expect(parseParams("?zoom=1.5").zoom).toBe(1.5);
    expect(parseParams("?zoom=-2").zoom).toBeNull();
  });
  it("defaults and rejects bad values", () => {
    const p = parseParams("?t=abc&cam=drone&speed=-1&t2=");
    expect(p.t).toBeNull();
    expect(p.cam).toBeNull();
    expect(p.speed).toBeNull();
    expect(p.play).toBeNull();
    expect(p.hud).toBe(true);
    expect(p.trails).toBe(true);
    expect(parseParams("?t=").t).toBeNull();
  });
  it("steps through speeds", () => {
    expect(stepSpeed(1, 1)).toBe(2);
    expect(stepSpeed(16, 1)).toBe(32);
    expect(stepSpeed(32, 1)).toBe(32);
    expect(stepSpeed(2, -1)).toBe(1);
    expect(stepSpeed(1, -1)).toBe(0.5);
    expect(stepSpeed(0.25, -1)).toBe(0.25);
    expect(stepSpeed(3, 1)).toBe(4);
  });
});

describe("PlaybackClock", () => {
  it("advances with speed and stops at the end", () => {
    const c = new PlaybackClock(10, { speed: 2 });
    expect(c.advance(1)).toBeCloseTo(0.5);
    c.advance(0.1);
    expect(c.t).toBeCloseTo(0.7);
    c.speed = 100;
    for (let k = 0; k < 10; k++) c.advance(0.25);
    expect(c.t).toBe(10);
    expect(c.playing).toBe(false);
    expect(c.atEnd).toBe(true);
    c.toggle();
    expect(c.t).toBe(0);
    expect(c.playing).toBe(true);
  });
  it("seeks, clamps and pauses", () => {
    const c = new PlaybackClock(-5);
    expect(c.duration).toBe(0);
    const d = new PlaybackClock(10, { t: 20, playing: false });
    expect(d.t).toBe(10);
    expect(d.advance(1)).toBe(10);
    d.seek(Number.NaN);
    expect(d.t).toBe(0);
    d.seekBy(3);
    d.seekBy(-1);
    expect(d.t).toBe(2);
    d.toggle();
    expect(d.playing).toBe(true);
    d.toggle();
    expect(d.playing).toBe(false);
  });
});

describe("stackLabels", () => {
  it("leaves separate labels alone and stacks overlapping ones, nearest on the bottom", () => {
    const offs = stackLabels([
      { x: 100, y: 100, w: 80, h: 20, priority: -50 },
      { x: 110, y: 102, w: 80, h: 20, priority: -10 },
      { x: 400, y: 100, w: 80, h: 20, priority: -5 },
      { x: 105, y: 101, w: 80, h: 20, priority: -90 },
    ]);
    expect(offs[1]).toBe(0);
    expect(offs[2]).toBe(0);
    expect(offs[0]).toBeLessThan(-15);
    expect(offs[3]).toBeLessThan(offs[0]!);
  });
});
