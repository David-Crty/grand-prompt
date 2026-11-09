// v2: speed profile with tunable grip/brake limits, pure pursuit steering, progressive throttle.

let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let vLimit = [];

const LAT_ACCEL = 16; // m/s^2 corner limit (conservative until tuned from telemetry)
const BRAKE_DECEL = 17; // m/s^2 braking limit used in the backward pass
const MAX_SPEED = 90; // m/s

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  // Corner speed from the worst curvature within +-8 m.
  const w = Math.max(1, Math.round(8 / ds));
  const vCorner = new Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) {
      const c = Math.abs(samples[(i + d + N) % N].curvature);
      if (c > k) k = c;
    }
    vCorner[i] = Math.min(MAX_SPEED, Math.sqrt(LAT_ACCEL / Math.max(k, 1e-6)));
  }

  // Backward pass: v_i <= sqrt(v_{i+1}^2 + 2 a ds), run twice to wrap around the loop.
  vLimit = vCorner.slice();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = vLimit[(i + 1) % N];
      const cand = Math.sqrt(next * next + 2 * BRAKE_DECEL * ds);
      if (cand < vLimit[i]) vLimit[i] = cand;
    }
  }
}

export function step(t) {
  const i = Math.floor(t.s / ds) % N;

  // Pure pursuit: aim at a centerline point ahead of the car.
  const lookahead = Math.min(35, 7 + 0.3 * t.speed);
  const target = samples[(i + Math.round(lookahead / ds)) % N];
  const dx = target.x - t.x;
  const dy = target.y - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const dist = Math.hypot(dx, dy);
  const steerAngle = Math.atan2(2 * wheelbase * Math.sin(alpha), dist);
  const steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

  // Speed target: look ahead by about 0.3 s to cover actuator lag.
  const vTarget = vLimit[(i + Math.round((t.speed * 0.3) / ds)) % N];
  const err = vTarget - t.speed;

  // Throttle: traction-limited at low speed and while turning hard.
  const latUse = Math.min(1, Math.abs(t.ay) / LAT_ACCEL);
  const throttleCap = Math.min(1, Math.max(0.35, t.speed / 40)) * (1 - 0.4 * Math.abs(steer)) * Math.max(0.15, 1 - latUse * latUse);
  let throttle = 0;
  let brake = 0;
  if (err > 0.5) {
    throttle = Math.min(throttleCap, 0.3 + err * 0.3);
  } else if (err < -1.5) {
    brake = Math.min(1, -err * 0.15);
  }

  return { throttle, brake, steer };
}
