import { describe, expect, it } from "vitest";
import {
  clamp,
  Hasher,
  hashString,
  loopDelta,
  Prng,
  stableStringify,
  wrapAngle,
  wrapS,
} from "../src/math.js";

describe("math", () => {
  it("clamps", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it("wraps angles to (-pi, pi]", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI);
    expect(wrapAngle(-1.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI);
  });

  it("wraps distances on a loop", () => {
    expect(wrapS(105, 100)).toBe(5);
    expect(wrapS(-5, 100)).toBe(95);
    expect(loopDelta(95, 5, 100)).toBe(10);
    expect(loopDelta(5, 95, 100)).toBe(-10);
    expect(loopDelta(10, 20, 100)).toBe(10);
    expect(loopDelta(0, 50, 100)).toBe(50);
  });

  it("seeded PRNG is deterministic and uniform", () => {
    const a = new Prng(42);
    const b = new Prng(42);
    const c = new Prng(43);
    const xs = Array.from({ length: 1000 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b.next()));
    expect(xs[0]).not.toBe(c.next());
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it("hashes are stable and sensitive", () => {
    const h = (x: number) => new Hasher().number(x).string("a").digest();
    expect(h(1)).toBe(h(1));
    expect(h(1)).not.toBe(h(1 + Number.EPSILON));
    expect(h(0)).not.toBe(h(-0));
    expect(hashString("abc")).toMatch(/^[0-9a-f]{16}$/);
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });

  it("stable stringify sorts keys and drops undefined", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify("x")).toBe('"x"');
  });
});
