// Racing driver: min-curvature line (multigrid Gauss-Seidel) + grip-limited speed profile
// + feedforward/feedback path tracking.
const G = {
  A: 15.5, B: 0.0042, // lateral grip: A + B v^2
  Ab: 15.2, Bb: 0.0044, // braking tire decel (excl. drag)
  At: 8.5, Bt: 0.003, // traction accel limit
  margin: 0.65,
  plan: 0.92,
  planB: 0.94,
};
const DRAG0 = 0.8, DRAG2 = 0.00105, BRK = 40, FMAX = 18.5;

let N = 0, ds = 2, WB = 3.6, maxSteer = 0.35, PM = 925, trackLen = 1;
let nL, pk, ph, vP, seg, ok = false;
let samples = [];

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function aLatMax(v) { return G.A + G.B * v * v; }

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  trackLen = track.length || N * ds;
  WB = car.wheelbase;
  maxSteer = car.maxSteer;
  PM = car.maxPower / car.mass;
  try {
    build();
    ok = true;
  } catch (e) {
    ok = false;
  }
}

function build() {
  const S = samples;
  const cx = new Float64Array(N), cy = new Float64Array(N), nx = new Float64Array(N), ny = new Float64Array(N);
  const lo = new Float64Array(N), hi = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const p = S[i];
    cx[i] = p.x; cy[i] = p.y;
    nx[i] = -Math.sin(p.heading); ny[i] = Math.cos(p.heading);
    let h = p.widthLeft - G.margin, l = -(p.widthRight - G.margin);
    if (h < l) { h = l = 0.5 * (h + l); }
    hi[i] = h; lo[i] = l;
  }
  nL = new Float64Array(N);
  const strides = [16, 8, 4, 2, 1];
  const sweeps = [1500, 1200, 800, 500, 300];
  for (let lv = 0; lv < strides.length; lv++) {
    const st = strides[lv];
    const M = Math.max(8, Math.round(N / st));
    if (M > N) continue;
    const idx = new Int32Array(M);
    for (let k = 0; k < M; k++) idx[k] = Math.min(N - 1, Math.round((k * N) / M));
    const X = new Float64Array(M), Y = new Float64Array(M), nn = new Float64Array(M);
    for (let k = 0; k < M; k++) {
      const c = idx[k];
      nn[k] = nL[c]; X[k] = cx[c] + nn[k] * nx[c]; Y[k] = cy[c] + nn[k] * ny[c];
    }
    const ns = Math.max(40, Math.round(sweeps[lv] * Math.min(1, 2500 / N)));
    for (let it = 0; it < ns; it++) {
      for (let k = 0; k < M; k++) {
        const a = k >= 2 ? k - 2 : k - 2 + M, b = k >= 1 ? k - 1 : k - 1 + M;
        const d = k + 1 < M ? k + 1 : k + 1 - M, e = k + 2 < M ? k + 2 : k + 2 - M;
        const c = idx[k];
        const tx = (4 * (X[b] + X[d]) - X[a] - X[e]) / 6 - cx[c];
        const ty = (4 * (Y[b] + Y[d]) - Y[a] - Y[e]) / 6 - cy[c];
        let v = tx * nx[c] + ty * ny[c];
        v = nn[k] + 1.0 * (v - nn[k]);
        if (v > hi[c]) v = hi[c]; else if (v < lo[c]) v = lo[c];
        nn[k] = v; X[k] = cx[c] + v * nx[c]; Y[k] = cy[c] + v * ny[c];
      }
    }
    // interpolate to all samples
    for (let k = 0; k < M; k++) {
      const i0 = idx[k], k1 = (k + 1) % M;
      let i1 = idx[k1]; if (k1 === 0) i1 = N;
      const span = i1 - i0;
      for (let i = i0; i < i1; i++) {
        const f = (i - i0) / span;
        let v = nn[k] * (1 - f) + nn[k1] * f;
        if (v > hi[i]) v = hi[i]; else if (v < lo[i]) v = lo[i];
        nL[i] = v;
      }
    }
  }
  // path geometry
  const X = new Float64Array(N), Y = new Float64Array(N);
  for (let i = 0; i < N; i++) { X[i] = cx[i] + nL[i] * nx[i]; Y[i] = cy[i] + nL[i] * ny[i]; }
  ph = new Float64Array(N); seg = new Float64Array(N);
  let kraw = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, c = (i + 1) % N;
    const ux = X[i] - X[a], uy = Y[i] - Y[a], wx = X[c] - X[i], wy = Y[c] - Y[i];
    const cxs = ux * wy - uy * wx;
    const la = Math.hypot(ux, uy), lb = Math.hypot(wx, wy), lc = Math.hypot(X[c] - X[a], Y[c] - Y[a]);
    kraw[i] = (2 * cxs) / Math.max(1e-9, la * lb * lc);
    ph[i] = Math.atan2(Y[c] - Y[a], X[c] - X[a]);
    seg[i] = Math.max(0.2, lb);
  }
  for (let pass = 0; pass < 6; pass++) {
    const k2 = new Float64Array(N);
    for (let i = 0; i < N; i++) k2[i] = 0.25 * kraw[(i - 1 + N) % N] + 0.5 * kraw[i] + 0.25 * kraw[(i + 1) % N];
    kraw = k2;
  }
  pk = kraw;
  // speed profile
  vP = new Float64Array(N);
  const VMAX = 120;
  for (let i = 0; i < N; i++) {
    let k = Math.abs(pk[i]);
    const k1 = Math.abs(pk[(i + 1) % N]), k0 = Math.abs(pk[(i - 1 + N) % N]);
    if (k1 > k) k = k1; if (k0 > k) k = k0;
    const den = k - G.B * G.plan;
    vP[i] = den > 1e-7 ? Math.min(VMAX, Math.sqrt((G.A * G.plan) / den)) : VMAX;
  }
  // backward pass (lap ends at the line: no need to brake for what comes after it)
  for (let i = N - 2; i >= 0; i--) {
    const vn = vP[i + 1];
    const al = aLatMax(vn) * G.plan;
    let r = (vn * vn * Math.abs(pk[i])) / al; if (r > 1) r = 1;
    let fb = 1 - (r * r) / 0.81; if (fb < 0) fb = 0;
    const a = (G.Ab + G.Bb * vn * vn) * G.planB * fb + DRAG0 + DRAG2 * vn * vn;
    const v = Math.sqrt(vn * vn + 2 * a * seg[i]);
    if (v < vP[i]) vP[i] = v;
  }
}

