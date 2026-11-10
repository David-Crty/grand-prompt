import { describe, expect, it } from "vitest";
import {
  entryVar,
  fitRange,
  gapLabel,
  lapOrDash,
  linear,
  lossTint,
  mergeMarkers,
  niceStep,
  niceTop,
  pathOf,
  shares,
  spreadLabels,
  statusCell,
  stepMarker,
  type TimelineMarker,
  type TimingRow,
  ticksIn,
  towerFinal,
  valueAt,
} from "../src/index.js";

const row = (o: Partial<TimingRow>): TimingRow => ({
  id: "a",
  position: 2,
  status: "RUNNING",
  finished: false,
  deleted: false,
  out: false,
  gap: 0.5204,
  interval: 0.25,
  ...o,
});

describe("timing labels", () => {
  it("prints the gap column like the tower and the phone strip", () => {
    expect(gapLabel(row({ position: 1 }))).toEqual({ text: "LEADER", kind: "lead" });
    expect(gapLabel(row({ position: 1 }), "interval").text).toBe("INTERVAL");
    expect(gapLabel(row({ position: 1 }), "gap", true).text).toBe("LEAD");
    expect(gapLabel(row({ position: 1, finished: true })).text).toBe("POLE");
    expect(gapLabel(row({ out: true }))).toEqual({ text: "OUT", kind: "out" });
    expect(gapLabel(row({ position: 1, finished: true, deleted: true }))).toEqual({
      text: "NO TIME",
      kind: "out",
    });
    expect(gapLabel(row({}))).toEqual({ text: "+0.520", kind: "gap" });
    expect(gapLabel(row({}), "interval").text).toBe("+0.250");
    expect(gapLabel(row({ interval: null }), "interval").text).toBe("+0.520");
    expect(gapLabel(row({}), "gap", true).text).toBe("+0.5");
    expect(gapLabel(row({ gap: null })).text).toBe("");
  });

  it("prints the status column and the tower head", () => {
    expect(statusCell(row({ status: "FINISHED" })).kind).toBe("fin");
    expect(statusCell(row({ status: "FINISHED", deleted: true }))).toEqual({ kind: "del", text: "DEL" });
    expect(statusCell(row({ status: "DNF: CRASHED (x)" })).kind).toBe("dnf");
    expect(statusCell(row({ status: "TIME UP" })).kind).toBe("time");
    expect(statusCell(row({}))).toEqual({ kind: "run", text: "" });
    expect(towerFinal([row({ position: 1 })])).toBe(false);
    expect(towerFinal([row({ position: 1, finished: true }), row({ out: true })])).toBe(true);
    expect(towerFinal([])).toBe(false);
    expect(lapOrDash(null, String)).toBe("–");
    expect(lapOrDash(-1, String)).toBe("–");
    expect(lapOrDash(Number.NaN, String)).toBe("–");
    expect(lapOrDash(4, (t) => `${t}s`)).toBe("4s");
  });

  it("refers to entry colours by token", () => {
    expect(entryVar({ slot: 4 })).toBe("var(--entry-04)");
    expect(entryVar({ slot: 12 })).toBe("var(--entry-12)");
    expect(entryVar({ slot: 0 })).toBe("var(--entry-none)");
    expect(entryVar(null)).toBe("var(--entry-none)");
  });
});

