// Dev driver: racing line (min-curvature SOR), grip-model speed profile, anticipatory braking,
// pure pursuit + feedforward steering. Robust against exceptions.

let S = [];        // centerline samples
let N = 0;
let ds = 2;
let WB = 3.6;
let MAXSTEER = 0.35;
let MASS = 800;
let POWER = 740000;
let TRACKLEN = 1;

// Racing line arrays (fine grid, indexed like samples)
let PX, PY, PN, PK, PH, VLIM, PLEN;

// ---- Tunable grip model (hidden constants are inferred from practice) ----
const P = {
  aLat0: 16.0,     // m/s^2 lateral grip at zero speed
  aLatK: 0.0028,   // downforce term: aLat = aLat0 + aLatK * v^2
  latMargin: 0.92, // fraction of lateral capacity used by the plan
  brkFrac: 0.90,   // braking capacity as fraction of lateral capacity
  dragK: 0.00115,  // drag decel = dragK * v^2 (m/s^2)
  brkGain: 36,     // decel (m/s^2) per unit brake pedal (from telemetry)
  fCapAcc: 17,     // engine force cap at low speed, m/s^2 equivalent
  trac0: 9.5,      // rear traction accel budget at zero speed
  tracK: 0.0025,   // downforce term for traction
  vMax: 95,
  edgeMargin: 0.35, // keep racing line this far inside the white line
  laLook0: 4.0,    // pure pursuit lookahead base
  laLookV: 0.22,   // lookahead per m/s
  brakeLookM: 220, // braking anticipation horizon (m)
};

function aLat(v) { return P.aLat0 + P.aLatK * v * v; }
function aBrake(v) { return P.brkFrac * aLat(v) + P.dragK * v * v; }
function aTrac(v) { return P.trac0 + P.tracK * v * v; }

function wrapIdx(i) { i %= N; return i < 0 ? i + N : i; }

