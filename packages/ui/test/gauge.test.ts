import { describe, expect, it } from "vitest";
import {
  arcPath,
  clamp01,
  fillTo,
  GAUGE_MAX_KMH,
  polar,
  sectorPath,
  WHEEL_LOCK_DEG,
  wheelAngle,
} from "../src/gauge.js";

describe("gauge", () => {
  it("measures angles clockwise from twelve o'clock", () => {
    const top = polar(100, 100, 50, 0);
    expect(top[0]).toBeCloseTo(100);
    expect(top[1]).toBeCloseTo(50);
    const right = polar(100, 100, 50, 90);
    expect(right[0]).toBeCloseTo(150);
    expect(right[1]).toBeCloseTo(100);
    const left = polar(100, 100, 50, 270);
    expect(left[0]).toBeCloseTo(50);
  });

  it("draws arcs with the large-arc flag past half a turn", () => {
    expect(arcPath(100, 100, 50, 270, 450)).toBe("M50.00 100.00 A50 50 0 0 1 150.00 100.00");
    expect(arcPath(100, 100, 50, 225, 495)).toMatch(/ A50 50 0 1 1 /);
  });

  it("fills a fraction of the arc, clamped", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(fillTo(225, 495, 0.5)).toBe(360);
    expect(fillTo(225, 495, 2)).toBe(495);
    expect(fillTo(225, 495, 175 / GAUGE_MAX_KMH)).toBe(360);
  });

  it("closes a band between two radii, and draws nothing when empty", () => {
    expect(sectorPath(100, 100, 40, 50, 270, 450)).toBe(
      "M50.00 100.00 A50 50 0 0 1 150.00 100.00 L140.00 100.00 A40 40 0 0 0 60.00 100.00 Z",
    );
    expect(sectorPath(100, 100, 40, 50, 0, 270)).toMatch(/ A50 50 0 1 1 .* A40 40 0 1 0 /);
    expect(sectorPath(100, 100, 40, 50, 90, 90)).toBe("");
  });

  it("turns the wheel left for positive steer, up to full lock", () => {
    expect(wheelAngle(0)).toBe(0);
    expect(wheelAngle(0.5)).toBe(-WHEEL_LOCK_DEG / 2);
    expect(wheelAngle(-3)).toBe(WHEEL_LOCK_DEG);
    expect(wheelAngle(Number.NaN)).toBe(0);
  });
});
