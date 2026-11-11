let N = 0, ds = 2, L = 3.6, maxSteer = 0.35, mass = 800, P = 740000;
let px = [], py = [], vLim = [], kap = [], nOff = [];
const AY0 = 14.5, AYK = 0.0027;   // lateral grip: AY0 + AYK v^2
const BR0 = 17, BRK = 0.0045;   // braking decel
const TR0 = 10.3, TRK = 0.0012;   // traction accel
const VMAX = 100, MARGIN = 0.6;
let off = null, nxA = [], nyA = [];

export function init(track, car) {
  const S = track.samples;
  N = S.length; ds = track.sampleSpacing;
  L = car.wheelbase; maxSteer = car.maxSteer; mass = car.mass; P = car.maxPower;
  const nx = new Array(N), ny = new Array(N), lo = new Array(N), hi = new Array(N);
  const n = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    nx[i] = -Math.sin(S[i].heading); ny[i] = Math.cos(S[i].heading);
    hi[i] = Math.max(0, S[i].widthLeft - MARGIN); lo[i] = -Math.max(0, S[i].widthRight - MARGIN);
  }
  const scales = [32, 16, 8, 4, 2, 1];
  for (let si = 0; si < scales.length; si++) {
    const k = scales[si];
    const iters = k >= 8 ? 150 : 100;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        const a1 = (i - k + N) % N, b1 = (i + k) % N, a2 = (i - 2 * k + 2 * N) % N, b2 = (i + 2 * k) % N;
        const tx = (4 * (S[a1].x + n[a1] * nx[a1] + S[b1].x + n[b1] * nx[b1]) - (S[a2].x + n[a2] * nx[a2] + S[b2].x + n[b2] * nx[b2])) / 6;
        const ty = (4 * (S[a1].y + n[a1] * ny[a1] + S[b1].y + n[b1] * ny[b1]) - (S[a2].y + n[a2] * ny[a2] + S[b2].y + n[b2] * ny[b2])) / 6;
        const d = (tx - S[i].x) * nx[i] + (ty - S[i].y) * ny[i];
        let v = n[i] + 0.5 * (d - n[i]);
        if (v > hi[i]) v = hi[i]; if (v < lo[i]) v = lo[i];
        n[i] = v;
      }
    }
  }
  px = new Array(N); py = new Array(N); nOff = n; nxA = nx; nyA = ny; off = null;
  for (let i = 0; i < N; i++) { px[i] = S[i].x + n[i] * nx[i]; py[i] = S[i].y + n[i] * ny[i]; }
  // curvature (Menger, +-2 samples)
  const kr = new Array(N);
  const w = 2;
  for (let i = 0; i < N; i++) {
    const a = (i - w + N) % N, b = (i + w) % N;
    const ax = px[i] - px[a], ay = py[i] - py[a], bx = px[b] - px[i], by = py[b] - py[i];
    const cx = px[b] - px[a], cy = py[b] - py[a];
    const cr = ax * by - ay * bx;
    const den = Math.hypot(ax, ay) * Math.hypot(bx, by) * Math.hypot(cx, cy);
    kr[i] = den > 1e-9 ? 2 * cr / den : 0;
  }
  kap = new Array(N);
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let d = -3; d <= 3; d++) m = Math.max(m, Math.abs(kr[(i + d + N) % N]));
    kap[i] = m;
  }
  vLim = new Array(N);
  for (let i = 0; i < N; i++) {
    const k = kap[i];
    vLim[i] = k > AYK + AY0 / (VMAX * VMAX) ? Math.sqrt(AY0 / (k - AYK)) : VMAX;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const vn = vLim[(i + 1) % N];
      const latUse = Math.min(1, vn * vn * kap[i] / (AY0 + AYK * vn * vn));
      const dec = (BR0 + BRK * vn * vn) * 0.85 * Math.max(0.05, 1 - latUse * latUse);
      const v = Math.sqrt(vn * vn + 2 * dec * ds);
      if (v < vLim[i]) vLim[i] = v;
    }
  }
}

export function step(t) {
  const v = Math.max(t.speed, 1);
  const i = ((Math.floor(t.s / ds) % N) + N) % N;
  const la = 5 + 0.22 * v;
  const j = (i + Math.max(2, Math.round(la / ds))) % N;
  if (off === null) off = t.n - nOff[i];
  off *= Math.max(0, 1 - v * 0.02 / 70);
  if (Math.abs(off) < 0.02) off = 0;
  const dx = px[j] + off * nxA[j] - t.x, dy = py[j] + off * nyA[j] - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const dist = Math.hypot(dx, dy);
  let steer = Math.atan2(2 * L * Math.sin(alpha), dist) / maxSteer;
  const sMax = Math.min(1, 1.4 * L * (AY0 + AYK * v * v) / (v * v) / maxSteer + 0.02);
  if (Math.abs(t.vy) / v < 0.08) steer = Math.max(-sMax, Math.min(sMax, steer));
  steer = Math.max(-1, Math.min(1, steer));

  const ia = (i + Math.round(v * 0.16 / ds)) % N;
  let vT = Math.min(vLim[ia], vLim[i]);
  const e = Math.abs(t.n - nOff[i] - off);
  if (e > 1.5) vT *= Math.max(0.7, 1 - 0.1 * (e - 1.5));
  const err = vT - v;
  const ayMax = AY0 + AYK * v * v;
  const latUse = Math.min(1, Math.max(Math.abs(t.ay), v * v * Math.max(kap[i], kap[ia])) / ayMax);
  const room = Math.sqrt(Math.max(0.02, 1 - latUse * latUse));
  let throttle = 0, brake = 0;
  if (err > 0) {
    const aT = (TR0 + TRK * v * v) * room;
    const cap = Math.min(1, aT / Math.min(17.3, P / (mass * v)));
    throttle = Math.min(cap, 0.15 + err * 0.5);
    const sl = Math.abs(t.vy) / v;
    if (sl > 0.05) throttle *= Math.max(0, 1 - (sl - 0.05) * 20);
  } else if (err < -0.2) {
    brake = Math.min(1, -err * 1.0) * Math.min(1, (BR0 + BRK * v * v) / 44) * Math.max(0.1, room * room);
  }
  return { throttle, brake, steer };
}
