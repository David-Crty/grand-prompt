import { describe, expect, it } from "vitest";
import { detectCorners } from "../src/lib/corners.js";
import { indexReplay } from "../src/lib/frames.js";
import { dnfText, raceMessages, TOAST_KIND, toastLife, visibleToasts } from "../src/lib/messages.js";
import { buildModel } from "../src/lib/model.js";
import { makeCar, makeReplay, stadiumTrack } from "./fixtures.js";

const track = stadiumTrack();

describe("messages", () => {
  const car = makeCar(track, {
    id: "a",
    speed: 50,
    invalidLaps: [2],
    extraEvents: [
      { t: 4, type: "crash", value: 30 },
      { t: 4.2, type: "crash" },
      { t: 5, type: "impact", value: 5 },
      { t: 5.5, type: "impact" },
      { t: 6, type: "strike", detail: "TypeError" },
      { t: 6.5, type: "strike" },
      { t: 7, type: "offTrack", value: 2 },
      { t: 7.5, type: "status", detail: "RUNNING" },
      { t: 8, type: "sector", value: 1 },
    ],
  });
  const dnf = makeCar(track, { id: "b", speed: 49, dnfAt: 9 });
  const msgs = raceMessages(indexReplay(makeReplay([car, dnf], track)), detectCorners(track), {
    time: 0,
    speed: 50,
  });
  it("turns events into race-control messages", () => {
    const texts = msgs.map((m) => m.text);
    expect(texts).toContain("Flying lap · 2 cars · 180 km/h at the line");
    expect(texts).toContain("Crashed at 108 km/h · before Turn 1");
    expect(texts).toContain("Crashed at 0 km/h · before Turn 1");
    expect(texts).toContain("Barrier contact at 18 km/h");
    expect(texts).toContain("Barrier contact at 0 km/h");
    expect(texts).toContain("Driver code fault: TypeError");
    expect(texts).toContain("Driver code fault");
    expect(texts).toContain("Crashed: barrier · Turn 1");
    expect(texts).toContain("Lap deleted: track limits");
    expect(texts).toContain("Chequered flag · Car a on pole");
    expect(texts.some((x) => /^Pole · /.test(x))).toBe(true);
    const two = raceMessages(
      indexReplay(
        makeReplay([makeCar(track, { id: "a", speed: 50 }), makeCar(track, { id: "c", speed: 40 })], track),
      ),
    ).map((m) => m.text);
    expect(two[0]).toBe("Flying lap · 2 cars");
    expect(two.some((x) => /^P2 · .* · \+\d/.test(x))).toBe(true);
    expect(raceMessages([])).toEqual([]);
    const none = makeCar(track, { id: "n", speed: 50, invalidLaps: [1, 2] });
    expect(raceMessages(indexReplay(makeReplay([none], track))).at(-1)?.text).toBe(
      "Chequered flag · no valid lap",
    );
    expect(msgs.filter((m) => m.kind === "fastest")).toHaveLength(1);
    for (let k = 1; k < msgs.length; k++) expect(msgs[k]!.t).toBeGreaterThanOrEqual(msgs[k - 1]!.t);
  });
  it("shows toasts for their lifetime, retirements longest, folding warnings into them", () => {
    const at = (t: number, speed = 1) => visibleToasts(msgs, t, speed, 3).map((m) => m.kind);
    expect(at(0.5)).toEqual(["start"]);
    expect(at(6.2)).toEqual(["impact", "impact", "strike"]);
    // b retires at 9; its own warnings would fold, a's stay.
    expect(at(9.1)).toContain("dnf");
    expect(at(30)).toEqual(["crash", "crash", "dnf"]);
    expect(at(60)).toEqual(["chequered"]);
    expect(at(90)).toEqual([]);
    // At 8x every message lives four times longer; still three at most.
    expect(at(60, 8)).toHaveLength(3);
    const warnBeforeOut = [
      { t: 10, carId: "x", kind: "impact" as const, text: "w" },
      { t: 11, carId: "x", kind: "dnf" as const, text: "out" },
    ];
    expect(visibleToasts(warnBeforeOut, 11.5, 1).map((m) => m.kind)).toEqual(["dnf"]);
    expect(TOAST_KIND.fastest).toBe("fastest");
    expect(toastLife(warnBeforeOut[0]!)).toBe(8);
    expect(toastLife(warnBeforeOut[1]!)).toBe(30);
  });
  it("words retirements", () => {
    expect(dnfText("DNF: STALLED", "Turn 3")).toBe("Stalled · Turn 3");
    expect(dnfText("DNF: ECU FAILURE (TypeError: x)", "")).toBe("Ecu failure: TypeError: x");
    expect(dnfText("odd", "Turn 1")).toBe("odd · Turn 1");
  });
});

describe("buildModel", () => {
  it("derives everything the viewer needs", () => {
    const r = makeReplay(
      [makeCar(track, { id: "a", speed: 50 }), makeCar(track, { id: "b", speed: 48 })],
      track,
    );
    const m = buildModel(r, 100);
    expect(m.cars).toHaveLength(2);
    expect(m.duration).toBeCloseTo((2 * track.length) / 48, 0);
    expect(m.trees).toHaveLength(100);
    expect(m.messages.length).toBeGreaterThan(0);
    const unseeded = buildModel({ ...r, header: { ...r.header, seed: 0 } }, 10);
    expect(unseeded.trees).toHaveLength(10);
  });
});
