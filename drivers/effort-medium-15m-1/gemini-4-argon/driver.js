// High-performance racing driver v3:
// 1. Deep multi-scale biharmonic minimum-curvature racing line optimizer
// 2. Aero-aware cornering speed model + friction-circle backward braking profile
// 3. Dual-lookahead + Stanley path tracker with slip-angle feedforward, yaw damping, ABS, and TC

let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let lf = 1.98;
let lr = 1.62;

let cx, cy, nx, ny, wLeft, wRight, kCenter;
let nLine, px, py, kLine, dsLine, vLimit;

const EDGE_MARGIN = 0.22;  // m inside white line (1.22 m from off-track limit)
const LAT_SAFETY = 0.965;  // fraction of steady-state lateral limit (16.78 + 0.0040*v^2)
const BRAKE_SAFETY = 0.94; // fraction of braking limit (16.5 + 0.0050*v^2)
const MAX_SPEED = 98;      // m/s

export function init(track, car) {
  const samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;
  lf = (1 - car.weightFront) * wheelbase;
  lr = car.weightFront * wheelbase;

  cx = new Float64Array(N);
  cy = new Float64Array(N);
  nx = new Float64Array(N);
  ny = new Float64Array(N);
  wLeft = new Float64Array(N);
  wRight = new Float64Array(N);
  kCenter = new Float64Array(N);
  const minN = new Float64Array(N);
  const maxN = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    const s = samples[i];
    cx[i] = s.x;
    cy[i] = s.y;
    nx[i] = -Math.sin(s.heading);
    ny[i] = Math.cos(s.heading);
    wLeft[i] = s.widthLeft;
    wRight[i] = s.widthRight;
    minN[i] = -Math.max(0.2, s.widthRight - EDGE_MARGIN);
    maxN[i] = Math.max(0.2, s.widthLeft - EDGE_MARGIN);

    let kc = 0;
    for (let d = -2; d <= 2; d++) kc += samples[(i + d + N) % N].curvature;
    kCenter[i] = kc * 0.2;
  }

  // Multi-scale biharmonic minimum-curvature racing line optimization
  nLine = new Float64Array(N);
  const nNext = new Float64Array(N);
  const kp = new Float64Array(N);
  const stages = [
    [200, 10],
    [200, 6],
    [160, 4],
    [100, 2]
  ];

  for (let sIdx = 0; sIdx < stages.length; sIdx++) {
    const iters = stages[sIdx][0];
    const h = stages[sIdx][1];
    const hds2 = (h * ds) * (h * ds);
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        const im = (i - h + N) % N;
        const ip = (i + h) % N;
        const denom = Math.max(0.36, 1 - kCenter[i] * nLine[i]);
        kp[i] = kCenter[i] / denom + (nLine[im] - 2 * nLine[i] + nLine[ip]) / hds2;
      }
      for (let i = 0; i < N; i++) {
        const im = (i - h + N) % N;
        const ip = (i + h) % N;
        const grad = kp[i] - 0.5 * (kp[im] + kp[ip]);
        let val = nLine[i] + 0.24 * hds2 * grad;
        if (val < minN[i]) val = minN[i];
        if (val > maxN[i]) val = maxN[i];
        nNext[i] = val;
      }
      for (let i = 0; i < N; i++) {
        let val = 0.82 * nNext[i] + 0.09 * (nNext[(i - 1 + N) % N] + nNext[(i + 1) % N]);
        if (val < minN[i]) val = minN[i];
        if (val > maxN[i]) val = maxN[i];
        nLine[i] = val;
      }
    }
  }

  // Compute 2D racing line coordinates, segment lengths, and effective curvature
  px = new Float64Array(N);
  py = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    px[i] = cx[i] + nLine[i] * nx[i];
    py[i] = cy[i] + nLine[i] * ny[i];
  }

  dsLine = new Float64Array(N);
  kLine = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const ip1 = (i + 1) % N;
    dsLine[i] = Math.max(0.5, Math.hypot(px[ip1] - px[i], py[ip1] - py[i]));

    // Curvature over +-6m chord (stride 3)
    const im = (i - 3 + N) % N;
    const ip = (i + 3) % N;
    const dx1 = px[i] - px[im], dy1 = py[i] - py[im];
    const dx2 = px[ip] - px[i], dy2 = py[ip] - py[i];
    const l1 = Math.hypot(dx1, dy1);
    const l2 = Math.hypot(dx2, dy2);
    const l3 = Math.hypot(px[ip] - px[im], py[ip] - py[im]);
    kLine[i] = (2 * (dx1 * dy2 - dy1 * dx2)) / Math.max(l1 * l2 * l3, 1e-6);
  }

  // Cornering speed limit from effective curvature around each point
  vLimit = new Float64Array(N);
  const ay0 = 16.78 * LAT_SAFETY;
  const cyAero = 0.0040 * LAT_SAFETY;
  for (let i = 0; i < N; i++) {
    let kEff = 0;
    for (let d = -1; d <= 2; d++) {
      const kd = Math.abs(kLine[(i + d + N) % N]);
      if (kd > kEff) kEff = kd;
    }
    const denom = Math.max(kEff - cyAero, 1e-5);
    vLimit[i] = Math.min(MAX_SPEED, Math.sqrt(ay0 / denom));
  }

  // Backward braking pass (3 loops for wrap-around) using friction-circle combined braking + aero drag
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const ip = (i + 1) % N;
      const vNext = vLimit[ip];
      const vNext2 = vNext * vNext;
      const kReq = Math.max(Math.abs(kLine[i]), Math.abs(kLine[ip]));
      const ayReq = vNext2 * kReq;
      const ayMax = 16.78 + 0.0040 * vNext2;
      const uy = Math.min(0.90, ayReq / ayMax);
      const tireDecel = BRAKE_SAFETY * (16.5 + 0.0039 * vNext2) * Math.sqrt(Math.max(0.06, 1 - uy * uy));
      const dragDecel = 0.12 + 0.00108 * vNext2;
      const maxV = Math.sqrt(vNext2 + 2 * (tireDecel + dragDecel) * dsLine[i]);
      if (maxV < vLimit[i]) vLimit[i] = maxV;
    }
  }
}

