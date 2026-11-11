// Racing-line driver: min-curvature line, grip-model speed profile, pure pursuit + closed-loop pedals.
let S = [], N = 0, ds = 2, L = 3.6, maxSteer = 0.35, mass = 800, P = 740000;
let px = [], py = [], nP = [], vP = [], kP = [], dP = [];
let emax = 0.3, kB = 45, started = false, off = 0;

const MU_LAT = 15, C_LAT = 0.0038;   // lateral accel = MU_LAT + C_LAT v^2
const MU_BRK = 17.5, C_BRK = 0.0033;   // braking decel
const MU_TR = 11, C_TR = 0.002;      // traction accel
const C_DRAG = 0.0012;                 // drag decel = C_DRAG v^2
const RMIN = 12.5, VMAX = 100, MARGIN = 0.2;

function aLat(v) { return MU_LAT + C_LAT * v * v; }

export function init(track, car) {
  S = track.samples; N = S.length; ds = track.sampleSpacing;
  L = car.wheelbase; maxSteer = car.maxSteer; mass = car.mass; P = car.maxPower;
  const lo = new Array(N), hi = new Array(N), nx = new Array(N), ny = new Array(N);
  nP = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const a = S[i];
    nx[i] = -Math.sin(a.heading); ny[i] = Math.cos(a.heading);
    hi[i] = Math.max(0, a.widthLeft - MARGIN); lo[i] = -Math.max(0, a.widthRight - MARGIN);
  }
  for (let i = 0; i < N; i++) {
    let kc = 0;
    for (let d = -2; d <= 2; d++) kc += S[(i + d + N) % N].curvature;
    kc /= 5;
    if (kc > 1 / (RMIN + hi[i])) hi[i] = Math.min(hi[i], Math.max(lo[i], 1 / kc - RMIN));
    else if (-kc > 1 / (RMIN - lo[i])) lo[i] = Math.max(lo[i], Math.min(hi[i], -(1 / -kc - RMIN)));
  }
  px = new Array(N); py = new Array(N);
  for (let i = 0; i < N; i++) { px[i] = S[i].x; py[i] = S[i].y; }
  const strides = [32, 16, 8, 4, 2, 1];
  for (let si = 0; si < strides.length; si++) {
    const k = strides[si];
    if (2 * k * 4 > N) continue;
    const iters = k >= 8 ? 150 : 100;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        const a = (i - k + N) % N, b = (i + k) % N, a2 = (i - 2 * k + 2 * N) % N, b2 = (i + 2 * k) % N;
        const tx = (4 * (px[a] + px[b]) - (px[a2] + px[b2])) / 6;
        const ty = (4 * (py[a] + py[b]) - (py[a2] + py[b2])) / 6;
        let n = (tx - S[i].x) * nx[i] + (ty - S[i].y) * ny[i];
        n = nP[i] + 0.7 * (n - nP[i]);
        if (n > hi[i]) n = hi[i]; else if (n < lo[i]) n = lo[i];
        nP[i] = n; px[i] = S[i].x + n * nx[i]; py[i] = S[i].y + n * ny[i];
      }
    }
  }
  // path curvature & segment length
  kP = new Array(N); dP = new Array(N);
  const w = 2;
  for (let i = 0; i < N; i++) {
    const a = (i - w + N) % N, b = (i + w) % N;
    const x1 = px[a], y1 = py[a], x2 = px[i], y2 = py[i], x3 = px[b], y3 = py[b];
    const d12 = Math.hypot(x2 - x1, y2 - y1), d23 = Math.hypot(x3 - x2, y3 - y2), d13 = Math.hypot(x3 - x1, y3 - y1);
    const cr = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
    kP[i] = d12 * d23 * d13 > 1e-9 ? 2 * cr / (d12 * d23 * d13) : 0;
    const c = (i + 1) % N;
    dP[i] = Math.max(0.2, Math.hypot(px[c] - px[i], py[c] - py[i]));
  }
  const vc = new Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -2; d <= 2; d++) k += kP[(i + d + N) % N];
    k = Math.abs(k) / 5;
    const den = k - C_LAT;
    vc[i] = den > 1e-6 ? Math.min(VMAX, Math.sqrt(MU_LAT / den)) : VMAX;
  }
  vP = vc.slice();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const v1 = vP[(i + 1) % N];
      const al = aLat(v1), ay = v1 * v1 * Math.abs(kP[(i + 1) % N]);
      const f = Math.sqrt(Math.max(0.04, 1 - (ay / al) * (ay / al)));
      const dec = (MU_BRK + C_BRK * v1 * v1) * f + C_DRAG * v1 * v1;
      const v = Math.sqrt(v1 * v1 + 2 * dec * dP[i]);
      if (v < vP[i]) vP[i] = v;
    }
    for (let i = 0; i < N; i++) {
      const v0 = vP[i];
      const al = aLat(v0), ay = v0 * v0 * Math.abs(kP[i]);
      const f = Math.sqrt(Math.max(0.04, 1 - (ay / al) * (ay / al)));
      const acc = Math.min(P / (mass * Math.max(v0, 5)), (MU_TR + C_TR * v0 * v0) * f) - C_DRAG * v0 * v0;
      const v = Math.sqrt(Math.max(1, v0 * v0 + 2 * acc * dP[i]));
      const j = (i + 1) % N;
      if (v < vP[j]) vP[j] = v;
    }
  }
}

