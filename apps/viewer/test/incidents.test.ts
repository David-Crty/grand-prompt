import type { ReplayCar, SimEvent } from "@bench/sim";
import { describe, expect, it } from "vitest";
import { detectCorners } from "../src/lib/corners.js";
import { indexCar } from "../src/lib/frames.js";
import { analyseIncident, analyseIncidents, incidentTitle } from "../src/lib/incidents.js";
import { makeCar, stadiumTrack } from "./fixtures.js";

const track = stadiumTrack();
const corners = detectCorners(track);
const RATE = 20;

interface State {
  /** Direction of travel and the way the car points (rad, 0 is along the first straight). */
  dir: number;
  yaw: number;
  speed: number;
  throttle?: number;
  brake?: number;
  surface?: number;
}

/** A car on the first straight driven by `state(t)` up to `end`, then the given events. */
function synth(id: string, end: number, state: (t: number) => State, events: SimEvent[]): ReplayCar {
  const base = makeCar(track, { id, speed: 50 });
  const f = {
    x: [],
    y: [],
    yaw: [],
    speed: [],
    steer: [],
    throttle: [],
    brake: [],
    surface: [],
    lap: [],
    s: [],
  } as {
    [K in keyof ReplayCar["frames"]]: number[];
  };
  let x = 0;
  for (let k = 0; k <= Math.round(end * RATE); k++) {
    const st = state(k / RATE);
    if (k > 0) x += (st.speed * Math.cos(st.dir)) / RATE;
    f.x.push(x);
    f.y.push(0);
    f.yaw.push(st.yaw);
    f.speed.push(st.speed);
    f.steer.push(0);
    f.throttle.push(st.throttle ?? 0.3);
    f.brake.push(st.brake ?? 0);
    f.surface.push(st.surface ?? 0);
    f.lap.push(1);
    f.s.push(x);
  }
  return { ...base, frames: f, events };
}

const ramp = (t: number, t0: number, t1: number, a: number, b: number) =>
  t <= t0 ? a : t >= t1 ? b : a + ((b - a) * (t - t0)) / (t1 - t0);
const index = (c: ReplayCar) => indexCar(c, 0, RATE, track.length);
const out = (t: number, detail: string): SimEvent => ({ t, type: "status", detail });

