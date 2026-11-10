// driver_v2.js: Improved biharmonic racing line with Frenet denominator, 2D coordinate polish,
// 10m-chord curvature estimation, drag-compensated throttle feedforward, ABS, TC, and slip-angle limiter.

let samples = [];
let N = 0;
let ds = 2;
let trackLength = 0;
let wheelbase = 3.6;
let lf = 1.98;
let lr = 1.62;
let maxSteer = 0.35;

let xLine;
let yLine;
let nLine;
let kLine;
let dsLine;
let vLimit;

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

// Peak steady-state lateral acceleration (m/s^2) vs speed (m/s)
function ayPeak(v) {
  const v2 = v * v;
  return 16.25 + 0.00428 * v2 - 8.1e-8 * v2 * v2;
}

// Total 4-tire longitudinal grip (m/s^2) vs speed (m/s)
function axTirePeak(v) {
  const v2 = v * v;
  return 17.09 + 0.00451 * v2 - 8.5e-8 * v2 * v2;
}

// Aerodynamic drag + rolling resistance deceleration magnitude (m/s^2)
function aDrag(v) {
  return 0.14715 + 0.001075 * v * v;
}

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  trackLength = track.length;
  wheelbase = car.wheelbase;
  lf = wheelbase * (1 - car.weightFront);
  lr = wheelbase * car.weightFront;
  maxSteer = car.maxSteer;

  const nx = new Float64Array(N);
  const ny = new Float64Array(N);
  const nMin = new Float64Array(N);
  const nMax = new Float64Array(N);
  nLine = new Float64Array(N);
  const nNext = new Float64Array(N);
  const r = new Float64Array(N);

  // Stay 0.65 m inside the white line (1.65 m inside the off-track limit)
  const margin = 0.65;
  for (let i = 0; i < N; i++) {
    const s = samples[i];
    nx[i] = -Math.sin(s.heading);
    ny[i] = Math.cos(s.heading);
    nMin[i] = -Math.max(0, s.widthRight - margin);
    nMax[i] = Math.max(0, s.widthLeft - margin);
  }

  // Multi-scale biharmonic curvature minimization with exact Frenet denominator
  const strides = [12, 6, 3, 1];
  for (let si = 0; si < strides.length; si++) {
    const k = strides[si];
    const L2 = (k * ds) * (k * ds);
    const iters = k === 12 ? 140 : k === 6 ? 120 : k === 3 ? 100 : 80;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        const im = (i - k + N) % N;
        const ip = (i + k) % N;
        const denom = Math.max(0.7, 1 - nLine[i] * samples[i].curvature);
        r[i] = (samples[i].curvature + (nLine[im] - 2 * nLine[i] + nLine[ip]) / L2) / denom;
      }
      for (let i = 0; i < N; i++) {
        const im = (i - k + N) % N;
        const ip = (i + k) % N;
        const grad = (r[im] - 2 * r[i] + r[ip]) / L2;
        let v = nLine[i] - 0.055 * L2 * L2 * grad;
        if (v < nMin[i]) v = nMin[i];
        if (v > nMax[i]) v = nMax[i];
        nNext[i] = v;
      }
      nLine.set(nNext);
    }
  }

  // Light 3-pass smoothing on nLine
  for (let it = 0; it < 3; it++) {
    for (let i = 0; i < N; i++) {
      const v = 0.2 * nLine[(i - 1 + N) % N] + 0.6 * nLine[i] + 0.2 * nLine[(i + 1) % N];
      nNext[i] = Math.max(nMin[i], Math.min(nMax[i], v));
    }
    nLine.set(nNext);
  }

  // Compute world coordinates of the racing line and apply a light 2D polish
  xLine = new Float64Array(N);
  yLine = new Float64Array(N);
  const xTemp = new Float64Array(N);
  const yTemp = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    xLine[i] = samples[i].x + nLine[i] * nx[i];
    yLine[i] = samples[i].y + nLine[i] * ny[i];
  }

  for (let it = 0; it < 5; it++) {
    for (let i = 0; i < N; i++) {
      const im = (i - 1 + N) % N;
      const ip = (i + 1) % N;
      xTemp[i] = 0.2 * xLine[im] + 0.6 * xLine[i] + 0.2 * xLine[ip];
      yTemp[i] = 0.2 * yLine[im] + 0.6 * yLine[i] + 0.2 * yLine[ip];
    }
    xLine.set(xTemp);
    yLine.set(yTemp);
  }

  dsLine = new Float64Array(N);
  kLine = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    const ip = (i + 1) % N;
    dsLine[i] = Math.max(0.5, Math.hypot(xLine[ip] - xLine[i], yLine[ip] - yLine[i]));
  }

  // Use a ~5 m chord (10 m span) to compute clean racing line curvature
  const stepK = Math.max(2, Math.round(5 / ds));
  for (let i = 0; i < N; i++) {
    const im = (i - stepK + N) % N;
    const ip = (i + stepK) % N;
    const a1 = Math.atan2(yLine[i] - yLine[im], xLine[i] - xLine[im]);
    const a2 = Math.atan2(yLine[ip] - yLine[i], xLine[ip] - xLine[i]);
    const d1 = Math.hypot(xLine[i] - xLine[im], yLine[i] - yLine[im]);
    const d2 = Math.hypot(xLine[ip] - xLine[i], yLine[ip] - yLine[i]);
    kLine[i] = wrapAngle(a2 - a1) / Math.max(1.0, 0.5 * (d1 + d2));
  }

  // Cornering speed profile with a window [-2, +4] samples (~ -4 m to +8 m)
  const MAX_SPEED = 105;
  const LAT_UTIL = 0.87;
  const wBack = Math.max(1, Math.round(4 / ds));
  const wFwd = Math.max(1, Math.round(8 / ds));
  vLimit = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    let kMax = 1e-6;
    for (let d = -wBack; d <= wFwd; d++) {
      const idx = (i + d + N) % N;
      const kAbs = Math.abs(kLine[idx]);
      if (kAbs > kMax) kMax = kAbs;
    }
    let v = 40;
    for (let it = 0; it < 5; it++) {
      const ayAllow = LAT_UTIL * ayPeak(v);
      v = Math.min(MAX_SPEED, Math.sqrt(ayAllow / kMax));
    }
    vLimit[i] = v;
  }

  // Backward pass for braking with friction circle and speed-dependent downforce + drag
  const BRAKE_UTIL = 0.85;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const ip = (i + 1) % N;
      const vNext = vLimit[ip];
      const kNow = Math.max(Math.abs(kLine[i]), Math.abs(kLine[ip]));
      const ayReq = vNext * vNext * kNow;
      const uy = Math.min(0.92, ayReq / ayPeak(vNext));
      const longFactor = Math.sqrt(Math.max(0.05, 1 - uy * uy));
      const aDecel = BRAKE_UTIL * 0.96 * axTirePeak(vNext) * longFactor + aDrag(vNext);
      const vMaxHere = Math.sqrt(vNext * vNext + 2 * aDecel * dsLine[i]);
      if (vMaxHere < vLimit[i]) vLimit[i] = vMaxHere;
    }
  }
}

