// Racing driver: curvature speed profile + backward braking pass + pure pursuit with lookahead.
let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let vLimit = [];

const LATERAL_ACCEL = 12.5; // m/s^2
const BRAKE_DECEL = 12; // m/s^2
const MAX_SPEED = 90; // m/s

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  const w = Math.max(1, Math.round(10 / ds));
  const vCorner = new Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) k = Math.max(k, Math.abs(samples[(i + d + N) % N].curvature));
    vCorner[i] = Math.min(MAX_SPEED, Math.sqrt(LATERAL_ACCEL / Math.max(k, 1e-6)));
  }
  vLimit = vCorner.slice();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = vLimit[(i + 1) % N];
      vLimit[i] = Math.min(vLimit[i], Math.sqrt(next * next + 2 * BRAKE_DECEL * ds));
    }
  }
}

export function step(t) {
  const i = Math.floor(t.s / ds) % N;

  const lookahead = Math.min(35, 6 + 0.3 * t.speed);
  const target = samples[(i + Math.round(lookahead / ds)) % N];
  const dx = target.x - t.x;
  const dy = target.y - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const dist = Math.hypot(dx, dy);
  const steerAngle = Math.atan2(2 * wheelbase * Math.sin(alpha), dist);
  const steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

  const vTarget = vLimit[(i + Math.round((t.speed * 0.3) / ds)) % N];
  const err = vTarget - t.speed;
  const throttleCap = Math.min(1, Math.max(0.35, t.speed / 45)) * (1 - 0.7 * Math.abs(steer));
  const throttle = err > 0 ? Math.min(throttleCap, 0.3 + err * 0.4) : 0;
  const throttleFinal = Math.abs(t.ay) > 9 ? Math.min(throttle, 0.3) : throttle;
  const brake = err < -1 ? Math.min(1, -err * 0.2) : 0;

  return { throttle: throttleFinal, brake, steer };
}