describe("incidents", () => {
  it("power oversteer, at rest facing the wrong way, wrong-way driving, then the barrier", () => {
    const car = synth(
      "son",
      9.5,
      (t) => {
        if (t < 4) return { dir: 0, yaw: 0, speed: 50, throttle: t > 3.4 ? 1 : 0.4 };
        if (t < 6)
          return { dir: 0, yaw: ramp(t, 4, 5, 0, Math.PI), speed: ramp(t, 4, 6, 50, 0), throttle: 0.6 };
        if (t < 6.5) return { dir: Math.PI, yaw: Math.PI, speed: 0 };
        return { dir: Math.PI, yaw: Math.PI, speed: 10 };
      },
      [{ t: 9.5, type: "crash", value: 10 }, out(9.5, "DNF: CRASHED (hit the barrier at 36 km/h)")],
    );
    const inc = analyseIncident(index(car), track, corners)!;
    expect(inc.sentence).toBe(
      "Spun under full throttle before Turn 1 at 171 km/h, came to rest facing the wrong way, drove the wrong way for 3 s and hit the barrier at 36 km/h.",
    );
    expect(inc.causes).toEqual(["power-oversteer", "wrong-way", "barrier-contact"]);
    expect(inc.cause).toBe("Power oversteer, then wrong way");
    expect(inc.impactKmh).toBe(36);
    expect(inc.where).toBe("before Turn 1");
    expect(inc.replayFrom).toBe(1);
    expect(inc.spins).toHaveLength(1);
    expect(inc.window.t[0]).toBe(1);
    expect(inc.window.t.at(-1)).toBeCloseTo(9.5, 6);
    expect(inc.window.speedKmh).toHaveLength(121);
  });

  it("two spins with a rejoin in between", () => {
    const car = synth(
      "lun",
      11,
      (t) => {
        if (t < 4) return { dir: 0, yaw: 0, speed: 50, throttle: 0.6 };
        if (t < 6)
          return { dir: 0, yaw: ramp(t, 4, 5, 0, Math.PI / 2), speed: ramp(t, 4, 6, 50, 0), surface: 2 };
        if (t < 7) return { dir: 0, yaw: Math.PI / 2, speed: 0, surface: 2 };
        if (t < 8) return { dir: 0, yaw: ramp(t, 7, 8, Math.PI / 2, 0), speed: 1, surface: 2 };
        if (t < 10) return { dir: 0, yaw: 0, speed: ramp(t, 8, 10, 1, 20), surface: t < 9 ? 2 : 0 };
        return { dir: 0, yaw: ramp(t, 10, 10.5, 0, Math.PI / 2), speed: 20, throttle: 0.5 };
      },
      [{ t: 11, type: "crash", value: 20 }, out(11, "DNF: CRASHED (hit the barrier at 72 km/h)")],
    );
    const inc = analyseIncident(index(car), track, corners)!;
    expect(inc.sentence).toBe(
      "Spun under throttle before Turn 1 at 162 km/h, came to rest on the grass, rejoined at 0:09, lost the rear again under throttle before Turn 1 and hit the barrier at 72 km/h.",
    );
    expect(inc.cause).toBe("Power oversteer, twice");
  });

  it("a brake lock that ends in a stall", () => {
    const car = synth(
      "lock",
      8,
      (t) => {
        if (t < 3) return { dir: 0, yaw: 0, speed: 50, throttle: t < 2.4 ? 1 : 0, brake: t < 2.4 ? 0 : 1 };
        if (t < 5)
          return {
            dir: 0,
            yaw: ramp(t, 3, 4, 0, 2),
            speed: ramp(t, 3, 5, 50, 0),
            brake: 1,
            throttle: 0,
            surface: t > 4 ? 3 : 0,
          };
        return { dir: 0, yaw: 2, speed: 0, surface: 3, throttle: 0 };
      },
      [out(8, "DNF: STALLED")],
    );
    const inc = analyseIncident(index(car), track, corners)!;
    expect(inc.sentence).toBe(
      "Spun under braking before Turn 1 at 167 km/h, came to rest on the grass and stalled.",
    );
    expect(inc.causes).toEqual(["brake-lock", "stalled"]);
    expect(inc.impactKmh).toBeNull();
    expect(inc.cause).toBe("Brake lock, then stalled");
  });

  it("a driver program failure, time running out, and a finisher", () => {
    const ecu = synth("ecu", 3, () => ({ dir: 0, yaw: 0, speed: 30 }), [
      out(3, "DNF: ECU FAILURE (TypeError: x is undefined)"),
    ]);
    const a = analyseIncident(index(ecu), track, corners)!;
    expect(a.sentence).toBe("The driver program failed.");
    expect(a.error).toBe("TypeError: x is undefined");
    expect(a.cause).toBe("Driver program failure");
    expect(a.replayFrom).toBe(0);
    const slow = synth("slow", 3, () => ({ dir: 0, yaw: 0, speed: 5 }), [out(3, "TIME UP")]);
    const b = analyseIncident(index(slow), track, corners)!;
    expect(b.sentence).toBe("Ran out of time.");
    expect(b.causes).toEqual(["time-up"]);
    expect(b.error).toBeUndefined();
    const crash = synth("wall", 3, () => ({ dir: 0, yaw: 0, speed: 30 }), [
      out(3, "DNF: CRASHED (hit the barrier at 108 km/h)"),
    ]);
    const c = analyseIncident(index(crash), track, corners)!;
    expect(c.sentence).toBe("Hit the barrier at 108 km/h.");
    expect(c.cause).toBe("Barrier");
    expect(analyseIncident(index(makeCar(track, { id: "fin", speed: 50 })), track, corners)).toBeNull();
    const all = analyseIncidents(
      [index(crash), index(ecu), index(makeCar(track, { id: "fin", speed: 50 }))],
      track,
      corners,
    );
    expect(all.map((x) => x.carId).sort()).toEqual(["ecu", "wall"]);
  });
});

describe("incident titles", () => {
  it("names the way the car went out", () => {
    expect(incidentTitle({ causes: ["power-oversteer", "barrier-contact"] })).toBe("DNF · Crashed");
    expect(incidentTitle({ causes: ["ecu-failure"] })).toBe("DNF · Driver program failure");
    expect(incidentTitle({ causes: ["stalled"] })).toBe("DNF · Stalled");
    expect(incidentTitle({ causes: ["time-up"] })).toBe("Time up");
  });
});
