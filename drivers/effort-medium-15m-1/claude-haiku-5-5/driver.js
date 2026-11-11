// Racing driver: curvature speed profile (forward/backward passes) + feedforward/Stanley steering.

let S = [];
let N = 0;
let ds = 2;
let L = 3.6;
let maxSteer = 0.35;
let M = 800;
let P = 740000;
let vL = [];

const LAT = 17; // m/s^2 lateral limit (downforce helps; kept moderate)
const BRK = 17; // m/s^2 braking decel limit
const ACC = 9; // m/s^2 max accel from traction at low speed
const VMAX = 92; // m/s

export function init(track, car) {
  S = track.samples;
  N = S.length;
  ds = track.sampleSpacing;
  L = car.wheelbase;
  maxSteer = car.maxSteer;
  M = car.mass;
  P = car.maxPower;

  // Corner speed limit from worst curvature within +-6 m.
  const w = Math.max(1, Math.round(6 / ds));
  vL = new Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) {
      const c = Math.abs(S[(i + d + N) % N].curvature);
      if (c > k) k = c;
    }
    vL[i] = Math.min(VMAX, Math.sqrt(LAT / Math.max(k, 1e-6)));
  }

  // Forward (acceleration) and backward (braking) passes, twice to wrap around the loop.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const v = vL[i];
      const a = Math.min(ACC, (0.8 * P) / (M * Math.max(v, 5)));
      const j = (i + 1) % N;
      vL[j] = Math.min(vL[j], Math.sqrt(v * v + 2 * a * ds));
    }
    for (let i = N - 1; i >= 0; i--) {
      const nx = vL[(i + 1) % N];
      vL[i] = Math.min(vL[i], Math.sqrt(nx * nx + 2 * BRK * ds));
    }
  }
}

export function step(t) {
  const v = Math.max(0, t.speed);
  const i = Math.floor(t.s / ds) % N;

  // Steering: curvature feedforward plus Stanley-style feedback on heading and offset.
  const kff = S[i].curvature;
  const fb = -(t.headingError + Math.atan((1.2 * t.n) / (v + 3)));
  const delta = Math.atan(L * kff) + fb;
  const steer = Math.max(-1, Math.min(1, delta / maxSteer));

  // Speed: follow the profile a short distance ahead to cover actuator lag.
  const j = (i + Math.round((0.25 * v + 1) / ds)) % N;
  const err = vL[j] - v;
  let throttle = 0;
  let brake = 0;
  if (err < -0.5) {
    brake = Math.min(1, -err * 0.35);
  } else {
    // Low gear-less power: limit throttle at low speed and while steering to avoid rear wheelspin.
    const cap = v < 15 ? 0.3 : v < 30 ? 0.6 : 1;
    const tcap = cap * Math.max(0, 1 - 0.8 * Math.abs(steer));
    throttle = Math.max(0, Math.min(tcap, 0.25 + 0.3 * err));
  }

  return { throttle, brake, steer };
}
