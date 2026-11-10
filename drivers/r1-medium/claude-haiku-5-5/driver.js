// v3: speed-dependent lateral budget (downforce), higher braking budget, reactive friction-circle throttle.
let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let vLimit = [];
let kAbs = [];

const AY0 = 9.5;       // m/s^2 lateral budget at low speed
const AY_V2 = 0.004;   // extra lateral budget per (m/s)^2 (downforce)
const AX_BRAKE = 15;   // m/s^2 braking budget
const MAX_SPEED = 90;  // m/s

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ayMax = (v) => AY0 + AY_V2 * v * v;

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  kAbs = new Array(N);
  const w = Math.max(1, Math.round(6 / ds));
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) k = Math.max(k, Math.abs(samples[(i + d + N) % N].curvature));
    kAbs[i] = k;
  }
  // Solve k v^2 = AY0 + AY_V2 v^2 for v.
  vLimit = new Array(N);
  for (let i = 0; i < N; i++) {
    const k = Math.max(kAbs[i], 1e-6);
    let v = k > AY_V2 ? Math.sqrt(AY0 / (k - AY_V2)) : MAX_SPEED;
    vLimit[i] = Math.min(MAX_SPEED, v);
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = vLimit[(i + 1) % N];
      vLimit[i] = Math.min(vLimit[i], Math.sqrt(next * next + 2 * AX_BRAKE * ds));
    }
  }
}

export function step(t) {
  const i = Math.floor(t.s / ds) % N;
  const v = t.speed;

  // Steering: pure pursuit with a speed-scaled lookahead.
  const L = clamp(8 + 0.35 * v, 8, 40);
  const target = samples[(i + Math.round(L / ds)) % N];
  const dx = target.x - t.x;
  const dy = target.y - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const dist = Math.hypot(dx, dy) || 1;
  const steerAngle = Math.atan2(2 * wheelbase * Math.sin(alpha), dist);
  const steer = clamp(steerAngle / maxSteer, -1, 1);

  // Speed target: look ahead by the actuator/brake lag.
  const ahead = Math.round(clamp(v * 0.25, 0, 60) / ds);
  let vT = vLimit[(i + ahead) % N];
  if (t.surface !== "track") vT = Math.min(vT, 0.7 * v);
  const err = vT - v;

  let throttle = 0;
  let brake = 0;
  const slipping = v > 12 && (Math.abs(t.vy) > 2.5 || Math.abs(t.headingError) > 0.25);
  if (err < 0) {
    brake = clamp(-err * 0.35 + 0.05, 0, 1);
  } else if (!slipping) {
    // Friction circle: longitudinal budget left after the lateral demand (predicted and measured).
    const lat = ayMax(v);
    const latReq = Math.max(v * v * kAbs[i], Math.abs(t.ay));
    const latFrac = clamp(latReq / lat, 0, 1);
    const cap = Math.sqrt(Math.max(0, 1 - latFrac * latFrac));
    const lowCap = v < 20 ? 0.45 : 1;
    throttle = clamp(Math.min(0.35 + err * 0.3, cap, lowCap), 0, 1);
    if (v < 3) throttle = Math.max(throttle, 0.3); // never sit still
  } else {
    brake = 0.1;
  }

  return { throttle, brake, steer };
}
