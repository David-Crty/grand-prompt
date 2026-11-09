import { clamp } from "./math.js";
import type { CarConfig, CarHidden, CarSpec, SurfaceOrBarrier, TireParams } from "./types.js";

export const GRAVITY = 9.81;

export interface SurfaceProps {
  grip: number;
  /** Extra resistance in g (fraction of axle weight). */
  drag: number;
}

export const SURFACES: Record<SurfaceOrBarrier, SurfaceProps> = {
  track: { grip: 1, drag: 0 },
  kerb: { grip: 0.9, drag: 0 },
  grass: { grip: 0.5, drag: 0.12 },
  gravel: { grip: 0.4, drag: 0.6 },
  barrier: { grip: 0.4, drag: 0.6 },
};

export interface VehicleState {
  x: number;
  y: number;
  yaw: number;
  vx: number;
  vy: number;
  yawRate: number;
  /** Actual actuator states. steer in rad at the wheels. */
  steer: number;
  throttle: number;
  brake: number;
  /** Body-frame acceleration from the last step (what an IMU would read). */
  ax: number;
  ay: number;
}

export interface VehicleCommand {
  throttle: number;
  brake: number;
  /** rad at the wheels */
  steer: number;
}

export function initialState(x: number, y: number, yaw: number): VehicleState {
  return { x, y, yaw, vx: 0, vy: 0, yawRate: 0, steer: 0, throttle: 0, brake: 0, ax: 0, ay: 0 };
}

export function speedOf(s: VehicleState): number {
  return Math.hypot(s.vx, s.vy);
}

export function carSpec(car: CarConfig, infoLevel: "A" | "B"): CarSpec {
  const spec: CarSpec = { infoLevel, ...car.public };
  if (infoLevel === "A") spec.hidden = structuredClone(car.hidden);
  return spec;
}

/** Precomputed per-car constants. */
export class VehicleModel {
  readonly m: number;
  readonly L: number;
  readonly lf: number;
  readonly lr: number;
  readonly h: CarHidden;
  readonly fzStaticF: number;
  readonly fzStaticR: number;
  readonly aero: number; // 0.5 * rho

  constructor(readonly car: CarConfig) {
    const p = car.public;
    this.m = p.mass;
    this.L = p.wheelbase;
    this.lf = p.wheelbase * (1 - p.weightFront);
    this.lr = p.wheelbase * p.weightFront;
    this.h = car.hidden;
    this.fzStaticF = this.m * GRAVITY * p.weightFront;
    this.fzStaticR = this.m * GRAVITY * (1 - p.weightFront);
    this.aero = 0.5 * car.hidden.airDensity;
  }

  /** Axle world positions (front, rear) for surface lookup. */
  axles(s: VehicleState): { fx: number; fy: number; rx: number; ry: number } {
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    return { fx: s.x + c * this.lf, fy: s.y + sn * this.lf, rx: s.x - c * this.lr, ry: s.y - sn * this.lr };
  }

  private mu(t: TireParams, fz: number, fzStatic: number, grip: number): number {
    const k = 1 - this.h.loadSensitivity * (fz / fzStatic - 1);
    return t.mu * Math.max(0.3, k) * grip;
  }

