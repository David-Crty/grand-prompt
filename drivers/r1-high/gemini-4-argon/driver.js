// Physics-optimal Racing Line + Slip-Angle-Controlled Driver
let samples = [];
let N = 0;
let ds = 2;
let trackLength = 0;
let wheelbase = 3.6;
let maxSteer = 0.35;

let px = [];
let py = [];
let nLine = [];
let hLine = [];
let kLine = [];
let dsLine = [];
let vLimit = [];

const LAT_FACTOR = 0.84;
const BRAKE_FACTOR = 0.84;
const MAX_SPEED = 98;

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function getGrip(v) {
  const v2 = v * v;
  return 16.239 + 0.0042795 * v2 - 7.922e-8 * v2 * v2;
}

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  trackLength = track.length;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  const xc = new Float64Array(N);
  const yc = new Float64Array(N);
  const nx = new Float64Array(N);
  const ny = new Float64Array(N);
  const nLeft = new Float64Array(N);
  const nRight = new Float64Array(N);
  nLine = new Float64Array(N);
  px = new Float64Array(N);
  py = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    const s = samples[i];
    xc[i] = s.x;
    yc[i] = s.y;
    nx[i] = -Math.sin(s.heading);
    ny[i] = Math.cos(s.heading);
    // Keep a safe margin inside the white line (off-track is width + 1.0m)
    const marginL = Math.min(1.25, Math.max(0.85, 0.18 * s.widthLeft));
    const marginR = Math.min(1.25, Math.max(0.85, 0.18 * s.widthRight));
    nLeft[i] = Math.max(0, s.widthLeft - marginL);
    nRight[i] = Math.max(0, s.widthRight - marginR);
    nLine[i] = 0;
    px[i] = s.x;
    py[i] = s.y;
  }

  // Multi-stride elastic-band racing line optimization
  const schedules = [
    { stride: 12, passes: 45, alpha: 0.35 },
    { stride: 6, passes: 45, alpha: 0.35 },
    { stride: 3, passes: 40, alpha: 0.30 },
    { stride: 1, passes: 30, alpha: 0.25 },
  ];

  for (let sIdx = 0; sIdx < schedules.length; sIdx++) {
    const { stride, passes, alpha } = schedules[sIdx];
    for (let pass = 0; pass < passes; pass++) {
      for (let i = 0; i < N; i++) {
        const iPrev = (i - stride + N) % N;
        const iNext = (i + stride) % N;
        const mx = 0.5 * (px[iPrev] + px[iNext]) - xc[i];
        const my = 0.5 * (py[iPrev] + py[iNext]) - yc[i];
        const nTarget = mx * nx[i] + my * ny[i];
        let nNew = nLine[i] + alpha * (nTarget - nLine[i]);
        if (nNew > nLeft[i]) nNew = nLeft[i];
        if (nNew < -nRight[i]) nNew = -nRight[i];
        nLine[i] = nNew;
        px[i] = xc[i] + nNew * nx[i];
        py[i] = yc[i] + nNew * ny[i];
      }
    }
  }

  // Compute racing line geometry (dsLine, hLine, kLine)
  dsLine = new Float64Array(N);
  hLine = new Float64Array(N);
  const kRaw = new Float64Array(N);
  kLine = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    const iNext = (i + 1) % N;
    const iPrev = (i - 1 + N) % N;
    dsLine[i] = Math.max(0.5, Math.hypot(px[iNext] - px[i], py[iNext] - py[i]));
    hLine[i] = Math.atan2(py[iNext] - py[iPrev], px[iNext] - px[iPrev]);
  }

  for (let i = 0; i < N; i++) {
    const iNext = (i + 1) % N;
    const iPrev = (i - 1 + N) % N;
    const dh = wrapAngle(hLine[iNext] - hLine[iPrev]);
    kRaw[i] = dh / (dsLine[iPrev] + dsLine[i]);
  }

  // Smooth curvature over +-2 samples
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let d = -2; d <= 2; d++) sum += kRaw[(i + d + N) % N];
    kLine[i] = sum / 5;
  }

  // Corner speed profile from effective curvature over a small window
  const wBack = Math.max(1, Math.round(6 / ds));
  const wFwd = Math.max(1, Math.round(8 / ds));
  const vCorner = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    let kMax = 0;
    for (let d = -wBack; d <= wFwd; d++) {
      const kAbs = Math.abs(kLine[(i + d + N) % N]);
      if (kAbs > kMax) kMax = kAbs;
    }
    // Also account for rapid curvature transitions (chicanes)
    const dk = Math.abs(kLine[(i + 3) % N] - kLine[(i - 3 + N) % N]);
    const kEff = Math.max(kMax, 0.75 * kMax + 0.35 * dk, 1e-6);

    // Fixed-point iteration to solve kEff * v^2 = LAT_FACTOR * getGrip(v)
    let v = Math.min(MAX_SPEED, Math.sqrt((LAT_FACTOR * 18.0) / kEff));
    for (let iter = 0; iter < 4; iter++) {
      const ayMax = LAT_FACTOR * getGrip(v);
      v = Math.min(MAX_SPEED, Math.sqrt(ayMax / kEff));
    }
    vCorner[i] = v;
  }

  // Backward braking pass using friction circle + aero drag + racing line arc length
  vLimit = new Float64Array(vCorner);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const iNext = (i + 1) % N;
      const vNext = vLimit[iNext];
      const v2 = vNext * vNext;
      const aGrip = getGrip(vNext);
      const kHere = Math.max(Math.abs(kLine[i]), Math.abs(kLine[iNext]));
      const ayReq = kHere * v2;
      const uy = Math.min(0.92, ayReq / (LAT_FACTOR * aGrip));
      const aBrakeTire = BRAKE_FACTOR * aGrip * Math.sqrt(Math.max(0.12, 1 - uy * uy));
      const aDrag = 0.147 + 0.001075 * v2;
      const aTotal = aBrakeTire + aDrag;
      const vMaxHere = Math.sqrt(v2 + 2 * aTotal * dsLine[i]);
      if (vMaxHere < vLimit[i]) vLimit[i] = vMaxHere;
    }
  }
}

