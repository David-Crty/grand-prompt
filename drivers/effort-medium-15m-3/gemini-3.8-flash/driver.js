// Advanced racing driver with aero downforce, backward braking pass, and friction-circle traction control.

let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let vLimit = [];

const A0 = 14.2; // Base mechanical lateral grip (m/s^2)
const K_AERO = 0.0018; // Aero downforce factor
const BRAKE_DECEL = 14.2; // Braking deceleration (m/s^2)
const MAX_SPEED = 85; // Max speed (m/s)

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  // Curvature window +-10 m to catch corners
  const w = Math.max(1, Math.round(10 / ds));
  const vCorner = new Array(N);

  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) {
      k = Math.max(k, Math.abs(samples[(i + d + N) % N].curvature));
    }
    // Effective curvature accounting for downforce: v^2 * (k - K_AERO) <= A0
    const effCurv = k - K_AERO;
    if (effCurv <= 1e-4) {
      vCorner[i] = MAX_SPEED;
    } else {
      vCorner[i] = Math.min(MAX_SPEED, Math.sqrt(A0 / effCurv));
    }
  }

  // Backward pass to ensure braking points are reached before corners
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

  // Pure pursuit path tracking with speed-dependent lookahead
  const lookahead = Math.min(36, 6.5 + 0.34 * t.speed);
  const target = samples[(i + Math.round(lookahead / ds)) % N];
  const dx = target.x - t.x;
  const dy = target.y - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const dist = Math.hypot(dx, dy);
  const steerAngle = Math.atan2(2 * wheelbase * Math.sin(alpha), dist);
  const steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

  // Anticipatory speed target
  const vTarget = vLimit[(i + Math.round((t.speed * 0.32) / ds)) % N];
  const err = vTarget - t.speed;

  // Traction Control & Friction Circle
  // 1. Friction circle: limit throttle when lateral acceleration is near max grip
  const maxAy = A0 + K_AERO * t.speed * t.speed;
  const ayRatio = Math.min(1, Math.abs(t.ay) / maxAy);
  const latGripFactor = Math.sqrt(Math.max(0, 1 - ayRatio * ayRatio));

  // 2. Body sideslip angle beta = |vy| / speed: cut throttle if car starts sliding
  const beta = Math.abs(t.vy) / Math.max(5, t.speed);
  const slipPenalty = Math.max(0, 1 - Math.max(0, beta - 0.04) / 0.05);

  // 3. Progressive throttle based on speed, steering and friction circle
  const speedScale = Math.min(1, Math.max(0.3, t.speed / 50));
  const throttleCap = speedScale * (1 - 0.35 * Math.abs(steer)) * (0.2 + 0.8 * latGripFactor) * slipPenalty;

  const throttle = err > 0 ? Math.min(throttleCap, 0.2 + err * 0.45) : 0;
  const brake = err < -0.5 ? Math.min(1, -err * 0.25) : 0;

  return { throttle, brake, steer };
}