  /**
   * Advance the state by dt (semi-implicit Euler). Dynamic bicycle model with Pacejka lateral
   * forces, friction-circle combined slip, aero and a kinematic blend at low speed.
   */
  step(st: VehicleState, cmd: VehicleCommand, sf: SurfaceProps, sr: SurfaceProps, dt: number): void {
    const p = this.car.public;
    const h = this.h;
    const m = this.m;

    // actuators (rate limited)
    const maxSteer = p.maxSteer;
    const target = clamp(cmd.steer, -maxSteer, maxSteer);
    st.steer += clamp(target - st.steer, -p.steerRate * dt, p.steerRate * dt);
    st.throttle += clamp(clamp(cmd.throttle, 0, 1) - st.throttle, -p.throttleRate * dt, p.throttleRate * dt);
    st.brake += clamp(clamp(cmd.brake, 0, 1) - st.brake, -p.brakeRate * dt, p.brakeRate * dt);

    const { vx, vy, yawRate: r } = st;
    const delta = st.steer;
    const v = Math.hypot(vx, vy);
    const q = this.aero * v * v;
    const drag = q * h.CdA;
    const df = q * h.ClA;

    // vertical loads with aero and longitudinal load transfer from the previous step
    const transfer = (m * st.ax * h.cgHeight) / this.L;
    const fzF = Math.max(50, this.fzStaticF + df * h.aeroBalanceFront - transfer);
    const fzR = Math.max(50, this.fzStaticR + df * (1 - h.aeroBalanceFront) + transfer);
    const capF = this.mu(h.tireFront, fzF, this.fzStaticF, sf.grip) * fzF;
    const capR = this.mu(h.tireRear, fzR, this.fzStaticR, sr.grip) * fzR;

    // longitudinal demand: drive on the rear, brakes oppose motion and never reverse the car
    const drive = st.throttle * Math.min(p.maxPower / Math.max(v, 1), h.maxDriveForce);
    const brakeTotal = st.brake * h.maxBrakeForce;
    const stopForce = (m * Math.abs(vx)) / dt;
    const brakeMag = Math.min(brakeTotal, stopForce);
    const dir = vx >= 0 ? 1 : -1;
    const fxFdem = -dir * brakeMag * h.brakeBiasFront;
    const fxRdem = drive - dir * brakeMag * (1 - h.brakeBiasFront);

    const [fxF, latF] = this.frictionCircle(fxFdem, capF);
    const [fxR, latR] = this.frictionCircle(fxRdem, capR);

    // slip angles in each tire's frame (abs(vx) keeps sign sane when travelling backwards)
    const cd = Math.cos(delta);
    const sd = Math.sin(delta);
    const vyF = vy + this.lf * r;
    const vxFw = vx * cd + vyF * sd;
    const vyFw = -vx * sd + vyF * cd;
    const alphaF = -Math.atan2(vyFw, Math.max(Math.abs(vxFw), 0.5));
    const alphaR = -Math.atan2(vy - this.lr * r, Math.max(Math.abs(vx), 0.5));
    const fyF = pacejka(h.tireFront, alphaF) * capF * latF;
    const fyR = pacejka(h.tireRear, alphaR) * capR * latR;

    // resistances
    const roll = h.rollingResistance * (fzF + fzR);
    const extra = (sf.drag * this.fzStaticF + sr.drag * this.fzStaticR) * (v > 0.5 ? 1 : v / 0.5);
    const resist = Math.min(drag + roll + extra, stopForce);

    const fxBody = fxR + fxF * cd - fyF * sd - dir * resist;
    const fyBody = fyR + fxF * sd + fyF * cd;
    const mz = this.lf * (fxF * sd + fyF * cd) - this.lr * fyR;

    const ax = fxBody / m;
    const ay = fyBody / m;
    let dvx = ax + vy * r;
    let dvy = ay - vx * r;
    let dr = mz / h.yawInertia;

    // blend towards a kinematic model at low speed
    const lambda = clamp((v - 1.5) / 3, 0, 1);
    if (lambda < 1) {
      const td = Math.tan(delta);
      const tau = 0.03;
      const vyK = (vx * td * this.lr) / this.L;
      const rK = (vx * td) / this.L;
      const dvxK = (fxR + fxF - dir * resist) / m;
      dvx = lambda * dvx + (1 - lambda) * dvxK;
      dvy = lambda * dvy + (1 - lambda) * ((vyK - vy) / tau);
      dr = lambda * dr + (1 - lambda) * ((rK - r) / tau);
    }

    st.vx += dvx * dt;
    st.vy += dvy * dt;
    st.yawRate += dr * dt;
    // Braking can stop the car but never push it backwards.
    if ((vx > 0 && st.vx < 0 && drive === 0) || (vx < 0 && st.vx > 0 && drive === 0)) st.vx = 0;

    const c = Math.cos(st.yaw);
    const s = Math.sin(st.yaw);
    st.x += (st.vx * c - st.vy * s) * dt;
    st.y += (st.vx * s + st.vy * c) * dt;
    st.yaw += st.yawRate * dt;
    st.ax = ax;
    st.ay = ay;
  }

  /** Clip a longitudinal force to the axle's friction circle; returns [fx, remaining lateral fraction]. */
  private frictionCircle(fx: number, cap: number): [number, number] {
    if (Math.abs(fx) >= cap) {
      const sl = this.h.slidingFriction;
      return [Math.sign(fx) * cap * sl, Math.sqrt(1 - sl * sl)];
    }
    const u = fx / cap;
    return [fx, Math.sqrt(1 - u * u)];
  }
}

/** Normalized Pacejka lateral force (peak 1). */
export function pacejka(t: TireParams, alpha: number): number {
  return Math.sin(t.C * Math.atan(t.B * alpha));
}