export function step(t) {
  const sNorm = ((t.s % trackLength) + trackLength) % trackLength;
  const fIdx = sNorm / ds;
  const i = Math.floor(fIdx) % N;
  const iNext = (i + 1) % N;
  const frac = fIdx - Math.floor(fIdx);

  const v = t.speed;
  const v2 = v * v;
  const vx = Math.sqrt(Math.max(4, v2 - t.vy * t.vy));

  // Real-time slip angles
  const alphaR = -Math.atan2(t.vy - 1.62 * t.yawRate, vx);

  // 1. Steering: Pure pursuit on the precomputed racing line + cross-track/heading feedback + slip damping
  const lookDist = Math.max(6.5, Math.min(26, 4.5 + 0.23 * v));
  const lookF = (fIdx + lookDist / ds) % N;
  const lookI = Math.floor(lookF) % N;
  const lookI2 = (lookI + 1) % N;
  const lookFrac = lookF - Math.floor(lookF);

  const blend = Math.min(1, Math.max(0, (t.t - 3.0) / 1.5));
  const cx = samples[lookI].x + lookFrac * (samples[lookI2].x - samples[lookI].x);
  const cy = samples[lookI].y + lookFrac * (samples[lookI2].y - samples[lookI].y);
  const rx = px[lookI] + lookFrac * (px[lookI2] - px[lookI]);
  const ry = py[lookI] + lookFrac * (py[lookI2] - py[lookI]);
  const tx = cx + blend * (rx - cx);
  const ty = cy + blend * (ry - cy);

  const dx = tx - t.x;
  const dy = ty - t.y;
  const alphaPP = wrapAngle(Math.atan2(dy, dx) - t.yaw);
  const distPP = Math.max(2.0, Math.hypot(dx, dy));
  let deltaCmd = Math.atan2(2 * wheelbase * Math.sin(alphaPP), distPP);

  // Local racing line tracking feedback
  const nTargetHere = blend * (nLine[i] + frac * (nLine[iNext] - nLine[i]));
  const nErr = t.n - nTargetHere;
  const hLineHere = hLine[i] + frac * wrapAngle(hLine[iNext] - hLine[i]);
  const hCenterHere = samples[i].heading + frac * wrapAngle(samples[iNext].heading - samples[i].heading);
  const hTargetHere = hCenterHere + blend * wrapAngle(hLineHere - hCenterHere);
  const hErr = wrapAngle(t.yaw - hTargetHere);

  deltaCmd += -0.02 * nErr - 0.12 * hErr;

  // Clamp road-wheel angle so front slip angle never exceeds peak grip (~4.5 deg = 0.078 rad)
  if (v > 8) {
    const deltaZeroSlip = Math.atan2(t.vy + 1.98 * t.yawRate, vx);
    const maxAlphaF = 0.085;
    deltaCmd = Math.max(deltaZeroSlip - maxAlphaF, Math.min(deltaZeroSlip + maxAlphaF, deltaCmd));
  }

  // Track-edge safety steering pull if getting close to white line
  const wLeft = samples[i].widthLeft;
  const wRight = samples[i].widthRight;
  const nDot = v * Math.sin(t.headingError) + t.vy * Math.cos(t.headingError);
  const nPred = t.n + 0.25 * nDot;
  if (nPred > wLeft - 0.35) {
    deltaCmd -= 0.08 * (nPred - (wLeft - 0.35));
  } else if (nPred < -(wRight - 0.35)) {
    deltaCmd -= 0.08 * (nPred + (wRight - 0.35));
  }

  const steer = Math.max(-1, Math.min(1, deltaCmd / maxSteer));

  // 2. Longitudinal control: look ahead slightly for actuator lag (~0.12s)
  const lagDist = Math.max(1.5, 0.12 * v);
  const lagF = (fIdx + lagDist / ds) % N;
  const lagI = Math.floor(lagF) % N;
  const lagI2 = (lagI + 1) % N;
  const lagFrac = lagF - Math.floor(lagF);
  const vTargetAhead = vLimit[lagI] + lagFrac * (vLimit[lagI2] - vLimit[lagI]);
  const vTargetHere = vLimit[i] + frac * (vLimit[iNext] - vLimit[i]);
  const vRef = Math.min(vTargetAhead, vTargetHere + 2.0);

  const vErr = vRef - v;
  const surfScale = t.surface === "track" ? 1.0 : t.surface === "kerb" ? 0.85 : 0.45;
  const aGrip = getGrip(v) * surfScale;
  const kCur = Math.abs(kLine[i]);
  const ayEst = Math.max(Math.abs(t.ay), Math.abs(v * t.yawRate), kCur * v2);

  let throttle = 0;
  let brake = 0;

  if (vErr >= -0.25) {
    // Throttle mode with physics-exact rear friction circle + slip limiter
    const axDes = 3.2 * vErr;
    const latFrac = Math.min(0.96, ayEst / (0.88 * aGrip));
    let maxDriveAx = 0.60 * aGrip * Math.sqrt(Math.max(0, 1 - latFrac * latFrac));

    // Cut drive torque if rear slip angle approaches peak (~2.3 deg = 0.040 rad)
    const absAr = Math.abs(alphaR);
    if (absAr > 0.035) {
      const slipScale = Math.max(0, 1 - (absAr - 0.035) / 0.025);
      maxDriveAx *= slipScale;
    }

    const unitDriveAx = Math.min(17.5, 925 / Math.max(8, v));
    const dragAx = 0.147 + 0.001075 * v2;
    const thReq = vErr > 1.5 ? 1.0 : Math.max(0, (axDes + dragAx) / unitDriveAx);
    const thCap = maxDriveAx / unitDriveAx;
    throttle = Math.max(0, Math.min(1, thReq, thCap));
  } else {
    // Braking mode with physics-exact front/total friction circle (ABS)
    const decelDes = -3.8 * vErr;
    const latFracB = Math.min(0.94, ayEst / (0.92 * aGrip));
    const maxTireBrake = 0.90 * aGrip * Math.sqrt(Math.max(0.1, 1 - latFracB * latFracB));
    const dragDecel = 0.147 + 0.001075 * v2;
    const brReq = Math.max(0, (decelDes - dragDecel) / 42.5);
    const brCap = maxTireBrake / 42.5;
    brake = Math.max(0, Math.min(1, brReq, brCap));
  }

  // Track-limits emergency speed check
  if ((nPred > wLeft - 0.25 || nPred < -(wRight - 0.25)) && v > 12) {
    throttle = 0;
    if (nPred > wLeft + 0.1 || nPred < -(wRight + 0.1)) {
      brake = Math.max(brake, 0.25);
    }
  }

  return { throttle, brake, steer };
}