describe("timeline markers", () => {
  const m = (t: number, kind: TimelineMarker["kind"], id = "a"): TimelineMarker => ({
    t,
    kind,
    label: `${kind} ${id}`,
    carIds: [id],
  });
  const marks = [m(48, "dnf", "s"), m(0, "start"), m(47, "warn", "s"), m(200, "fastest"), m(69, "dnf", "l")];

  it("merges markers closer than the minimum spacing, keeping the strongest glyph", () => {
    const merged = mergeMarkers(marks, 600, 600, 12);
    expect(merged.map((x) => [x.t, x.kind])).toEqual([
      [0, "start"],
      [47, "dnf"],
      [69, "dnf"],
      [200, "fastest"],
    ]);
    expect(merged[1]!.label).toBe("warn s · dnf s");
    expect(merged[1]!.carIds).toEqual(["s"]);
    // Wide enough, nothing merges; the input is not modified.
    expect(mergeMarkers(marks, 600, 60000, 12)).toHaveLength(5);
    expect(marks[2]!.kind).toBe("warn");
    // A weaker glyph merging in keeps the stronger one.
    expect(mergeMarkers([m(10, "dnf"), m(11, "fastest")], 600, 600)[0]!.kind).toBe("dnf");
    expect(mergeMarkers(marks, 0, 600)).toHaveLength(5);
  });

  it("steps to the next and previous marker", () => {
    expect(stepMarker(marks, 47, 1)?.t).toBe(48);
    expect(stepMarker(marks, 47.2, 1)?.t).toBe(48);
    expect(stepMarker(marks, 48, -1)?.t).toBe(47);
    expect(stepMarker(marks, 0, -1)).toBeNull();
    expect(stepMarker(marks, 300, 1)).toBeNull();
  });
});

describe("chart helpers", () => {
  it("scales, draws paths, spreads labels and rounds axis tops", () => {
    const sx = linear(0, 10, 0, 100);
    expect(sx(5)).toBe(50);
    expect(linear(3, 3, 0, 10)(3)).toBe(0);
    expect(pathOf([0, 5, 10], [1, 2, 3], sx, (v) => v * 10)).toBe("M0.0 10.0 L50.0 20.0 L100.0 30.0");
    expect(pathOf([0, 5, 10], [1, 2, 3], sx, (v) => v, 4, 6)).toBe("M50.0 2.0");
    expect(spreadLabels([10, 12, 50, 11], 14)).toEqual([10, 38, 52, 24]);
    expect(niceTop(312, 50)).toBe(350);
    expect(niceTop(0, 50)).toBe(50);
  });
});

describe("zoomable chart helpers", () => {
  it("interpolates, steps and fits ranges", () => {
    expect(valueAt([0, 10, 20], [0, 1, 3], 15)).toBe(2);
    expect(valueAt([0, 10, 20], [0, 1, 3], -5)).toBe(0);
    expect(valueAt([0, 10, 20], [0, 1, 3], 25)).toBe(3);
    expect(valueAt([], [], 1)).toBe(0);
    expect(niceStep(1.2)).toBeCloseTo(0.5);
    expect(niceStep(0.3)).toBeCloseTo(0.1);
    expect(niceStep(6)).toBe(2);
    expect(niceStep(28)).toBe(10);
    expect(niceStep(0)).toBeGreaterThan(0);
    expect(ticksIn(-0.25, 1.1, 0.5)).toEqual([0, 0.5, 1]);
    expect(ticksIn(-1, 1, 1)).toEqual([-1, 0, 1]);
    expect(
      fitRange(
        [
          [0, 10, 20],
          [0, 10, 20],
        ],
        [
          [150, 90, 200],
          [160, 100, 400],
        ],
        5,
        20,
        20,
        10,
      ),
    ).toEqual([80, 420]);
    expect(fitRange([[0]], [[5]], 10, 20, 20)).toEqual([0, 20]);
    expect(fitRange([[15]], [[40]], 10, 20, 20)).toEqual([40, 60]);
  });

  it("sizes bars and tints by loss", () => {
    expect(shares([0.5, -1, 0.25])).toEqual([0.5, 1, 0.25]);
    expect(shares([0, 0])).toEqual([0, 0]);
    expect(lossTint(0, 1.2)).toBe(8);
    expect(lossTint(0.6, 1.2)).toBe(39);
    expect(lossTint(5, 1.2)).toBe(70);
    expect(lossTint(-1, 1.2)).toBe(8);
  });
});
