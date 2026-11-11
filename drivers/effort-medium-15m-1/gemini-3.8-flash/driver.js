// High performance, robust driver with friction circle coupling and trail braking

let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let vLimit = [];

const LATERAL_ACCEL = 12.6; // Balanced safe lateral grip
const BRAKE_DECEL = 14.5;   // Responsive braking deceleration
const MAX_SPEED = 85.0;     // m/s

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  // Window +-10 m to find peak curvature
  const w = Math.max(1, Math.round(10 / ds));
  const vCorner = new Array(N);

  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) {
      k = Math.max(k, Math.abs(samples[(i + d + N) % N].curvature));
    }
    vCorner[i] = Math.min(MAX_SPEED, Math.sqrt(LATERAL_ACCEL / Math.max(k, 1e-6)));
  }

  // Backward pass for braking
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

  // Steering via pure pursuit
  const lookahead = Math.min(42, Math.max(8, 8 + 0.35 * t.speed));
  const target = samples[(i + Math.round(lookahead / ds)) % N];
  const dx = target.x - t.x;
  const dy = target.y - t.y;
  let alpha = Math.atan2(dy, dx) - t.yaw;
  while (alpha > Math.PI) alpha -= 2 * Math.PI;
  while (alpha < -Math.PI) alpha += 2 * Math.PI;

  const dist = Math.hypot(dx, dy);
  const steerAngle = Math.atan2(2 * wheelbase * Math.sin(alpha), dist);
  const steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

  // Target speed with lookahead
  const vTarget = vLimit[(i + Math.round((t.speed * 0.32) / ds)) % N];
  const err = vTarget - t.speed;

  // Friction circle: longitudinal grip available depends on lateral grip used
  const latGripUsed = Math.min(0.95, Math.abs(t.ay) / 13.0);
  const longGrip = Math.sqrt(Math.max(0, 1 - latGripUsed * latGripUsed));

  // Traction limit at lower speeds
  const tractionCap = Math.min(1, Math.max(0.35, t.speed / 45));

  let throttle = 0;
  let brake = 0;

  if (err > 0.2) {
    const maxThrottle = tractionCap * longGrip;
    throttle = Math.min(maxThrottle, (err - 0.2) / 2.0);
  } else if (err < -0.3) {
    brake = Math.min(longGrip, (-err - 0.3) / 2.0);
  }

  return { throttle, brake, steer };
}
