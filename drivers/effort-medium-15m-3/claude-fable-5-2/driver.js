let S = [], N = 0, ds = 2, L = 3.6, maxSteer = 0.35, mass = 800, P = 740000;
let px = [], py = [], kap = [], vp = [], nl = [], seg = [];
const C = { MU: 14.5, AERO: 0.0037, BMU: 19, BAERO: 0.0050, TR: 10, TRA: 0.0030, DRAG: 0.0014, MARG: 0.7, LA0: 5, LA1: 0.16, BGAIN: 45, FMAX: 14500, SLIP: 0.13, SAFE: 0.97 };
function ayMax(v) { return C.MU + C.AERO * v * v; }
function brMax(v) { return C.BMU + C.BAERO * v * v; }
function trMax(v) { return C.TR + C.TRA * v * v; }

export function init(track, car) {
  S = track.samples; N = S.length; ds = track.sampleSpacing;
  L = car.wheelbase; maxSteer = car.maxSteer; mass = car.mass; P = car.maxPower;
  const lo = new Array(N), hi = new Array(N), nx = new Array(N), ny = new Array(N);
  nl = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const a = S[i];
    lo[i] = -Math.max(0, a.widthRight - C.MARG); hi[i] = Math.max(0, a.widthLeft - C.MARG);
    nx[i] = -Math.sin(a.heading); ny[i] = Math.cos(a.heading);
  }
  // elastic band minimizing second differences, multi-scale
  const scales = [48, 24, 12, 6, 3, 2, 1], iters = [60, 60, 60, 60, 60, 40, 40];
  for (let q = 0; q < scales.length; q++) {
    const k = scales[q];
    for (let it = 0; it < iters[q]; it++) {
      for (let i = 0; i < N; i++) {
        const a = (i - k + N) % N, b = (i + k) % N;
        const mx = 0.5 * (S[a].x + nl[a] * nx[a] + S[b].x + nl[b] * nx[b]);
        const my = 0.5 * (S[a].y + nl[a] * ny[a] + S[b].y + nl[b] * ny[b]);
        let t = (mx - S[i].x) * nx[i] + (my - S[i].y) * ny[i];
        t = nl[i] + 0.9 * (t - nl[i]);
        nl[i] = t < lo[i] ? lo[i] : t > hi[i] ? hi[i] : t;
      }
    }
  }
  px = new Array(N); py = new Array(N); kap = new Array(N); seg = new Array(N);
  for (let i = 0; i < N; i++) { px[i] = S[i].x + nl[i] * nx[i]; py[i] = S[i].y + nl[i] * ny[i]; }
  const raw = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 3 + N) % N, b = (i + 3) % N;
    const ax = px[i] - px[a], ay = py[i] - py[a], bx = px[b] - px[i], by = py[b] - py[i];
    const cx = px[b] - px[a], cy = py[b] - py[a];
    const cr = ax * by - ay * bx;
    const d = Math.hypot(ax, ay) * Math.hypot(bx, by) * Math.hypot(cx, cy);
    raw[i] = d > 1e-9 ? 2 * cr / d : 0;
    const j = (i + 1) % N;
    seg[i] = Math.hypot(px[j] - px[i], py[j] - py[i]);
  }
  for (let i = 0; i < N; i++) {
    let s = 0; for (let d = -2; d <= 2; d++) s += raw[(i + d + N) % N];
    kap[i] = s / 5;
  }
  vp = new Array(N);
  for (let i = 0; i < N; i++) {
    const k = Math.abs(kap[i]) / C.SAFE;
    // v^2 k = MU + AERO v^2
    const den = k - C.AERO;
    vp[i] = den > 1e-6 ? Math.min(110, Math.sqrt(C.MU / den)) : 110;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const j = (i + 1) % N, v = vp[j];
      const u = Math.min(1, 1.08 * v * v * Math.abs(kap[j]) / ayMax(v));
      const a = brMax(v) * Math.sqrt(Math.max(0, 1 - u * u)) * 0.87 + C.DRAG * v * v * 0;
      const c = Math.sqrt(v * v + 2 * a * seg[i]);
      if (c < vp[i]) vp[i] = c;
    }
  }
}

let first = true, e0 = 0, mo = 0, cnt = 0;
export function step(t) {
  const v = t.speed;
  const i = Math.floor(t.s / ds) % N;
  // pure pursuit on racing line
  const la = C.LA0 + C.LA1 * v;
  const j = (i + Math.max(1, Math.round(la / ds))) % N;
  if (first) { first = false; e0 = t.n - nl[i]; }
  let sh = 0;
  if (e0 !== 0) { const f = (t.s + la) / 200; if (f < 1 && t.lapTime < 20) sh = e0 * 0.5 * (1 + Math.cos(Math.PI * f)); else if (t.s > 50) e0 = 0; }
  const dx = px[j] - Math.sin(S[j].heading) * sh - t.x, dy = py[j] + Math.cos(S[j].heading) * sh - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const dist = Math.hypot(dx, dy);
  let steer = Math.atan2(2 * L * Math.sin(alpha), dist) / maxSteer;
  if (v > 6) {
    const base = (t.vy + 1.98 * t.yawRate) / Math.max(t.vx, 1);
    const hiS = (base + C.SLIP) / maxSteer, loS = (base - C.SLIP) / maxSteer;
    steer = Math.max(loS, Math.min(hiS, steer));
  }
  steer = Math.max(-1, Math.min(1, steer));

  // speed
  const d = 2 + v * 0.12;
  const ia = (i + Math.round(d / ds)) % N;
  const vt = vp[ia];
  const off = t.n - nl[i];
  if (Math.abs(off) > mo) mo = Math.abs(off);
  if (++cnt % 250 === 0) { log('s', Math.round(t.s), 'maxoff', mo.toFixed(2)); mo = 0; }
  let aReq = (vt * vt - v * v) / (2 * d);
  let km = 0; const nla = Math.round(v * 0.35 / ds) + 1;
  for (let q = 0; q <= nla; q++) { const kk = Math.abs(kap[(i + q) % N]); if (kk > km) km = kk; }
  const used = Math.min(1, Math.max(Math.abs(t.ay), v * v * km) / ayMax(v));
  const usedB = Math.min(1, Math.abs(t.ay) / ayMax(v));
  const room = Math.sqrt(Math.max(0.04, 1 - usedB * usedB));
  const roomT = Math.max(0.05, 1 - used * used);
  let throttle = 0, brake = 0;
  if (v > vt + 0.3 || aReq < -2) {
    const want = Math.max(-aReq, (v - vt) * 4);
    brake = Math.min(1, want / C.BGAIN, brMax(v) * room / C.BGAIN);
  } else {
    const drag = C.DRAG * v * v;
    const aT = Math.min(trMax(v) * roomT, Math.max(0, (vt - v) * 3 + drag));
    const F = Math.min(C.FMAX, P / Math.max(v, 5));
    throttle = Math.min(1, aT * mass / F);
  }
  return { throttle, brake, steer };
}
