// Robust fast racing driver with Traction Circle control
let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let vLimit = [];

const LATERAL_ACCEL = 18.5; // m/s^2 fast cornering
const BRAKE_DECEL = 15.0;   // m/s^2 responsive braking
const MAX_SPEED = 92.0;     // m/s (~331 km/h)

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  // Corner speed from the worst curvature within +-10 m
  const w = Math.max(1, Math.round(10 / ds));
  const vCorner = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) {
      const curK = Math.abs(samples[(i + d + N) % N].curvature);
      if (curK > k) k = curK;
    }
    vCorner[i] = Math.min(MAX_SPEED, Math.sqrt(LATERAL_ACCEL / Math.max(k, 1e-6)));
  }

  // Backward pass so we brake in time
  vLimit = new Float64Array(vCorner);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = vLimit[(i + 1) % N];
      const maxAllowed = Math.sqrt(next * next + 2 * BRAKE_DECEL * ds);
      if (maxAllowed < vLimit[i]) {
        vLimit[i] = maxAllowed;
      }
    }
  }
}

export function step(t) {
  const i = Math.floor(t.s / ds) % N;

  // Pure pursuit: aim at a point on the centerline ahead of the car
  const lookahead = Math.min(40, 8 + 0.35 * t.speed);
  const target = samples[(i + Math.round(lookahead / ds)) % N];
  const dx = target.x - t.x;
  const dy = target.y - t.y;
  let alpha = Math.atan2(dy, dx) - t.yaw;
  while (alpha > Math.PI) alpha -= 2 * Math.PI;
  while (alpha < -Math.PI) alpha += 2 * Math.PI;

  const dist = Math.hypot(dx, dy);
  const steerAngle = Math.atan2(2 * wheelbase * Math.sin(alpha), dist);
  const steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

  // Speed: look a little ahead to account for actuator delay
  const vTarget = vLimit[(i + Math.round((t.speed * 0.3) / ds)) % N];
  const err = vTarget - t.speed;

  // Traction circle: restrict throttle under high lateral acceleration to prevent power oversteer
  const ayRatio = Math.min(1.0, Math.abs(t.ay) / (LATERAL_ACCEL * 0.95));
  const tractionAvailable = Math.max(0.0, 1.0 - ayRatio * ayRatio);

  const throttleCap = Math.min(1.0, Math.max(0.3, t.speed / 55.0)) * (1.0 - 0.5 * Math.abs(steer)) * tractionAvailable;
  const throttle = err > 0 ? Math.min(throttleCap, 0.2 + err * 0.4) : 0;
  const brake = err < -0.5 ? Math.min(1.0, -err * 0.25) : 0;

  return { throttle, brake, steer };
}
