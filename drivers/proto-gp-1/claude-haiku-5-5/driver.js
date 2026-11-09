// Speed profile from curvature (speed-dependent lateral limit), braking and accel passes;
// Stanley steering with curvature feedforward.

let S = [];
let N = 0;
let ds = 2;
let L = 3.6;
let maxSteer = 0.35;
let mass = 800;
let maxPower = 740000;
let vP = [];
let kap = [];

const LAT0 = 16.5; // m/s^2 lateral limit at low speed
const LAT_SLOPE = 0.13; // extra m/s^2 per m/s of speed (downforce)
const DEC = 18; // m/s^2 braking limit
const ACC_MAX = 13; // m/s^2 traction limit at low speed
const ENGINE_EFF = 0.8; // share of the ideal P/(m v) that reaches the road
const VMAX = 85;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export function init(track, car) {
  S = track.samples;
  N = S.length;
  ds = track.sampleSpacing;
  L = car.wheelbase;
  maxSteer = car.maxSteer;
  mass = car.mass;
  maxPower = car.maxPower;

  kap = new Array(N);
  for (let i = 0; i < N; i++) kap[i] = S[i].curvature;

  const accAt = (v) => Math.min(ACC_MAX, (ENGINE_EFF * maxPower) / (mass * Math.max(v, 1)));

  const w = Math.max(1, Math.round(4 / ds));
  vP = new Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) k = Math.max(k, Math.abs(kap[(i + d + N) % N]));
    k = Math.max(k, 1e-6);
    let v = Math.sqrt(LAT0 / k);
    for (let it = 0; it < 4; it++) v = Math.sqrt((LAT0 + LAT_SLOPE * v) / k);
    vP[i] = Math.min(VMAX, v);
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const nx = vP[(i + 1) % N];
      vP[i] = Math.min(vP[i], Math.sqrt(nx * nx + 2 * DEC * ds));
    }
    for (let i = 0; i < N; i++) {
      const pv = vP[(i - 1 + N) % N];
      vP[i] = Math.min(vP[i], Math.sqrt(pv * pv + 2 * accAt(pv) * ds));
    }
  }
}

export function step(t) {
  const i = Math.floor(t.s / ds) % N;
  const v = Math.max(0, t.speed);

  // Steering: feedforward from curvature ahead, feedback on heading error and lateral offset.
  const ahead = (i + 2) % N;
  const ff = Math.atan(L * kap[ahead]);
  const fb = -t.headingError - Math.atan((1.0 * t.n) / (v + 1));
  const steer = clamp((ff + fb) / maxSteer, -1, 1);

  // Speed: follow the profile, with a small look-ahead for actuator lag.
  const target = vP[(i + Math.round((v * 0.1) / ds)) % N];
  const err = target - v;
  let throttle = 0;
  let brake = 0;
  if (err < -0.3) {
    brake = clamp(-err * 0.3, 0, 1);
  } else {
    const spare = clamp(1 - (Math.abs(t.ay) - 8) / 12, 0, 1);
    const cap = clamp(0.35 + v / 25, 0, 1) * (1 - 0.6 * Math.abs(steer)) * spare;
    throttle = clamp(err * 0.5, 0, cap);
  }

  return { throttle, brake, steer };
}