let prevSteer = 0, eMax = 0, cnt = 0;

function fallback(t) {
  const i = Math.floor(t.s / ds) % N;
  const v = Math.max(1, t.speed);
  const la = Math.min(40, 8 + 0.35 * v);
  const tg = samples[(i + Math.round(la / ds)) % N];
  const dx = tg.x - t.x, dy = tg.y - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const st = Math.atan2(2 * WB * Math.sin(alpha), Math.hypot(dx, dy)) / maxSteer;
  let k = 0;
  for (let d = 0; d < 40; d++) k = Math.max(k, Math.abs(samples[(i + d) % N].curvature));
  const vt = Math.min(70, Math.sqrt(10 / Math.max(k, 1e-6)));
  const err = vt - v;
  return {
    throttle: err > 0 ? Math.min(0.4, 0.1 + err * 0.2) : 0,
    brake: err < -0.5 ? Math.min(0.3, -err * 0.1) : 0,
    steer: Math.max(-1, Math.min(1, st)),
  };
}

export function step(t) {
  if (!ok) return fallback(t);
  const v = Math.max(t.speed, 1);
  let f = t.s / ds;
  let i = Math.floor(f);
  f -= i;
  i = ((i % N) + N) % N;
  const j = (i + 1) % N;
  const nRef = nL[i] + f * (nL[j] - nL[i]);
  const eLat = nRef - t.n;
  const eAbs = Math.abs(eLat);
  const hRef = ph[i] + f * wrap(ph[j] - ph[i]);
  const beta = Math.atan2(t.vy, Math.max(t.vx, 3));
  const eH = wrap(hRef - (t.yaw + beta));
  // curvature feedforward with preview
  const ipf = (t.s + v * 0.1) / ds;
  let ip = Math.floor(ipf);
  const fp = ipf - ip;
  ip = ((ip % N) + N) % N;
  const kff = pk[ip] + fp * (pk[(ip + 1) % N] - pk[ip]);
  const d = Math.max(6, 0.45 * v);
  const Kh = Math.min(1.2, 16 / v);
  let el = eLat; if (el > 4) el = 4; else if (el < -4) el = -4;
  let delta = Math.atan(WB * kff) + 0.00022 * kff * v * v + Kh * (eH + Math.atan(el / d));
  // rear slide: countersteer and ease off the pedals
  let slipCut = 1;
  if (v > 15) {
    const ar = (t.vy - 0.45 * WB * t.yawRate) / Math.max(t.vx, 5);
    const aa = Math.abs(ar);
    if (aa > 0.07) {
      const ex = Math.min(0.2, aa - 0.07);
      delta += (ar > 0 ? 1.2 : -1.2) * ex;
      slipCut = Math.max(0, 1 - ex / 0.05);
    }
  }
  let steer = delta / maxSteer;
  if (steer > 1) steer = 1; else if (steer < -1) steer = -1;

  // speed
  const ivf = (t.s + v * 0.08) / ds;
  let iv = Math.floor(ivf);
  const fv = ivf - iv;
  iv = ((iv % N) + N) % N;
  const iv1 = (iv + 1) % N;
  const lastSeg = iv1 === 0; // beyond the finish line: keep pushing
  const vT = lastSeg ? vP[iv] : vP[iv] + fv * (vP[iv1] - vP[iv]);
  let aPlan = lastSeg ? 0 : (vP[iv1] * vP[iv1] - vP[iv] * vP[iv]) / (2 * seg[iv]);
  if (aPlan > 0) aPlan = 0;
  const drag = DRAG0 + DRAG2 * v * v;
  const alm = aLatMax(v);
  let r = Math.max(Math.abs(t.ay), v * v * Math.abs(kff)) / alm; if (r > 1) r = 1;
  const comb = Math.sqrt(1 - r * r);
  const err = vT - v;
  let w = 1 - (err - 0.3); if (w > 1) w = 1; else if (w < 0) w = 0;
  let aDes = aPlan * w + (err > 0 ? 3.0 : 2.5) * err;
  if (eAbs > eMax) eMax = eAbs;
  if (++cnt % 250 === 0) { if (typeof log === "function") log("t", t.t.toFixed(1), "s", t.s.toFixed(0), "maxE", eMax.toFixed(2)); eMax = 0; }
  let throttle = 0, brake = 0;
  if (aDes < -drag - 0.3) {
    let dec = -aDes - drag;
    const lim = (G.Ab + G.Bb * v * v) * Math.max(0.15, comb) * slipCut;
    if (dec > lim) dec = lim;
    brake = dec / BRK;
  } else if (aDes > -drag) {
    let a = aDes + drag;
    const lim = (G.At + G.Bt * v * v) * Math.max(0.1, comb - 0.05 * 0);
    if (a > lim) a = lim;
    throttle = a / Math.min(FMAX, PM / v);
    // avoid applying power while far off the line with big steering
    if (throttle > 1) throttle = 1;
    throttle *= slipCut;
  }
  if (!(steer === steer)) steer = prevSteer;
  if (!(throttle === throttle)) throttle = 0;
  if (!(brake === brake)) brake = 0;
  prevSteer = steer;
  return { throttle, brake, steer };
}

export const _dbg = () => ({ nL, pk, vP, seg, ph });
