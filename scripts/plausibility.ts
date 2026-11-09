// Vehicle plausibility checks (PLAN 5.3). Prints top speed, braking, lateral g, 0-100.
import { readFileSync } from "node:fs";
import { type CarConfig, GRAVITY, initialState, SURFACES, VehicleModel } from "@bench/sim";

const car = JSON.parse(readFileSync("cars/proto.json", "utf8")) as CarConfig;
export function plausibility(car: CarConfig) {
  const m = new VehicleModel(car);
  const dt = 0.002;
  const T = SURFACES.track;
  // 0-100 with ideal launch control (throttle searched to stay just inside traction)
  let st = initialState(0, 0, 0);
  let t = 0;
  while (st.vx < 100 / 3.6 && t < 10) {
    const fz =
      m.fzStaticR +
      0.5 * car.hidden.airDensity * car.hidden.ClA * st.vx ** 2 * (1 - car.hidden.aeroBalanceFront) +
      (m.m * st.ax * car.hidden.cgHeight) / m.L;
    const cap = car.hidden.tireRear.mu * fz * 0.97;
    const full = Math.min(car.public.maxPower / Math.max(st.vx, 1), car.hidden.maxDriveForce);
    m.step(st, { throttle: Math.min(1, cap / full), brake: 0, steer: 0 }, T, T, dt);
    t += dt;
  }
  const zeroTo100 = t;
  // top speed: long straight
  st = initialState(0, 0, 0);
  st.vx = 60;
  for (let i = 0; i < 60 / dt; i++) m.step(st, { throttle: 1, brake: 0, steer: 0 }, T, T, dt);
  const top = st.vx;
  // peak braking from top speed
  m.step(st, { throttle: 0, brake: 1, steer: 0 }, T, T, dt);
  let peakBrake = 0;
  for (let i = 0; i < 0.5 / dt; i++) {
    m.step(st, { throttle: 0, brake: 1, steer: 0 }, T, T, dt);
    peakBrake = Math.max(peakBrake, -st.ax / GRAVITY);
  }
  // steady-state cornering: max lateral g at a given speed by slowly increasing steer
  const lateral = (v: number) => {
    let best = 0;
    for (let steer = 0.002; steer < car.public.maxSteer; steer += 0.002) {
      const s = initialState(0, 0, 0);
      s.vx = v;
      s.steer = steer;
      for (let i = 0; i < 1.5 / dt; i++) {
        // hold speed with throttle
        const thr = Math.max(0, Math.min(1, (v - Math.hypot(s.vx, s.vy)) * 2 + 0.3));
        m.step(s, { throttle: thr, brake: 0, steer }, T, T, dt);
      }
      const sp = Math.hypot(s.vx, s.vy);
      if (Math.abs(sp - v) > 2 || Math.abs(s.vy) > 0.15 * sp) break;
      best = Math.max(best, Math.abs(s.ay) / GRAVITY);
    }
    return best;
  };
  return {
    zeroTo100,
    topKmh: top * 3.6,
    peakBrakeG: peakBrake,
    lat20: lateral(20),
    lat40: lateral(40),
    lat70: lateral(70),
    lat85: lateral(85),
  };
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(plausibility(car));
