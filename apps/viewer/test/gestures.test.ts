import { describe, expect, it } from "vitest";
import { cycleSpeed, pinchFactor, swipeDir } from "../src/lib/gestures.js";
import { SPEEDS } from "../src/lib/params.js";

describe("gestures", () => {
  it("reads a sideways flick as next or previous car", () => {
    expect(swipeDir(-120, 10, 200)).toBe(1);
    expect(swipeDir(90, -20, 300)).toBe(-1);
    expect(swipeDir(40, 0, 100)).toBeNull();
    expect(swipeDir(100, 90, 100)).toBeNull();
    expect(swipeDir(200, 0, 900)).toBeNull();
  });
  it("turns two fingers into a zoom factor and cycles speeds", () => {
    expect(pinchFactor(100, 150)).toBe(1.5);
    expect(pinchFactor(0, 150)).toBe(1);
    expect(cycleSpeed(SPEEDS, 1)).toBe(2);
    expect(cycleSpeed(SPEEDS, 32)).toBe(0.25);
    expect(cycleSpeed(SPEEDS, 0.25)).toBe(0.5);
  });
});