function getLinePoint(idx, s, lapTime) {
  const w = ((idx % N) + N) % N;
  if (lapTime < 2.5 && s < 70) {
    const b = Math.min(1, Math.max(0, s / 50));
    const nBlend = nLine[w] * b;
    return { x: cx[w] + nBlend * nx[w], y: cy[w] + nBlend * ny[w], n: nBlend };
  }
  return { x: px[w], y: py[w], n: nLine[w] };
}

export function step(t) {
  const v = Math.max(0, t.speed);
  const v2 = v * v;
  const i = Math.floor(t.s / ds) % N;

  // Dual-lookahead path tracking + cross-track correction on the racing line
  const L1 = Math.min(20, Math.max(4.4, 3.0 + 0.14 * v));
  const L2 = Math.min(34, Math.max(8.0, 5.4 + 0.24 * v));
  const p0 = getLinePoint(i, t.s, t.lapTime);
  const p1 = getLinePoint(i + Math.round(L1 / ds), t.s, t.lapTime);
  const p2 = getLinePoint(i + Math.round(L2 / ds), t.s, t.lapTime);

  const a1 = Math.atan2(p1.y - t.y, p1.x - t.x) - t.yaw;
  const d1 = Math.max(1, Math.hypot(p1.x - t.x, p1.y - t.y));
  const k1 = (2 * Math.sin(a1)) / d1;

  const a2 = Math.atan2(p2.y - t.y, p2.x - t.x) - t.yaw;
  const d2 = Math.max(1, Math.hypot(p2.x - t.x, p2.y - t.y));
  const k2 = (2 * Math.sin(a2)) / d2;

  const kCmd = 0.76 * k1 + 0.24 * k2;

  // Understeer slip-angle feedforward + Stanley cross-track + sideslip/yaw-rate damping
  const vxSafe = Math.max(v, 4);
  const beta = Math.atan2(t.vy, vxSafe);
  const betaFront = Math.atan2(t.vy + lf * t.yawRate, vxSafe);
  const betaRear = Math.atan2(t.vy - lr * t.yawRate, vxSafe);
  const crossErr = p0.n - t.n;

  let steerAngle =
    Math.atan(wheelbase * kCmd) +
    0.00125 * v2 * kCmd +
    0.25 * Math.atan2(crossErr, Math.max(v, 8)) -
    0.35 * beta -
    0.08 * (t.yawRate - v * kCmd);

  // Track-limits safety guard: prevent ever approaching width + 1.0
  const nPred = t.n + 0.22 * v * Math.sin(t.headingError + beta);
  const maxSafeLeft = wLeft[i] - 0.05;
  const maxSafeRight = -(wRight[i] - 0.05);
  if (nPred > maxSafeLeft) {
    steerAngle -= 0.24 * (nPred - maxSafeLeft);
  } else if (nPred < maxSafeRight) {
    steerAngle += 0.24 * (maxSafeRight - nPred);
  }

  // Front slip-angle limiter: prevent steering beyond front tire peak (~6.5 deg = 0.114 rad)
  if (v > 10) {
    const maxAlphaF = 0.114;
    if (steerAngle > betaFront + maxAlphaF) steerAngle = betaFront + maxAlphaF;
    if (steerAngle < betaFront - maxAlphaF) steerAngle = betaFront - maxAlphaF;
  }

  const steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

  // Speed target: take min over [s, s + 0.13*v] so we brake early for actuator lag AND hold apex speed until the apex
  const lookSteps = Math.max(1, Math.round((0.13 * v) / ds));
  let vTarget = vLimit[i];
  for (let d = 1; d <= lookSteps; d++) {
    const vd = vLimit[(i + d) % N];
    if (vd < vTarget) vTarget = vd;
  }

  const err = vTarget - v;
  const ayMax = 16.78 + 0.0040 * v2;
  const ayCurr = Math.max(Math.abs(t.ay), 0.72 * v2 * Math.abs(kCmd));
  const uy = Math.min(0.95, ayCurr / ayMax);

  let throttle = 0;
  let brake = 0;

  if (err < -0.12) {
    // Braking with ABS + friction circle trail-braking
    const decelReq = 6.5 + 8.0 * (-err);
    const dragDecel = 0.12 + 0.00108 * v2;
    const brakeCmd = Math.max(0, decelReq - dragDecel) / 42.5;
    const brakeLock = 0.388 + 0.000091 * v2;
    const brakeMax = 0.98 * brakeLock * Math.sqrt(Math.max(0.1, 1 - 0.70 * uy * uy));
    brake = Math.min(1, Math.min(brakeCmd, brakeMax));
  } else {
    // Acceleration / apex maintenance with Traction Control + rear friction circle + oversteer cut
    const engineMax = Math.min(17.5, 925 / Math.max(v, 5));
    const thSpin = Math.min(1.0, (10.90 + 0.00254 * v2) / engineMax);
    let thMax = 0.99 * thSpin * Math.sqrt(Math.max(0.14, 1 - 0.78 * uy * uy));
    const alphaRear = Math.abs(betaRear);
    if (alphaRear > 0.055) {
      thMax *= Math.max(0.1, 1 - 12 * (alphaRear - 0.055));
    }
    throttle = Math.min(thMax, Math.max(0, 0.40 + 1.60 * err));
  }

  return { throttle, brake, steer };
}
