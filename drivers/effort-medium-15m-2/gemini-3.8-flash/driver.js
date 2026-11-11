// Candidate 3: Aero downforce speed modeling, BRAKE_DECEL 16.0, MAX_SPEED 92
let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let vLimit = [];

const LATERAL_ACCEL = 15.0; // m/s^2 base mechanical grip
const AERO_FACTOR = 0.0010; // downforce compensation (effective 1/m reduction)
const BRAKE_DECEL = 16.0; // m/s^2
const MAX_SPEED = 92; // m/s (~331 km/h)

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  const w = Math.max(1, Math.round(11 / ds));
  const vCorner = new Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) k = Math.max(k, Math.abs(samples[(i + d + N) % N].curvature));
    const kEff = Math.max(1e-5, k - AERO_FACTOR);
    vCorner[i] = Math.min(MAX_SPEED, Math.sqrt(LATERAL_ACCEL / kEff));
  }

  // 3-pass backward pass to handle loop wrap-around
  vLimit = vCorner.slice();
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = vLimit[(i + 1) % N];
      vLimit[i] = Math.min(vLimit[i], Math.sqrt(next * next + 2 * BRAKE_DECEL * ds));
    }
  }
}

export function step(t) {
  const i = Math.floor(t.s / ds) % N;

  // Pure pursuit with lookahead scaling
  const lookahead = Math.max(7, Math.min(42, 6 + 0.48 * t.speed));
  const target = samples[(i + Math.round(lookahead / ds)) % N];
  const dx = target.x - t.x;
  const dy = target.y - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const dist = Math.hypot(dx, dy);
  const rawSteerAngle = Math.atan2(2 * wheelbase * Math.sin(alpha), dist);

  // Steer limiter to prevent front tire washout at high speed
  const maxAllowedAngle = Math.min(maxSteer, (wheelbase * 20) / Math.max(50, t.speed * t.speed) + 0.065);
  const clampedSteerAngle = Math.max(-maxAllowedAngle, Math.min(maxAllowedAngle, rawSteerAngle));
  const steer = clampedSteerAngle / maxSteer;

  // Longitudinal control: look ahead proportional to speed
  const lookaheadSpeed = Math.round((0.36 * t.speed + 3) / ds);
  const vTarget = vLimit[(i + lookaheadSpeed) % N];
  const err = vTarget - t.speed;

  // Friction circle throttle modulation
  const latLoadRatio = Math.min(1, Math.abs(t.ay) / 19);
  const gripAvail = Math.max(0, 1 - latLoadRatio * latLoadRatio);

  let throttle = 0;
  let brake = 0;

  if (err < -0.8) {
    brake = Math.min(1, -err * 0.25);
    throttle = 0;
  } else if (err > 0) {
    const tractionFactor = Math.min(1, Math.max(0.35, t.speed / 45));
    const throttleCap = tractionFactor * gripAvail;
    throttle = Math.min(throttleCap, 0.25 + err * 0.45);
    brake = 0;
  }

  return { throttle, brake, steer };
}