export function init(track, car) {
  S = track.samples;
  N = S.length;
  ds = track.sampleSpacing;
  TRACKLEN = track.length;
  WB = car.wheelbase;
  MAXSTEER = car.maxSteer;
  MASS = car.mass;
  POWER = car.maxPower;

  // --- Racing line on a coarse grid via SOR on sum of squared second differences ---
  const stride = Math.max(1, Math.round(4 / ds));
  const M = Math.max(8, Math.floor(N / stride));
  const cidx = new Array(M);
  for (let j = 0; j < M; j++) cidx[j] = Math.round((j * N) / M) % N;
  const cx = new Float64Array(M), cy = new Float64Array(M), nx = new Float64Array(M), ny = new Float64Array(M);
  const lo = new Float64Array(M), hi = new Float64Array(M);
  const cn = new Float64Array(M);
  for (let j = 0; j < M; j++) {
    const smp = S[cidx[j]];
    cx[j] = smp.x; cy[j] = smp.y;
    nx[j] = -Math.sin(smp.heading); ny[j] = Math.cos(smp.heading);
    // take the tightest width in the covered stretch
    let wl = smp.widthLeft, wr = smp.widthRight;
    for (let d = -stride; d <= stride; d++) {
      const q = S[wrapIdx(cidx[j] + d)];
      wl = Math.min(wl, q.widthLeft); wr = Math.min(wr, q.widthRight);
    }
    hi[j] = Math.max(0, wl - P.edgeMargin);
    lo[j] = -Math.max(0, wr - P.edgeMargin);
    cn[j] = 0;
  }
  const omega = 1.6;
  const sweeps = 6000;
  for (let it = 0; it < sweeps; it++) {
    let maxd = 0;
    for (let j = 0; j < M; j++) {
      const jm2 = (j - 2 + M) % M, jm1 = (j - 1 + M) % M, jp1 = (j + 1) % M, jp2 = (j + 2) % M;
      // positions with n_j = 0
      const pxm2 = cx[jm2] + cn[jm2] * nx[jm2], pym2 = cy[jm2] + cn[jm2] * ny[jm2];
      const pxm1 = cx[jm1] + cn[jm1] * nx[jm1], pym1 = cy[jm1] + cn[jm1] * ny[jm1];
      const px0 = cx[j], py0 = cy[j];
      const pxp1 = cx[jp1] + cn[jp1] * nx[jp1], pyp1 = cy[jp1] + cn[jp1] * ny[jp1];
      const pxp2 = cx[jp2] + cn[jp2] * nx[jp2], pyp2 = cy[jp2] + cn[jp2] * ny[jp2];
      // A1 = D_{j-1} at n=0 = P_j - 2P_{j-1} + P_{j-2}
      const a1x = px0 - 2 * pxm1 + pxm2, a1y = py0 - 2 * pym1 + pym2;
      const a2x = pxp1 - 2 * px0 + pxm1, a2y = pyp1 - 2 * py0 + pym1;
      const a3x = pxp2 - 2 * pxp1 + px0, a3y = pyp2 - 2 * pyp1 + py0;
      const d1 = a1x * nx[j] + a1y * ny[j];
      const d2 = a2x * nx[j] + a2y * ny[j];
      const d3 = a3x * nx[j] + a3y * ny[j];
      let nn = (4 * d2 - 2 * d1 - 2 * d3) / 12;
      nn = cn[j] + omega * (nn - cn[j]);
      if (nn > hi[j]) nn = hi[j];
      if (nn < lo[j]) nn = lo[j];
      const dd = Math.abs(nn - cn[j]);
      if (dd > maxd) maxd = dd;
      cn[j] = nn;
    }
    if (maxd < 3e-5) break;
  }

  // --- Interpolate to fine grid (Catmull-Rom on n), clamp, light smoothing ---
  PN = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const u = (i * M) / N;
    let j = Math.floor(u);
    const f = u - j;
    j = j % M;
    const n0 = cn[(j - 1 + M) % M], n1 = cn[j], n2 = cn[(j + 1) % M], n3 = cn[(j + 2) % M];
    const v = 0.5 * (2 * n1 + (-n0 + n2) * f + (2 * n0 - 5 * n1 + 4 * n2 - n3) * f * f + (-n0 + 3 * n1 - 3 * n2 + n3) * f * f * f);
    const smp = S[i];
    const h = Math.max(0, smp.widthLeft - P.edgeMargin), l = -Math.max(0, smp.widthRight - P.edgeMargin);
    PN[i] = Math.min(h, Math.max(l, v));
  }
  PX = new Float64Array(N); PY = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const smp = S[i];
    PX[i] = smp.x - Math.sin(smp.heading) * PN[i];
    PY[i] = smp.y + Math.cos(smp.heading) * PN[i];
  }
  // path heading, segment length, curvature (Menger, signed)
  PH = new Float64Array(N); PLEN = new Float64Array(N); PK = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const i1 = wrapIdx(i + 1);
    PLEN[i] = Math.hypot(PX[i1] - PX[i], PY[i1] - PY[i]);
    PH[i] = Math.atan2(PY[i1] - PY[i], PX[i1] - PX[i]);
  }
  const rawK = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const i0 = wrapIdx(i - 2), i2 = wrapIdx(i + 2);
    const ax = PX[i] - PX[i0], ay = PY[i] - PY[i0];
    const bx = PX[i2] - PX[i], by = PY[i2] - PY[i];
    const cx_ = PX[i2] - PX[i0], cy_ = PY[i2] - PY[i0];
    const cross = ax * by - ay * bx;
    const den = Math.hypot(ax, ay) * Math.hypot(bx, by) * Math.hypot(cx_, cy_);
    rawK[i] = den > 1e-9 ? (2 * cross) / den : 0;
  }
  // smooth curvature over +-2 samples
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let d = -2; d <= 2; d++) sum += rawK[wrapIdx(i + d)];
    PK[i] = sum / 5;
  }

  // --- Speed profile: corner limit then backward pass with friction ellipse ---
  VLIM = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    // use worst curvature within +-1 samples
    let k = 0;
    for (let d = -1; d <= 1; d++) k = Math.max(k, Math.abs(PK[wrapIdx(i + d)]));
    // solve v^2 k = latMargin * aLat(v) = m*(a0 + aK v^2) -> v^2 (k - m aK) = m a0
    const m = P.latMargin;
    const denom = k - m * P.aLatK;
    let v = P.vMax;
    if (denom > 1e-9) v = Math.min(P.vMax, Math.sqrt((m * P.aLat0) / denom));
    VLIM[i] = v;
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const i1 = wrapIdx(i + 1);
      const vn = VLIM[i1];
      const k = Math.abs(PK[i1]);
      const cap = aLat(vn);
      const used = (vn * vn * k) / cap;
      const frac = Math.sqrt(Math.max(0.05, 1 - used * used));
      const a = P.brkFrac * cap * frac + P.dragK * vn * vn;
      const vmax = Math.sqrt(vn * vn + 2 * a * PLEN[i]);
      if (vmax < VLIM[i]) VLIM[i] = vmax;
    }
  }
}

