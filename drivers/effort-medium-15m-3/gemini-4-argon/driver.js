// Candidate v4: Tuned minimum-curvature racing line + higher cornering/braking/exit performance

let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let lf = 1.98;
let lr = 1.62;

let rx, ry, rHeading, rCurv, rN, nMin, nMax, vLimit;

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;
  lf = (1 - car.weightFront) * wheelbase;
  lr = car.weightFront * wheelbase;

  // 1. Smooth centerline curvature
  const kc = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let d = -2; d <= 2; d++) sum += samples[(i + d + N) % N].curvature;
    kc[i] = sum / 5;
  }

  // 2. Minimum-curvature racing line in Frenet coordinates
  rN = new Float64Array(N);
  const kap = new Float64Array(N);
  nMin = new Float64Array(N);
  nMax = new Float64Array(N);
  const margin = 1.00;
  for (let i = 0; i < N; i++) {
    const wl = samples[i].widthLeft;
    const wr = samples[i].widthRight;
    nMin[i] = -Math.max(0.2, Math.min(wr * 0.82, wr - margin));
    nMax[i] = Math.max(0.2, Math.min(wl * 0.82, wl - margin));
  }

  const stages = [
    [16, 140],
    [8, 140],
    [4, 140],
    [2, 100],
    [1, 60],
  ];
  for (let sIdx = 0; sIdx < stages.length; sIdx++) {
    const k = stages[sIdx][0];
    const iters = stages[sIdx][1];
    const scale = 1 / ((k * ds) * (k * ds));
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        const im = (i - k + N) % N;
        const ip = (i + k) % N;
        kap[i] = kc[i] + (rN[im] - 2 * rN[i] + rN[ip]) * scale;
      }
      for (let i = 0; i < N; i++) {
        const im = (i - k + N) % N;
        const ip = (i + k) % N;
        const grad = (-2 * kap[i] + kap[im] + kap[ip]) / scale;
        let ni = rN[i] - 0.09 * grad;
        if (ni < nMin[i]) ni = nMin[i];
        else if (ni > nMax[i]) ni = nMax[i];
        rN[i] = ni;
      }
    }
  }

  // 3. Reconstruct 2D racing line positions, headings, and actual Euclidean curvatures
  rx = new Float64Array(N);
  ry = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const s = samples[i];
    const nx = -Math.sin(s.heading);
    const ny = Math.cos(s.heading);
    rx[i] = s.x + rN[i] * nx;
    ry[i] = s.y + rN[i] * ny;
  }

  rHeading = new Float64Array(N);
  rCurv = new Float64Array(N);
  const cStep = 3;
  for (let i = 0; i < N; i++) {
    const im1 = (i - 1 + N) % N;
    const ip1 = (i + 1) % N;
    rHeading[i] = Math.atan2(ry[ip1] - ry[im1], rx[ip1] - rx[im1]);

    const im = (i - cStep + N) % N;
    const ip = (i + cStep) % N;
    const dx1 = rx[i] - rx[im], dy1 = ry[i] - ry[im];
    const dx2 = rx[ip] - rx[i], dy2 = ry[ip] - ry[i];
    const l1 = Math.hypot(dx1, dy1), l2 = Math.hypot(dx2, dy2);
    const l3 = Math.hypot(rx[ip] - rx[im], ry[ip] - ry[im]);
    const cross = dx1 * dy2 - dy1 * dx2;
    rCurv[i] = (2 * cross) / (l1 * l2 * l3 + 1e-12);
  }

  // 4. Compute speed limit from racing line curvature + aero downforce
  const a0 = 17.4; // m/s^2 mechanical lateral grip
  const cAero = 0.0030; // 1/m downforce lateral grip factor
  const maxV = 98; // m/s

  vLimit = new Float64Array(N);
  const w = Math.max(1, Math.round(8.5 / ds));
  for (let i = 0; i < N; i++) {
    let kMax = 0;
    for (let d = -w; d <= w; d++) {
      const k = Math.abs(rCurv[(i + d + N) % N]);
      if (k > kMax) kMax = k;
    }
    const effK = Math.max(1e-6, kMax - cAero);
    vLimit[i] = Math.min(maxV, Math.sqrt(a0 / effK));
  }

  // 5. Backward pass for braking
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const ip = (i + 1) % N;
      const segLen = Math.hypot(rx[ip] - rx[i], ry[ip] - ry[i]);
      const vNext = vLimit[ip];
      const kHere = Math.max(Math.abs(rCurv[i]), Math.abs(rCurv[ip]));
      const maxAy = a0 + cAero * vNext * vNext;
      const ayReq = Math.min(maxAy, vNext * vNext * kHere);
      const gripFrac = Math.sqrt(Math.max(0.22, 1 - 0.80 * (ayReq / maxAy) ** 2));
      const aBrake = (15.5 + 0.0025 * vNext * vNext) * gripFrac;
      const vMaxHere = Math.sqrt(vNext * vNext + 2 * aBrake * segLen);
      if (vMaxHere < vLimit[i]) vLimit[i] = vMaxHere;
    }
  }
}