function getLinePoint(sQuery, lapTime) {
  let sWrap = sQuery % trackLength;
  if (sWrap < 0) sWrap += trackLength;
  const f = sWrap / ds;
  const i0 = Math.floor(f) % N;
  const i1 = (i0 + 1) % N;
  const frac = f - Math.floor(f);

  const xL = xLine[i0] + frac * (xLine[i1] - xLine[i0]);
  const yL = yLine[i0] + frac * (yLine[i1] - yLine[i0]);

  if (lapTime < 1.5 && sQuery < 40) {
    const blend = Math.min(1, sQuery / 40);
    const s0 = samples[i0];
    const s1 = samples[i1];
    const xC = s0.x + frac * (s1.x - s0.x);
    const yC = s0.y + frac * (s1.y - s0.y);
    return {
      x: xC + blend * (xL - xC),
      y: yC + blend * (yL - yC),
    };
  }
  return { x: xL, y: yL };
}

function getVLimit(sQuery) {
  let sWrap = sQuery % trackLength;
  if (sWrap < 0) sWrap += trackLength;
  const f = sWrap / ds;
  const i0 = Math.floor(f) % N;
  const i1 = (i0 + 1) % N;
  const frac = f - Math.floor(f);
  return vLimit[i0] + frac * (vLimit[i1] - vLimit[i0]);
}

