// Candidate driver v1: curvature-based speed profile (forward + backward passes),
// Stanley-style path tracking with curvature feedforward, proportional speed control.

let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let vLimit = [];

// Lateral acceleration capacity (m/s^2): grows with speed (downforce). Conservative first guess.
const A_LAT0 = 14.5;
const A_LAT_V2 = 0.0035;
const MAX_SPEED = 95; // m/s
const BRAKE_DECEL = 20; // m/s^2 (tyre limit used for the braking profile)
const ACCEL_MAX = 9; // m/s^2 traction limit at low speed
const POWER = 740000; // W
const MASS = 800;
const AY_TRACTION = 13; // m/s^2, lateral load above which the rear cannot take more throttle
const MARGIN = 0.98; // speed margin on the profile

function aLat(v) {
  return A_LAT0 + A_LAT_V2 * v * v;
}

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  // Corner speed: worst curvature within +-8 m, solved for speed with speed-dependent grip.
  const w = Math.max(1, Math.round(8 / ds));
  const vCorner = new Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) {
      const kk = Math.abs(samples[(i + d + N) % N].curvature);
      if (kk > k) k = kk;
    }
    let v = MAX_SPEED;
    if (k > 1e-5) {
      // Solve A_LAT0 + A_LAT_V2 v^2 = v^2 k  -> v^2 = A_LAT0 / (k - A_LAT_V2), if k > A_LAT_V2.
      // Otherwise the car is limited only by MAX_SPEED (curvature below the aero-limited floor).
      const denom = k - A_LAT_V2;
      if (denom > 1e-6) v = Math.sqrt(A_LAT0 / denom);
      v = Math.min(v, MAX_SPEED);
    }
    vCorner[i] = v;
  }

  vLimit = vCorner.slice();
  // Two passes around the loop so the wrap-around (finish line) is handled.
  for (let pass = 0; pass < 2; pass++) {
    // Forward: acceleration limit.
    for (let i = 0; i < 2 * N; i++) {
      const a = i % N;
      const b = (a + 1) % N;
      const v = vLimit[a];
      const accel = Math.min(ACCEL_MAX, (POWER / MASS) / Math.max(v, 5));
      const cap = Math.sqrt(v * v + 2 * accel * ds);
      if (vLimit[b] > cap) vLimit[b] = cap;
    }
    // Backward: braking limit.
    for (let i = 2 * N - 1; i >= 0; i--) {
      const a = i % N;
      const b = (a + 1) % N;
      const v = vLimit[b];
      const cap = Math.sqrt(v * v + 2 * BRAKE_DECEL * ds);
      if (vLimit[a] > cap) vLimit[a] = cap;
    }
  }
  for (let i = 0; i < N; i++) vLimit[i] *= MARGIN;
}

export function step(t) {
  const i = Math.floor(t.s / ds) % N;
  const v = t.speed;

  // Steering: feedforward from curvature a little ahead (actuator lag), feedback on heading and offset.
  const ahead = Math.round((0.2 * v) / ds);
  const kFF = samples[(i + ahead) % N].curvature;
  const delta_ff = Math.atan(wheelbase * kFF);
  const kh = 1.0;
  const kn = 0.8;
  const delta_fb = -kh * t.headingError - Math.atan((kn * t.n) / (v + 2));
  const delta = delta_ff + delta_fb;
  let steer = delta / maxSteer;
  if (steer > 1) steer = 1;
  if (steer < -1) steer = -1;

  // Speed: follow the profile a short distance ahead (covers brake/throttle lag).
  const look = Math.round((0.4 * v + 4) / ds);
  const target = vLimit[(i + look) % N];
  const err = target - v;
  let throttle = 0;
  let brake = 0;
  if (err < -0.5) {
    brake = Math.min(1, -err * 0.2 + 0.1);
  } else if (err > 0.5) {
    // Traction limit at low speed, while turning hard, and when the tyres already carry lateral load
    // (friction circle: throttle is only safe once lateral acceleration has eased off).
    const latUse = Math.abs(t.ay) / AY_TRACTION;
    const lateralCap = latUse >= 1 ? 0 : Math.sqrt(1 - latUse * latUse);
    const tractionCap = Math.min(1, 0.35 + v / 40) * (1 - 0.6 * Math.abs(steer)) * lateralCap;
    throttle = Math.min(tractionCap, 0.25 + err * 0.3);
  } else {
    // Near the target speed: hold a little throttle rather than coasting, within the traction limit.
    const latUse = Math.abs(t.ay) / AY_TRACTION;
    const lateralCap = latUse >= 1 ? 0 : Math.sqrt(1 - latUse * latUse);
    throttle = Math.min(0.3, lateralCap * (1 - 0.6 * Math.abs(steer)) * 0.3);
  }
  return { throttle, brake, steer };
}
