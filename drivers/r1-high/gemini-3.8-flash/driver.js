// Advanced driver: racing line optimization, aero-aware speed profiling,
// friction-circle throttle management, and yaw stability control.

let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;

let X_line = null;
let Y_line = null;
let vLimit = null;

const A_LAT_0 = 16.8; // Base mechanical grip (m/s^2)
const C_AERO = 0.0022; // Aero downforce factor
const A_BRAKE = 16.0; // Braking deceleration limit (m/s^2)
const MAX_SPEED = 85.0; // Top speed limit (m/s)
const MARGIN = 1.4; // Safety margin from track edge (m)

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  // 1. Centerline normals
  const ux = new Float64Array(N);
  const uy = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const prev = samples[(i - 1 + N) % N];
    const next = samples[(i + 1) % N];
    const th = Math.atan2(next.y - prev.y, next.x - prev.x);
    ux[i] = -Math.sin(th);
    uy[i] = Math.cos(th);
  }

  // 2. Second difference of centerline
  const Dx = new Float64Array(N);
  const Dy = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const prev = samples[(i - 1 + N) % N];
    const curr = samples[i];
    const next = samples[(i + 1) % N];
    Dx[i] = next.x - 2 * curr.x + prev.x;
    Dy[i] = next.y - 2 * curr.y + prev.y;
  }

  // 3. Track limits with safety margin
  const nMin = new Float64Array(N);
  const nMax = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    nMin[i] = -samples[i].widthRight + MARGIN;
    nMax[i] = samples[i].widthLeft - MARGIN;
    if (nMin[i] > nMax[i]) {
      nMin[i] = 0;
      nMax[i] = 0;
    }
    // Pin racing line to 0 near the start/finish line for smooth flying start
    const distToLine = Math.min(samples[i].s, track.length - samples[i].s);
    if (distToLine < 20) {
      const blend = distToLine / 20;
      nMin[i] *= blend;
      nMax[i] *= blend;
    }
  }

  // 4. Projected gradient descent with momentum for racing line
  const n = new Float64Array(N);
  const v = new Float64Array(N);
  const gamma = 0.85;
  const lr = 0.06;

  const Ax = new Float64Array(N);
  const Ay = new Float64Array(N);

  const ITERS = 200;
  for (let it = 0; it < ITERS; it++) {
    for (let i = 0; i < N; i++) {
      const prev = (i - 1 + N) % N;
      const next = (i + 1) % N;
      Ax[i] = Dx[i] + n[next] * ux[next] - 2 * n[i] * ux[i] + n[prev] * ux[prev];
      Ay[i] = Dy[i] + n[next] * uy[next] - 2 * n[i] * uy[i] + n[prev] * uy[prev];
    }
    for (let i = 0; i < N; i++) {
      const prev = (i - 1 + N) % N;
      const next = (i + 1) % N;
      const gx = Ax[prev] - 2 * Ax[i] + Ax[next];
      const gy = Ay[prev] - 2 * Ay[i] + Ay[next];
      const grad = 2 * (ux[i] * gx + uy[i] * gy);
      v[i] = gamma * v[i] + lr * grad;
      let val = n[i] - v[i];
      if (val < nMin[i]) val = nMin[i];
      else if (val > nMax[i]) val = nMax[i];
      n[i] = val;
    }
  }

  // 5. Racing line world coordinates
  X_line = new Float64Array(N);
  Y_line = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    X_line[i] = samples[i].x + n[i] * ux[i];
    Y_line[i] = samples[i].y + n[i] * uy[i];
  }

  // 6. Curvature of the racing line
  const kLine = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const prev = (i - 1 + N) % N;
    const next = (i + 1) % N;
    const dx1 = X_line[i] - X_line[prev];
    const dy1 = Y_line[i] - Y_line[prev];
    const dx2 = X_line[next] - X_line[i];
    const dy2 = Y_line[next] - Y_line[i];
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    const th1 = Math.atan2(dy1, dx1);
    const th2 = Math.atan2(dy2, dx2);
    const dth = wrapAngle(th2 - th1);
    const dsSeg = 0.5 * (len1 + len2);
    kLine[i] = Math.abs(dth) / Math.max(dsSeg, 1e-3);
  }

  // 7. Corner speed from worst curvature within +- 10 m
  const w = Math.max(1, Math.round(10 / ds));
  const vCorner = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) {
      const idx = (i + d + N) % N;
      if (kLine[idx] > k) k = kLine[idx];
    }
    const effCurv = Math.max(0, k - C_AERO);
    if (effCurv > 1e-5) {
      vCorner[i] = Math.min(MAX_SPEED, Math.sqrt(A_LAT_0 / effCurv));
    } else {
      vCorner[i] = MAX_SPEED;
    }
  }

  // 8. Backward pass for braking deceleration
  vLimit = new Float64Array(N);
  for (let i = 0; i < N; i++) vLimit[i] = vCorner[i];

  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = (i + 1) % N;
      const vNext = vLimit[next];
      const maxEntry = Math.sqrt(vNext * vNext + 2 * A_BRAKE * ds);
      if (maxEntry < vLimit[i]) {
        vLimit[i] = maxEntry;
      }
    }
  }
}

export function step(t) {
  const i = Math.floor(t.s / ds) % N;

  // Steering: pure pursuit on optimized racing line + yaw damping
  const lookahead = Math.min(32, 6.0 + 0.30 * t.speed);
  const targetIdx = (i + Math.round(lookahead / ds)) % N;
  const dx = X_line[targetIdx] - t.x;
  const dy = Y_line[targetIdx] - t.y;
  const alpha = wrapAngle(Math.atan2(dy, dx) - t.yaw);
  const dist = Math.hypot(dx, dy);
  let steerAngle = Math.atan2(2 * wheelbase * Math.sin(alpha), dist);

  // Yaw stability damping (counteracts oversteer and spin tendencies)
  steerAngle -= 0.04 * t.yawRate;

  const steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

  // Speed planning lookup
  const speedIdx = (i + Math.round((t.speed * 0.25) / ds)) % N;
  const vTarget = vLimit[speedIdx];
  const err = vTarget - t.speed;

  // Traction Control & Longitudinal Management
  // Rear traction cap scales progressively with speed
  const tractionCap = Math.min(1.0, 0.18 + 0.011 * t.speed);
  // Friction circle: reduce available throttle when turning
  const steerPenalty = Math.max(0.1, 1.0 - 0.75 * Math.abs(steer));
  let throttleCap = tractionCap * steerPenalty;

  // Stability control: if rear is sliding (lateral velocity high), cut throttle
  if (Math.abs(t.vy) > 0.8) {
    throttleCap = 0;
  }

  const throttle = err > 0 ? Math.min(throttleCap, 0.15 + err * 0.35) : 0;
  const brake = err < -0.5 ? Math.min(Math.max(0.2, 1.0 - 0.4 * Math.abs(steer)), -err * 0.25) : 0;

  return { throttle, brake, steer };
}