export function step(t) {
  const i0 = Math.floor(t.s / ds) % N;
  const v = t.speed;

  // Dual-lookahead pure pursuit on the smoothed 2D racing line, with sideslip compensation
  const L1 = Math.max(5.5, Math.min(18, 3.5 + 0.16 * v));
  const L2 = Math.max(10.0, Math.min(30, 6.5 + 0.28 * v));
  const p1 = getLinePoint(t.s + L1, t.lapTime);
  const p2 = getLinePoint(t.s + L2, t.lapTime);

  const beta = v > 5 ? Math.atan2(t.vy, Math.max(t.vx, 3)) : 0;
  const effYaw = t.yaw + 0.55 * beta;

  const dx1 = p1.x - t.x, dy1 = p1.y - t.y;
  const alpha1 = wrapAngle(Math.atan2(dy1, dx1) - effYaw);
  const delta1 = Math.atan2(2 * wheelbase * Math.sin(alpha1), Math.max(1, Math.hypot(dx1, dy1)));

  const dx2 = p2.x - t.x, dy2 = p2.y - t.y;
  const alpha2 = wrapAngle(Math.atan2(dy2, dx2) - effYaw);
  const delta2 = Math.atan2(2 * wheelbase * Math.sin(alpha2), Math.max(1, Math.hypot(dx2, dy2)));

  let deltaCmd = 0.65 * delta1 + 0.35 * delta2;

  // Track edge safety guard: if within 0.65 m of white line, add corrective steering inward
  const samp = samples[i0];
  const distLeft = samp.widthLeft - t.n;
  const distRight = samp.widthRight + t.n;
  if (distLeft < 0.65) {
    deltaCmd -= 0.14 * (0.65 - distLeft);
  } else if (distRight < 0.65) {
    deltaCmd += 0.14 * (0.65 - distRight);
  }

  // Front slip-angle peak limiter: prevent understeer stall past peak slip angle (~4.7 deg = 0.082 rad)
  if (v > 6) {
    const betaF = Math.atan2(t.vy + lf * t.yawRate, Math.max(t.vx, 3));
    const maxAlphaF = 0.082;
    if (deltaCmd > betaF + maxAlphaF) deltaCmd = betaF + maxAlphaF;
    if (deltaCmd < betaF - maxAlphaF) deltaCmd = betaF - maxAlphaF;
  }

  const steer = Math.max(-1, Math.min(1, deltaCmd / maxSteer));

  // Target speed: minimum over current position and braking lookahead (0.16 s ahead), smoothly interpolated
  let vTarget = getVLimit(t.s);
  const lookDist = Math.max(2.0, v * 0.16);
  for (let d = 2.0; d <= lookDist + 0.5; d += 2.0) {
    const vd = getVLimit(t.s + Math.min(d, lookDist));
    if (vd < vTarget) vTarget = vd;
  }

  const err = vTarget - v;
  let throttle = 0;
  let brake = 0;

  const v2 = v * v;
  const ayMaxNow = ayPeak(v);
  const FengineMax = Math.min(14000, 740000 / Math.max(v, 10));
  const Fdrag = 800 * aDrag(v);
  const thHold = Math.min(1.0, Fdrag / FengineMax);

  if (err < -0.25) {
    // Braking with Anti-Lock Braking System (ABS)
    const uy = Math.min(0.94, Math.abs(t.ay) / ayMaxNow);
    const absLimit =
      0.95 *
      (0.386 + 0.000102 * v2 - 1.9e-9 * v2 * v2) *
      Math.sqrt(Math.max(0.08, 1 - uy * uy));
    const rawBrake = Math.min(1.0, (-err) * 0.42);
    brake = Math.min(absLimit, rawBrake);
  } else {
    // Acceleration with Traction Control (TC) and drag feedforward
    const curDelta = Math.abs(steer * maxSteer);
    const ayPred = Math.max(Math.abs(t.ay), 0.85 * v2 * (curDelta / wheelbase));
    const uyRear = Math.min(0.95, ayPred / ayMaxNow);
    const FxrMax = 8655 + 2.305 * v2 - 0.000054 * v2 * v2;
    let FxrAvail = 0.95 * FxrMax * Math.sqrt(Math.max(0.05, 1 - uyRear * uyRear));

    if (v > 6) {
      const ar = Math.abs(Math.atan2(t.vy - lr * t.yawRate, Math.max(t.vx, 3)));
      if (ar > 0.049) {
        FxrAvail *= Math.max(0.1, 1 - (ar - 0.049) * 18);
      }
    }

    const tcLimit = Math.min(1.0, FxrAvail / FengineMax);
    const rawThrottle = Math.max(0, Math.min(1.0, thHold + err * 0.85));
    throttle = Math.min(tcLimit, rawThrottle);
  }

  return { throttle, brake, steer };
}