export function step(t) {
  const v = t.speed;
  const i = ((Math.floor(t.s / ds) % N) + N) % N;
  // steering: pure pursuit on the racing line + lateral error trim
  const la = Math.max(7, Math.min(45, 3 + 0.38 * v));
  const j = (i + Math.max(2, Math.round(la / ds))) % N;
  if (!started) { started = true; off = t.n - nP[i]; }
  off *= Math.exp(-v * 0.02 / 70);
  const dx = px[j] - off * Math.sin(S[j].heading) - t.x, dy = py[j] + off * Math.cos(S[j].heading) - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const dist = Math.hypot(dx, dy);
  let sa = Math.atan2(2 * L * Math.sin(alpha), dist);
  const e = t.n - nP[i] - off;
  sa -= 0.006 * Math.max(-1.5, Math.min(1.5, e));
  const saMax = 1.25 * aLat(v) * L / Math.max(25, v * v) + 0.01;
  if (sa > saMax) sa = saMax; else if (sa < -saMax) sa = -saMax;
  const steer = Math.max(-1, Math.min(1, sa / maxSteer));

  // speed
  const m = (i + Math.round((v * 0.12) / ds) + 1) % N;
  const vT = vP[m];
  const m1 = (m + 1) % N;
  const aDes = (vP[m1] * vP[m1] - vT * vT) / (2 * dP[m]);
  let throttle = 0, brake = 0;
  const err = vT - v;
  const al = aLat(v);
  const fr = Math.sqrt(Math.max(0.03, 1 - Math.min(1, (t.ay / al) * (t.ay / al))));
  if (t.brake > 0.15 && t.ax < -3) {
    const est = (-t.ax - C_DRAG * v * v) / t.brake;

  }
  if (err < 0.3 && (aDes < -2 || err < -1)) {
    let d = aDes < -2 ? -aDes - 2.5 * err - C_DRAG * v * v : 2.5 * (-err - 1.5);
    if (d < 0) d = 0;
    const dmax = (MU_BRK + C_BRK * v * v) * 1.05 * fr;
    if (d > dmax) d = dmax;
    brake = Math.max(0, Math.min(1, d / kB));
  } else {
    let kmax = 0;
    const nh = Math.round((v * 0.35) / ds) + 2;
    for (let q = 0; q <= nh; q++) { const kk = Math.abs(kP[(i + q) % N]); if (kk > kmax) kmax = kk; }
    const ayU = Math.min(1, Math.max(Math.abs(t.ay), v * v * kmax) / al);
    const frT = Math.max(0.03, 1 - Math.pow(ayU, 1.5));
    const cap = Math.max(0.04, Math.min(1, (MU_TR + C_TR * v * v) * frT * mass * Math.max(v, 3) / P));
    const need = (Math.max(0, aDes) + C_DRAG * v * v + 4 * err) * mass * Math.max(v, 3) / P;
    throttle = Math.max(0, Math.min(cap, need));
  }
  return { throttle, brake, steer };
}
export function _dbg(){return {nP,kP,vP};}
