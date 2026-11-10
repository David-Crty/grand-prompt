// Baseline driver: follows the centerline with pure pursuit and drives a conservative speed
// computed from track curvature. It finishes laps, slowly. Start here and make it fast.

let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let vLimit = [];

const LATERAL_ACCEL = 20; // m/s^2, deliberately conservative (ignores downforce)
const BRAKE_DECEL = 13; // m/s^2
const MAX_SPEED = 80; // m/s

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  // Corner speed from the worst curvature within +-10 m.
  const w = Math.max(1, Math.round(10 / ds));
  const vCorner = new Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) k = Math.max(k, Math.abs(samples[(i + d + N) % N].curvature));
    vCorner[i] = Math.min(MAX_SPEED, Math.sqrt(LATERAL_ACCEL / Math.max(k, 1e-6)));
  }

  // Backward pass so we brake in time: v_i <= sqrt(v_{i+1}^2 + 2 a ds). Two loops handle wrap-around.
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

  // Pure pursuit: aim at a point on the centerline ahead of the car.
  const lookahead = Math.min(40, 8 + 0.35 * t.speed);
  const target = samples[(i + Math.round(lookahead / ds)) % N];
  const dx = target.x - t.x;
  const dy = target.y - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const dist = Math.hypot(dx, dy);
  const steerAngle = Math.atan2(2 * wheelbase * Math.sin(alpha), dist);
  const steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

  // Speed: look a little ahead to account for actuator delay.
  const vTarget = vLimit[(i + Math.round((t.speed * 0.3) / ds)) % N];
  const err = vTarget - t.speed;
  // Full throttle at low speed spins the rear wheels (traction limited), so cap it by speed and steering.
  const throttleCap = Math.min(1, Math.max(0.3, t.speed / 55)) * (1 - 0.5 * Math.abs(steer));
  const cornerCap = Math.max(0.18, 1 - Math.abs(t.ay) * 0.045);
  const slip = Math.max(0, -t.vy * Math.sign(t.ay) / Math.max(10, t.speed));
  const stabilityCap = Math.max(0, 1 - 12 * slip);
  const throttle = err > 0 ? Math.min(throttleCap, cornerCap, stabilityCap, 0.2 + err * 0.4) : 0;
  const brake = err < -0.5 ? Math.min(1, -err * 0.25) : 0;

  return { throttle, brake, steer };
}
