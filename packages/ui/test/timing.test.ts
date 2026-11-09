import { describe, expect, it } from "vitest";
import {
  entryVar,
  gapLabel,
  lapCell,
  lapOrDash,
  mergeMarkers,
  PROVIDER_LABEL,
  stepMarker,
  type TimelineMarker,
  type TimingRow,
  towerLap,
} from "../src/index.js";

const row = (o: Partial<TimingRow>): TimingRow => ({
  id: "a",
  position: 2,
  lap: 1,
  status: "RUNNING",
  finished: false,
  out: false,
  gap: 0.5204,
  interval: 0.25,
  lapsDown: 0,
  ...o,
});

describe("timing labels", () => {
  it("prints the gap column like the tower and the phone strip", () => {
    expect(gapLabel(row({ position: 1 }))).toEqual({ text: "LEADER", kind: "lead" });
    expect(gapLabel(row({ position: 1 }), "interval").text).toBe("INTERVAL");
    expect(gapLabel(row({ position: 1 }), "gap", true).text).toBe("LEAD");
    expect(gapLabel(row({ position: 1, finished: true })).text).toBe("WINNER");
    expect(gapLabel(row({ out: true }))).toEqual({ text: "OUT", kind: "out" });
    expect(gapLabel(row({ lapsDown: 1 })).text).toBe("+1 LAP");
    expect(gapLabel(row({ lapsDown: 2 }), "gap", true).text).toBe("+2L");
    expect(gapLabel(row({}))).toEqual({ text: "+0.520", kind: "gap" });
    expect(gapLabel(row({}), "interval").text).toBe("+0.250");
    expect(gapLabel(row({ interval: null }), "interval").text).toBe("+0.520");
    expect(gapLabel(row({}), "gap", true).text).toBe("+0.5");
    expect(gapLabel(row({ gap: null })).text).toBe("");
  });

  it("prints the lap column and the tower head", () => {
    expect(lapCell(row({ status: "FINISHED" })).kind).toBe("fin");
    expect(lapCell(row({ status: "DNF: CRASHED (x)" })).kind).toBe("dnf");
    expect(lapCell(row({ status: "TIME UP" })).kind).toBe("time");
    expect(lapCell(row({ lap: 3 }))).toEqual({ kind: "lap", text: "L3" });
    expect(towerLap([row({ position: 1, lap: 2 })], 5)).toEqual({ final: false, lap: 2 });
    expect(towerLap([row({ position: 1, finished: true }), row({ out: true })], 5)).toEqual({
      final: true,
      lap: 5,
    });
    expect(towerLap([], 5)).toEqual({ final: false, lap: 1 });
    expect(lapOrDash(null, String)).toBe("–");
    expect(lapOrDash(-1, String)).toBe("–");
    expect(lapOrDash(Number.NaN, String)).toBe("–");
    expect(lapOrDash(4, (t) => `${t}s`)).toBe("4s");
  });

  it("refers to entry colours by token", () => {
    expect(entryVar({ slot: 4 })).toBe("var(--entry-04)");
    expect(entryVar({ slot: 12 })).toBe("var(--entry-12)");
    expect(entryVar({ slot: 0 })).toBe("var(--entry-house)");
    expect(entryVar(null)).toBe("var(--entry-house)");
    expect(PROVIDER_LABEL.openai).toBe("OpenAI");
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
