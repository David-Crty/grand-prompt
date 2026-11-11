// Fast open-wheel race driver: Minimum-curvature racing line + friction-circle speed profile + slip-angle control

let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let Lf = 1.98;
let Lr = 1.62;
let maxSteer = 0.35;

let px = [];
let py = [];
let pHeading = [];
let pCurv = [];
let pDs = [];
let nOpt = [];
let vLimit = [];

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  Lr = car.weightFront * wheelbase;
  Lf = wheelbase - Lr;
  maxSteer = car.maxSteer;

  nOpt = new Float64Array(N);
  const wL = new Float64Array(N);
  const wR = new Float64Array(N);
  const kc = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const mL = Math.min(1.30, 0.25 * samples[i].widthLeft);
    const mR = Math.min(1.30, 0.25 * samples[i].widthRight);
    wL[i] = Math.max(0, samples[i].widthLeft - mL);
    wR[i] = Math.max(0, samples[i].widthRight - mR);
    kc[i] = samples[i].curvature;
  }

  const kap = new Float64Array(N);
  const strides = [16, 8, 4, 2, 1];
  for (let sIdx = 0; sIdx < strides.length; sIdx++) {
    const stride = strides[sIdx];
    const h = stride * ds;
    const h2 = h * h;
    const iters = stride >= 4 ? 140 : 90;
    for (let iter = 0; iter < iters; iter++) {
      for (let i = 0; i < N; i++) {
        const im = (i - stride + N) % N;
        const ip = (i + stride) % N;
        const denom = Math.max(0.45, 1 - kc[i] * nOpt[i]);
        kap[i] = (kc[i] + (nOpt[im] - 2 * nOpt[i] + nOpt[ip]) / h2) / denom;
      }
      for (let i = 0; i < N; i++) {
        const im = (i - stride + N) % N;
        const ip = (i + stride) % N;
        const grad = kap[im] - 2 * kap[i] + kap[ip] + kc[i] * kap[i] * kap[i] * h2;
        const lap = (nOpt[im] - 2 * nOpt[i] + nOpt[ip]) / h2;
        nOpt[i] = Math.max(-wR[i], Math.min(wL[i], nOpt[i] - 0.08 * h2 * (grad - 0.012 * lap)));
      }
    }
  }

  px = new Float64Array(N);
  py = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const s = samples[i];
    px[i] = s.x - Math.sin(s.heading) * nOpt[i];
    py[i] = s.y + Math.cos(s.heading) * nOpt[i];
  }

  pHeading = new Float64Array(N);
  pCurv = new Float64Array(N);
  pDs = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const ip1 = (i + 1) % N;
    pDs[i] = Math.hypot(px[ip1] - px[i], py[ip1] - py[i]);
    const im = (i - 2 + N) % N;
    const ip = (i + 2) % N;
    pHeading[i] = Math.atan2(py[ip] - py[im], px[ip] - px[im]);
    const dx1 = px[i] - px[im], dy1 = py[i] - py[im];
    const dx2 = px[ip] - px[i], dy2 = py[ip] - py[i];
    const cross = dx1 * dy2 - dy1 * dx2;
    const d1 = Math.hypot(dx1, dy1), d2 = Math.hypot(dx2, dy2), d3 = Math.hypot(px[ip] - px[im], py[ip] - py[im]);
    pCurv[i] = (d1 > 1e-3 && d2 > 1e-3 && d3 > 1e-3) ? (2 * cross / (d1 * d2 * d3)) : kc[i];
  }

  // Speed profile with speed-dependent downforce and worst curvature window
  const w = Math.max(1, Math.round(8 / ds));
  const kSmooth = new Float64Array(N);
  vLimit = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) {
      const kSample = Math.abs(pCurv[(i + d + N) % N]);
      if (kSample > k) k = kSample;
    }
    kSmooth[i] = k;
    const aLat0 = 15.2;
    const cAero = 0.0028;
    const effK = Math.max(1e-5, k - cAero);
    vLimit[i] = Math.min(95, Math.sqrt(aLat0 / effK));
  }

  // Friction-circle-aware backward pass for braking (accounts for trail-braking in curved entry zones)
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = vLimit[(i + 1) % N];
      const segDs = pDs[i];
      const aLatReq = next * next * kSmooth[i];
      const aLatCap = 16.5 + 0.0032 * next * next;
      const latRatio = Math.min(0.92, aLatReq / aLatCap);
      const brakeCircle = Math.sqrt(Math.max(0.12, 1 - latRatio * latRatio));
      const aBrakeMax = 15.5 + 0.0025 * next * next;
      const aBrake = aBrakeMax * brakeCircle;
      vLimit[i] = Math.min(vLimit[i], Math.sqrt(next * next + 2 * aBrake * segDs));
    }
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