let lastCtl = { throttle: 0, brake: 0, steer: 0 };
let prevBrake = 0;

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

function stepInner(t) {
  const v = Math.max(0, t.speed);
  const i = wrapIdx(Math.round(t.s / ds));

  // ---------- Steering: pure pursuit on racing line + curvature feedforward ----------
  const look = P.laLook0 + P.laLookV * v;
  const li = wrapIdx(i + Math.round(look / ds));
  const dx = PX[li] - t.x, dy = PY[li] - t.y;
  let alpha = Math.atan2(dy, dx) - t.yaw;
  while (alpha > Math.PI) alpha -= 2 * Math.PI;
  while (alpha < -Math.PI) alpha += 2 * Math.PI;
  const dist = Math.max(1, Math.hypot(dx, dy));
  let steerAngle = Math.atan2(2 * WB * Math.sin(alpha), dist);
  // small feedforward from path curvature ahead (helps at speed where PP lags)
  const kff = PK[wrapIdx(i + Math.round((0.6 * look) / ds))];
  steerAngle = 0.75 * steerAngle + 0.25 * Math.atan(WB * kff) + 0.0 * 0;
  const steer = clamp(steerAngle / MAXSTEER, -1, 1);

  // ---------- Longitudinal: required decel over horizon ----------
  let aReq = 0;
  let distAcc = 0;
  const v2 = v * v;
  const horizon = Math.min(N - 2, Math.round(P.brakeLookM / ds));
  for (let d = 1; d <= horizon; d++) {
    const j = wrapIdx(i + d);
    distAcc += PLEN[wrapIdx(j - 1)];
    const vl = VLIM[j];
    if (vl < v) {
      const a = (v2 - vl * vl) / (2 * Math.max(distAcc - 0.0, 1));
      if (a > aReq) aReq = a;
    }
  }
  const vNow = VLIM[i];
  const drag = P.dragK * v * v;
  const ayAbs = Math.abs(t.ay);
  const capLat = aLat(v);
  const fracLat = clamp(ayAbs / capLat, 0, 0.98);
  const ellipse = Math.sqrt(1 - fracLat * fracLat);
  const aPlan = P.brkFrac * capLat * ellipse + drag; // what the plan assumes is available
  let throttle = 0, brake = 0;
  if (aReq > 0.55 * aPlan || v > vNow + 0.8) {
    // pedal for the demanded decel (drag helps), capped by estimated grip to avoid lock-up
    let ped = ((aReq - drag) / P.brkGain) * 1.1 + 0.02;
    if (v > vNow + 0.8) ped = Math.max(ped, (0.4 * (v - vNow) + (0.5 * capLat - drag) / P.brkGain) * 0.5);
    const pedMax = Math.max(0.05, (1.05 * capLat * ellipse) / P.brkGain);
    brake = clamp(ped, 0, pedMax);
    throttle = 0;
  } else {
    // throttle: traction/power limited, friction ellipse with measured ay
    const aLongAvail = aTrac(v) * ellipse;
    const fEng = Math.min(POWER / (MASS * Math.max(v, 1)), P.fCapAcc); // accel at full throttle
    let tcap = aLongAvail / fEng;
    tcap = clamp(tcap, 0.25, 1);
    if (v < vNow - 1.0) throttle = tcap;
    else throttle = clamp(tcap * (0.5 + 0.3 * (vNow - v)), 0, tcap); // hold speed near limit
    if (aReq > 0.4 * aPlan) throttle = Math.min(throttle, 0.2); // ease off before braking zone
  }
  return { throttle, brake, steer };
}

export function step(t) {
  try {
    const c = stepInner(t);
    if (!(Number.isFinite(c.throttle) && Number.isFinite(c.brake) && Number.isFinite(c.steer))) throw new Error("nan");
    lastCtl = c;
    return c;
  } catch (e) {
    return { throttle: 0, brake: 0.5, steer: lastCtl.steer || 0 };
  }
}

// debug export for offline harness
export function _debug() { return { PN, PK, VLIM, PX, PY, N, ds }; }