export function step(t) {
  const i = Math.min(N - 1, Math.max(0, Math.floor(t.s / ds)));

  // Smooth merge from centerline (n=0) onto racing line during first 1.5s of flying start
  const startBlend = Math.min(1, (t.lapTime + 0.15) / 1.5);

  const lookahead = Math.min(31, Math.max(7.2, 5.2 + 0.26 * t.speed));
  const lookSteps = Math.max(1, Math.round(lookahead / ds));
  const targetIdx = (i + lookSteps) % N;
  const sTarget = samples[targetIdx];

  let targetN = rN[targetIdx] * startBlend;

  // Track-edge guardian: if car is approaching white line, pull targetN inward
  const sHere = samples[i];
  const leftMargin = sHere.widthLeft - t.n;
  const rightMargin = sHere.widthRight + t.n;
  if (leftMargin < 1.15) {
    targetN = Math.min(targetN, sTarget.widthLeft - 1.45);
  } else if (rightMargin < 1.15) {
    targetN = Math.max(targetN, -(sTarget.widthRight - 1.45));
  }

  const nx = -Math.sin(sTarget.heading);
  const ny = Math.cos(sTarget.heading);
  const tx = sTarget.x + targetN * nx;
  const ty = sTarget.y + targetN * ny;

  const dx = tx - t.x;
  const dy = ty - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const dist = Math.hypot(dx, dy);
  let steerAngle = Math.atan2(2 * wheelbase * Math.sin(alpha), Math.max(1, dist));

  // Curvature feedforward for high-speed slip angle compensation
  const kLook = rCurv[(i + Math.max(1, Math.round(lookSteps * 0.35))) % N] * startBlend;
  steerAngle += 0.13 * wheelbase * kLook;

  // Rear slip angle stability control
  const vxSafe = Math.max(4, t.vx);
  const vyRear = t.vy - lr * t.yawRate;
  const rearSlip = Math.atan2(vyRear, vxSafe);
  if (Math.abs(rearSlip) > 0.015) {
    steerAngle += 0.45 * rearSlip;
  }

  const steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

  // Speed target with braking lookahead
  const brakeLook = Math.max(1, Math.round((t.speed * 0.26) / ds));
  let vTarget = vLimit[(i + brakeLook) % N];
  const vMid = vLimit[(i + Math.max(1, Math.round(brakeLook * 0.5))) % N];
  if (vMid < vTarget) vTarget = vMid;
  if (vLimit[i] < vTarget) vTarget = vLimit[i];
  const err = vTarget - t.speed;

  // Rear traction & lateral grip budget
  const absSteer = Math.max(Math.abs(steer), Math.abs(t.steer));
  const absAy = Math.abs(t.ay);
  const maxAy = 17.4 + 0.0030 * t.speed * t.speed;
  const ayFrac = Math.min(1, absAy / maxAy);
  const slipPenalty = Math.max(0, 1 - 12 * Math.max(0, Math.abs(rearSlip) - 0.02));
  const throttleCap =
    Math.min(1, Math.max(0.32, t.speed / 46)) *
    (1 - 0.46 * absSteer) *
    Math.sqrt(Math.max(0.06, 1 - 0.65 * ayFrac * ayFrac)) *
    slipPenalty;

  let throttle = 0;
  let brake = 0;
  if (err > -0.2) {
    throttle = err > 0 ? Math.min(throttleCap, 0.35 + err * 0.55) : Math.min(throttleCap, 0.18);
  } else if (err < -0.3) {
    const turnBrakePenalty = Math.max(0.15, 1 - 1.1 * absSteer);
    const slipBrakePenalty = Math.max(0, 1 - 18 * Math.max(0, Math.abs(rearSlip) - 0.018));
    const brakeCap = Math.min(0.88, Math.sqrt(Math.max(0.2, 1 - 0.65 * ayFrac * ayFrac)) * turnBrakePenalty * slipBrakePenalty);
    brake = Math.min(brakeCap, (-err - 0.25) * 0.32);
  }

  return { throttle, brake, steer };
}
