import { describe, expect, it } from "vitest";
import { formatClock, formatGap, formatLapTime, kmh } from "../src/format.js";

describe("format", () => {
  it("formats lap times", () => {
    expect(formatLapTime(83.4567)).toBe("1:23.457");
    expect(formatLapTime(9.5)).toBe("9.500");
    expect(formatLapTime(65, 0)).toBe("1:05");
    expect(formatLapTime(null)).toBe("--");
    expect(formatLapTime(undefined)).toBe("--");
    expect(formatLapTime(-1)).toBe("--");
    expect(formatLapTime(Number.NaN)).toBe("--");
  });
  it("formats clock, gaps and speed", () => {
    expect(formatClock(83.9)).toBe("1:23");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(-5)).toBe("0:00");
    expect(formatGap(1.23456)).toBe("+1.235");
    expect(formatGap(null)).toBe("");
    expect(formatGap(Number.POSITIVE_INFINITY)).toBe("");
    expect(kmh(100)).toBe(360);
  });
});
