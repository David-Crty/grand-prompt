import { describe, expect, it } from "vitest";
import { plausibility } from "../../../scripts/plausibility.js";
import {
  carSpec,
  GRAVITY,
  initialState,
  Prng,
  pacejka,
  SURFACES,
  speedOf,
  VehicleModel,
} from "../src/index.js";
import { protoCar } from "./helpers.js";

const car = protoCar();
const T = SURFACES.track;
const dt = 0.002;

describe("vehicle plausibility targets (PLAN 5.3)", () => {
  const p = plausibility(car);
  it("top speed 320-350 km/h", () => {
    expect(p.topKmh).toBeGreaterThan(320);
    expect(p.topKmh).toBeLessThan(350);
  });
  it("peak braking 4.5-5.5 g from high speed", () => {
    expect(p.peakBrakeG).toBeGreaterThan(4.5);
    expect(p.peakBrakeG).toBeLessThan(5.5);
  });
  it("about 2 g in slow corners, 4-5 g in fast corners", () => {
    expect(p.lat20).toBeGreaterThan(1.6);
    expect(p.lat20).toBeLessThan(2.4);
    expect(p.lat85).toBeGreaterThan(4);
    expect(p.lat85).toBeLessThan(5);
    expect(p.lat70).toBeGreaterThan(p.lat40);
  });
  it("0-100 km/h in 2.5-3 s", () => {
    expect(p.zeroTo100).toBeGreaterThan(2.4);
    expect(p.zeroTo100).toBeLessThan(3);
  });
});

describe("vehicle model", () => {
  it("never produces NaN or Infinity under random extreme inputs", () => {
    const m = new VehicleModel(car);
    const rng = new Prng(3);
    for (const v0 of [0, 0.3, 5, 40, 95]) {
      const st = initialState(0, 0, 0);
      st.vx = v0;
      for (let i = 0; i < 20000; i++) {
        const cmd = {
          throttle: rng.next() * 3 - 1,
          brake: rng.next() * 3 - 1,
          steer: (rng.next() * 2 - 1) * 5,
        };
        const surf = [SURFACES.track, SURFACES.grass, SURFACES.gravel, SURFACES.kerb][i % 4]!;
        m.step(st, cmd, surf, T, dt);
        for (const v of Object.values(st)) expect(Number.isFinite(v)).toBe(true);
      }
      expect(Math.abs(st.steer)).toBeLessThanOrEqual(car.public.maxSteer + 1e-12);
    }
  });

  it("braking stops the car without reversing it", () => {
    const m = new VehicleModel(car);
    const st = initialState(0, 0, 0);
    st.vx = 30;
    for (let i = 0; i < 5 / dt; i++) m.step(st, { throttle: 0, brake: 1, steer: 0 }, T, T, dt);
    expect(st.vx).toBe(0);
    expect(speedOf(st)).toBeLessThan(1e-6);
    // sliding backwards (after a spin) is also braked to rest
    const back = initialState(0, 0, 0);
    back.vx = -10;
    for (let i = 0; i < 5 / dt; i++) m.step(back, { throttle: 0, brake: 1, steer: 0 }, T, T, dt);
    expect(Math.abs(back.vx)).toBeLessThan(1e-9);
  });

  it("rate-limits actuators", () => {
    const m = new VehicleModel(car);
    const st = initialState(0, 0, 0);
    m.step(st, { throttle: 1, brake: 1, steer: 1 }, T, T, dt);
    expect(st.throttle).toBeCloseTo(car.public.throttleRate * dt);
    expect(st.brake).toBeCloseTo(car.public.brakeRate * dt);
    expect(st.steer).toBeCloseTo(car.public.steerRate * dt);
  });

  it("is kinematic at low speed: turns where the wheels point", () => {
    const m = new VehicleModel(car);
    const st = initialState(0, 0, 0);
    st.vx = 2;
    st.steer = 0.2;
    for (let i = 0; i < 0.5 / dt; i++) m.step(st, { throttle: 0.05, brake: 0, steer: 0.2 }, T, T, dt);
    expect(st.yawRate).toBeCloseTo((st.vx * Math.tan(0.2)) / car.public.wheelbase, 1);
  });

  it("flooring the throttle in a corner spins the rear (traction limit)", () => {
    const m = new VehicleModel(car);
    const st = initialState(0, 0, 0);
    st.vx = 20;
    st.steer = 0.1;
    let maxBeta = 0;
    for (let i = 0; i < 1.5 / dt; i++) {
      m.step(st, { throttle: 1, brake: 0, steer: 0.1 }, T, T, dt);
      maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(st.vy, st.vx)));
    }
    expect(maxBeta).toBeGreaterThan(0.3);
  });

  it("grass and gravel slow the car and reduce grip", () => {
    const run = (s: typeof T) => {
      const m = new VehicleModel(car);
      const st = initialState(0, 0, 0);
      st.vx = 40;
      for (let i = 0; i < 2 / dt; i++) m.step(st, { throttle: 0, brake: 0, steer: 0 }, s, s, dt);
      return st.vx;
    };
    expect(run(SURFACES.gravel)).toBeLessThan(run(SURFACES.grass));
    expect(run(SURFACES.grass)).toBeLessThan(run(SURFACES.track));
  });

  it("downforce increases with speed: braking g grows with speed", () => {
    const m = new VehicleModel(car);
    const brakeG = (v: number) => {
      const st = initialState(0, 0, 0);
      st.vx = v;
      st.brake = 1;
      for (let i = 0; i < 20; i++) m.step(st, { throttle: 0, brake: 1, steer: 0 }, T, T, dt);
      return -st.ax / GRAVITY;
    };
    expect(brakeG(90)).toBeGreaterThan(brakeG(30) + 1);
  });

  it("pacejka peaks then falls off", () => {
    const t = car.hidden.tireFront;
    const ys = [0.02, 0.06, 0.1, 0.3, 0.8].map((a) => pacejka(t, a));
    expect(ys[1]!).toBeGreaterThan(ys[0]!);
    expect(Math.max(...ys)).toBeLessThanOrEqual(1);
    expect(ys[4]!).toBeLessThan(Math.max(...ys));
    expect(pacejka(t, -0.05)).toBeCloseTo(-pacejka(t, 0.05));
  });

  it("carSpec hides constants at level B", () => {
    expect(carSpec(car, "B").hidden).toBeUndefined();
    expect(carSpec(car, "A").hidden?.ClA).toBe(car.hidden.ClA);
    expect(carSpec(car, "B").mass).toBe(car.public.mass);
  });

  it("axle positions straddle the centre of mass", () => {
    const m = new VehicleModel(car);
    const a = m.axles(initialState(10, 0, 0));
    expect(a.fx - a.rx).toBeCloseTo(car.public.wheelbase);
    expect(m.lf).toBeGreaterThan(m.lr);
  });
});