export function step(t) {
  const idx = Math.floor(t.s / ds) % N;
  const curSample = samples[idx];

  // Lookahead point on the optimized racing line, with smooth merge when off-line
  const lookDist = Math.min(28, Math.max(6.5, 5.0 + 0.23 * t.speed));
  const lookSteps = Math.max(1, Math.round(lookDist / ds));
  const targetIdx = (idx + lookSteps) % N;

  const errN = nOpt[idx] - t.n;
  const maxMergeN = Math.min(Math.abs(errN), Math.max(0.7, (2.8 * lookDist * lookDist) / Math.max(64, t.speed * t.speed)));
  let targetN = nOpt[targetIdx] - errN + Math.sign(errN) * maxMergeN;
  targetN += Math.max(-1.2, Math.min(1.2, 0.35 * errN));

  const tSample = samples[targetIdx];
  const tx = tSample.x - Math.sin(tSample.heading) * targetN;
  const ty = tSample.y + Math.cos(tSample.heading) * targetN;

  const dx = tx - t.x;
  const dy = ty - t.y;
  const dist = Math.max(1, Math.hypot(dx, dy));

  const vx = Math.max(2, t.vx);
  const beta = Math.atan2(t.vy, vx);
  const clampedBeta = Math.max(-0.04, Math.min(0.04, beta));
  const thetaVf = Math.atan2(t.vy + Lf * t.yawRate, vx);
  const alphaR = -Math.atan2(t.vy - Lr * t.yawRate, vx);

  const alpha = wrapAngle(Math.atan2(dy, dx) - (t.yaw + 0.75 * clampedBeta));
  const kDes = (2 * Math.sin(alpha)) / dist;
  const ayDes = t.speed * t.speed * kDes;

  // Geometric steering + front slip angle feedforward + rear oversteer countersteer
  let steerAngle = Math.atan2(wheelbase * kDes, 1) + 0.0014 * ayDes;
  if (Math.abs(alphaR) > 0.042) {
    steerAngle -= 0.55 * (alphaR - Math.sign(alphaR) * 0.042);
  }

  // Edge safety guard
  if (t.n > curSample.widthLeft - 0.85) {
    steerAngle -= 0.07 * (t.n - (curSample.widthLeft - 0.85));
  } else if (t.n < -(curSample.widthRight - 0.85)) {
    steerAngle += 0.07 * (-(curSample.widthRight - 0.85) - t.n);
  }

  // Clamp front tire slip angle to prevent front lock/understeer
  if (t.speed > 5) {
    const maxAlphaF = 0.090;
    steerAngle = Math.max(thetaVf - maxAlphaF, Math.min(thetaVf + maxAlphaF, steerAngle));
  }
  const steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

  // Look ahead for speed target
  const vLookSteps = Math.max(1, Math.round((t.speed * 0.28) / ds));
  let vTarget = vLimit[(idx + vLookSteps) % N];
  for (let d = 0; d <= vLookSteps; d++) {
    if (vLimit[(idx + d) % N] < vTarget) vTarget = vLimit[(idx + d) % N];
  }

  const err = vTarget - t.speed;
  const latG = Math.max(Math.abs(t.ay), 0.85 * Math.abs(ayDes));
  const aLatMax = 16.5 + 0.0032 * t.speed * t.speed;
  const latFrac = Math.min(0.95, latG / aLatMax);
  const circleFactor = Math.sqrt(Math.max(0.06, 1 - latFrac * latFrac));
  const rearSlipPenalty = Math.max(0, 1 - 12 * Math.max(0, Math.abs(alphaR) - 0.032));
  const surfaceFactor = t.surface === "track" ? 1.0 : 0.30;

  const speedTraction = Math.min(1, Math.max(0.28, (t.speed + 5) / 50));
  const throttleCap = speedTraction * circleFactor * rearSlipPenalty * surfaceFactor;

  let throttle = 0;
  let brake = 0;
  if (err > 0) {
    throttle = Math.min(throttleCap, (0.2 + err * 0.45) * circleFactor * rearSlipPenalty * surfaceFactor);
  } else if (err < -0.25) {
    // Prevent rear unload spin during trail braking
    const trailBrakeGuard = Math.max(0.15, 1 - 0.55 * latFrac * latFrac) * rearSlipPenalty;
    const bCap = Math.max(0.18, circleFactor * trailBrakeGuard * surfaceFactor);
    brake = Math.min(bCap, -err * 0.30);
  }

  return { throttle, brake, steer };
}
