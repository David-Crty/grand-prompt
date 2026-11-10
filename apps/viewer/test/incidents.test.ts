import type { ReplayCar, SimEvent } from "@bench/sim";
import { describe, expect, it } from "vitest";
import { detectCorners } from "../src/lib/corners.js";
import { indexCar } from "../src/lib/frames.js";
import {
  analyseIncident,
  analyseIncidents,
  impactText,
  incidentTitle,
  REPLAY_LEAD,
  replayCountdown,
} from "../src/lib/incidents.js";
import { makeCar, stadiumTrack } from "./fixtures.js";

const track = stadiumTrack();
const corners = detectCorners(track);
const RATE = 10;

/** A car at 20 m/s from the line that goes out at `at` with this status, after `events`. */
function outCar(id: string, at: number, status: string, events: SimEvent[] = []): ReplayCar {
  const c = makeCar(track, { id, speed: 20, laps: 1, dnfAt: at, frameRate: RATE });
  return { ...c, events: [...events, { t: at, type: "status", detail: status }] };
}
const index = (c: ReplayCar) => indexCar(c, 0, RATE, track.length);

describe("incidents", () => {
  it("a crash: where, impact from the sim's status, and a replay from ten seconds before", () => {
    const car = outCar("son", 20, "DNF: CRASHED (hit the barrier at 36 km/h)", [
      { t: 20, type: "crash", value: 10 },
    ]);
    const inc = analyseIncident(index(car), corners)!;
    expect(inc.kind).toBe("crashed");
    expect(inc.t).toBe(20);
    expect(inc.where).toBe("Turn 1");
    expect(inc.corner).toBe(1);
    expect(inc.impactKmh).toBe(36);
    expect(inc.replayFrom).toBe(20 - REPLAY_LEAD);
    expect(inc.x).toBe(car.frames.x.at(-1));
    expect(inc.y).toBe(car.frames.y.at(-1));
    expect(inc.error).toBeUndefined();
    expect(incidentTitle(inc)).toBe("DNF · Crashed");
    expect(impactText(inc)).toBe("36 km/h");
  });

  it("falls back to the crash event's speed, and starts the replay at zero for an early exit", () => {
    const inc = analyseIncident(
      index(outCar("wall", 3, "DNF: CRASHED", [{ t: 3, type: "crash", value: 30 }])),
      corners,
    )!;
    expect(inc.impactKmh).toBe(108);
    expect(inc.replayFrom).toBe(0);
    expect(inc.where).toBe("before Turn 1");
  });

  it("a driver program failure, a stall and time running out have no impact", () => {
    const ecu = analyseIncident(
      index(outCar("ecu", 3, "DNF: ECU FAILURE (TypeError: x is undefined)")),
      corners,
    )!;
    expect(ecu.kind).toBe("ecu-failure");
    expect(ecu.error).toBe("TypeError: x is undefined");
    expect(ecu.impactKmh).toBeNull();
    expect(impactText(ecu)).toBe("–");
    expect(incidentTitle(ecu)).toBe("DNF · Driver program failure");
    const bare = outCar("ecu2", 3, "DNF: ECU FAILURE");
    bare.result.errors = ["t=3.00: step threw: boom"];
    expect(analyseIncident(index(bare), corners)!.error).toBe("t=3.00: step threw: boom");
    const stall = analyseIncident(index(outCar("st", 4, "DNF: STALLED")), corners)!;
    expect(stall.kind).toBe("stalled");
    expect(incidentTitle(stall)).toBe("DNF · Stalled");
    const slow = analyseIncident(index(outCar("slow", 5, "TIME UP")), corners)!;
    expect(slow.kind).toBe("time-up");
    expect(incidentTitle(slow)).toBe("Time up");
    expect(analyseIncident(index(outCar("st", 4, "DNF: STALLED")), [])!.where).toBe("On the lap");
  });

  it("only cars that went out, in time order", () => {
    const fin = makeCar(track, { id: "fin", speed: 50, frameRate: RATE });
    expect(analyseIncident(index(fin), corners)).toBeNull();
    const all = analyseIncidents(
      [index(outCar("late", 9, "DNF: STALLED")), index(fin), index(outCar("early", 2, "TIME UP"))],
      corners,
    );
    expect(all.map((x) => x.carId)).toEqual(["early", "late"]);
  });
});

describe("incident replay countdown", () => {
  it("counts down to the moment the car went out, then up from it", () => {
    expect(replayCountdown({ t: 44 }, 40.8)).toEqual({ k: "Out in", v: "3.2 s" });
    expect(replayCountdown({ t: 44 }, 51.1)).toEqual({ k: "Out", v: "7.1 s ago" });
  });
});
