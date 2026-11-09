// House reference driver (internal, never shipped in the DDK). Minimum-curvature racing line,
// forward/backward speed profile from a g-g model with aero, pure-pursuit path tracking.
// Uses hidden car constants: from the CarSpec at information level A, else the embedded copy.
import carFile from "../../../cars/proto.json";
import type { CarHidden, CarSpec, Controls, Telemetry, TrackInfo } from "../../sim/src/types.js";

const G = 9.81;

export interface ReferenceOptions {
  /** Scales every grip-derived limit; < 1 is a slower, safer driver. */
  pace: number;
  lateralSafety: number;
  brakeSafety: number;
  edgeMargin: number;
}

export const DEFAULT_OPTIONS: ReferenceOptions = {
  pace: 1,
  lateralSafety: 0.94,
  brakeSafety: 0.9,
  edgeMargin: 0.35,
};

export function createReferenceDriver(opts: Partial<ReferenceOptions> = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  let N = 0;
  let ds = 2;
  let px = new Float64Array(0);
  let py = new Float64Array(0);
  let vProfile = new Float64Array(0);
  let aProfile = new Float64Array(0);
  let spec!: CarSpec;
  let h!: CarHidden;
  let lf = 0;
  let lr = 0;
  let L = 0;

  const q = (v: number) => 0.5 * h.airDensity * v * v;
  const muEff = (mu: number, fz: number, fzStatic: number) =>
    mu * Math.max(0.3, 1 - h.loadSensitivity * (fz / fzStatic - 1));

  function aLatMax(v: number): number {
    const m = spec.mass;
    const df = q(v) * h.ClA;
    const fzF = m * G * spec.weightFront + df * h.aeroBalanceFront;
    const fzR = m * G * (1 - spec.weightFront) + df * (1 - h.aeroBalanceFront);
    const f =
      muEff(h.tireFront.mu, fzF, m * G * spec.weightFront) * fzF +
      muEff(h.tireRear.mu, fzR, m * G * (1 - spec.weightFront)) * fzR;
    return (f / m) * o.lateralSafety * o.pace;
  }
  function aDriveMax(v: number): number {
    const m = spec.mass;
    const fzR = m * G * (1 - spec.weightFront) + q(v) * h.ClA * (1 - h.aeroBalanceFront);
    const traction = muEff(h.tireRear.mu, fzR, m * G * (1 - spec.weightFront)) * fzR * 0.95;
    const drive = Math.min(spec.maxPower / Math.max(v, 1), h.maxDriveForce, traction);
    return (drive - q(v) * h.CdA - h.rollingResistance * m * G) / m;
  }
  function aBrakeMax(v: number): number {
    const m = spec.mass;
    const fz = m * G + q(v) * h.ClA;
    const grip = muEff((h.tireFront.mu + h.tireRear.mu) / 2, fz, m * G) * fz;
    return ((Math.min(h.maxBrakeForce, grip) * o.brakeSafety * o.pace + q(v) * h.CdA) / m) * 1;
  }

  function init(track: TrackInfo, car: CarSpec): void {
    spec = car;
    h = car.hidden ?? (carFile.hidden as CarHidden);
    L = car.wheelbase;
    lf = L * (1 - car.weightFront);
    lr = L * car.weightFront;
    const s = track.samples;
    N = s.length;
    ds = track.sampleSpacing;
    const cx = new Float64Array(N);
    const cy = new Float64Array(N);
    const nx = new Float64Array(N);
    const ny = new Float64Array(N);
    const lo = new Float64Array(N);
    const hi = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const p = s[i]!;
      cx[i] = p.x;
      cy[i] = p.y;
      nx[i] = -Math.sin(p.heading);
      ny[i] = Math.cos(p.heading);
      lo[i] = -(p.widthRight - o.edgeMargin);
      hi[i] = p.widthLeft - o.edgeMargin;
    }

    // Minimum-curvature line: Laplacian smoothing along the normals, coarse to fine.
    const n = new Float64Array(N);
    px = new Float64Array(N);
    py = new Float64Array(N);
    const update = () => {
      for (let i = 0; i < N; i++) {
        px[i] = cx[i]! + nx[i]! * n[i]!;
        py[i] = cy[i]! + ny[i]! * n[i]!;
      }
    };
    update();
    for (const [k, iters] of [
      [24, 300],
      [12, 300],
      [6, 300],
      [3, 300],
      [1, 200],
    ] as const) {
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < N; i++) {
          const a = (i - k + N) % N;
          const b = (i + k) % N;
          const tx = (px[a]! + px[b]!) / 2 - px[i]!;
          const ty = (py[a]! + py[b]!) / 2 - py[i]!;
          let v = n[i]! + 0.5 * (tx * nx[i]! + ty * ny[i]!);
          v = v < lo[i]! ? lo[i]! : v > hi[i]! ? hi[i]! : v;
          n[i] = v;
          px[i] = cx[i]! + nx[i]! * v;
          py[i] = cy[i]! + ny[i]! * v;
        }
      }
    }
    update();

    // Line curvature (circumcircle over +-k points) and segment lengths.
    const kappa = new Float64Array(N);
    const seg = new Float64Array(N);
    const kk = 3;
    for (let i = 0; i < N; i++) {
      const a = (i - kk + N) % N;
      const b = (i + kk) % N;
      const ax = px[a]! - px[i]!;
      const ay = py[a]! - py[i]!;
      const bx = px[b]! - px[i]!;
      const by = py[b]! - py[i]!;
      const cross = ax * by - ay * bx;
      const d = Math.hypot(ax, ay) * Math.hypot(bx, by) * Math.hypot(bx - ax, by - ay);
      kappa[i] = d > 1e-9 ? (-2 * cross) / d : 0;
      const j = (i + 1) % N;
      seg[i] = Math.hypot(px[j]! - px[i]!, py[j]! - py[i]!);
    }

    // Speed profile.
    const vMax = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const k = Math.abs(kappa[i]!);
      let v = 100;
      for (let it = 0; it < 30; it++) v = Math.min(100, Math.sqrt(aLatMax(v) / Math.max(k, 1e-6)));
      vMax[i] = v;
    }
    const v = Float64Array.from(vMax);
    const ellipse = (a: number, vi: number, i: number) => {
      const used = vi * vi * Math.abs(kappa[i]!);
      const r = Math.min(1, used / aLatMax(vi));
      return a * Math.sqrt(Math.max(0, 1 - r * r));
    };
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k < N; k++) {
        const i = k;
        const j = (i + 1) % N;
        const acc = Math.max(0, ellipse(aDriveMax(v[i]!), v[i]!, i));
        v[j] = Math.min(v[j]!, Math.sqrt(v[i]! * v[i]! + 2 * acc * seg[i]!));
      }
      for (let k = N - 1; k >= 0; k--) {
        const i = k;
        const j = (i + 1) % N;
        const dec = Math.max(1, ellipse(aBrakeMax(v[j]!), v[j]!, j));
        v[i] = Math.min(v[i]!, Math.sqrt(v[j]! * v[j]! + 2 * dec * seg[i]!));
      }
    }
    vProfile = v;
    aProfile = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      aProfile[i] = (v[j]! * v[j]! - v[i]! * v[i]!) / (2 * seg[i]!);
    }
  }

  function step(t: Telemetry): Controls {
    const i = Math.floor(t.s / ds) % N;
    const v = Math.max(t.speed, 1);

    // Pure pursuit from the rear axle.
    const rx = t.x - Math.cos(t.yaw) * lr;
    const ry = t.y - Math.sin(t.yaw) * lr;
    const ld = Math.min(40, Math.max(7, 0.28 * v + 4));
    let j = i;
    let dist = 0;
    for (let k = 0; k < N; k++) {
      j = (i + k) % N;
      dist = Math.hypot(px[j]! - rx, py[j]! - ry);
      if (dist >= ld) break;
    }
    const alpha = Math.atan2(py[j]! - ry, px[j]! - rx) - t.yaw;
    const steerAngle = Math.atan2(2 * L * Math.sin(alpha), dist);
    const steer = Math.max(-1, Math.min(1, steerAngle / spec.maxSteer));

    // Longitudinal: profile feedforward plus proportional correction, looking ahead for actuator lag.
    const ahead = (i + Math.round((v * 0.12) / ds)) % N;
    const vt = vProfile[ahead]!;
    const aCmd = aProfile[ahead]! + 2.5 * (vt - v);
    const m = spec.mass;
    let throttle = 0;
    let brake = 0;
    if (aCmd > 0) {
      const fzR = m * G * (1 - spec.weightFront) + q(v) * h.ClA * (1 - h.aeroBalanceFront);
      const cap = muEff(h.tireRear.mu, fzR, m * G * (1 - spec.weightFront)) * fzR;
      const lat = Math.min(cap, (m * Math.abs(t.ay) * lf) / L);
      const fxAvail = Math.sqrt(cap * cap - lat * lat) * 0.92;
      const full = Math.min(spec.maxPower / v, h.maxDriveForce);
      const need = aCmd * m + q(v) * h.CdA + h.rollingResistance * m * G;
      throttle = Math.max(0, Math.min(1, need / full, fxAvail / full));
    } else {
      brake = Math.max(0, Math.min(1, (-aCmd * m - q(v) * h.CdA) / h.maxBrakeForce));
    }
    return { throttle, brake, steer };
  }

  return {
    init,
    step,
    /** Exposed for analysis and tests. */
    get line() {
      return { x: px, y: py, v: vProfile };
    },
  };
}

const defaultDriver = createReferenceDriver();
export const init = defaultDriver.init;
export const step = defaultDriver.step;
