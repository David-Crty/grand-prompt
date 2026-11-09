let S, N, ds, L, car;
let rx, ry, rk, vLim, nOff;
const P = { MU: 1.5, CL: 0.0038, MUB: 1.6, LATM: 0.83, MARGIN: 1.2, AMAXT: 8 };
const g = 9.81;
export function init(track, c) {
  car = c; S = track.samples; N = S.length; ds = track.sampleSpacing; L = track.length;
  const cx = new Float64Array(N), cy = new Float64Array(N), nx = new Float64Array(N), ny = new Float64Array(N);
  nOff = new Float64Array(N);
  for (let i = 0; i < N; i++) { const s = S[i]; cx[i] = s.x; cy[i] = s.y; nx[i] = -Math.sin(s.heading); ny[i] = Math.cos(s.heading); }
  rx = new Float64Array(N); ry = new Float64Array(N);
  const lo = new Float64Array(N), hi = new Float64Array(N);
  for (let i = 0; i < N; i++) { hi[i] = S[i].widthLeft - P.MARGIN; lo[i] = -(S[i].widthRight - P.MARGIN); if (hi[i] < lo[i]) { hi[i] = lo[i] = 0; } }
  // min-curvature-ish smoothing at multiple scales
  const scales = [12, 8, 5, 3, 2, 1];
  for (const k of scales) {
    for (let it = 0; it < 150; it++) {
      for (let i = 0; i < N; i++) { rx[i] = cx[i] + nOff[i] * nx[i]; ry[i] = cy[i] + nOff[i] * ny[i]; }
      for (let i = 0; i < N; i++) {
        const a = (i - k + N) % N, b = (i + k) % N;
        const tx = 0.5 * (rx[a] + rx[b]), ty = 0.5 * (ry[a] + ry[b]);
        let n = (tx - cx[i]) * nx[i] + (ty - cy[i]) * ny[i];
        n = nOff[i] + 0.8 * (n - nOff[i]);
        nOff[i] = n < lo[i] ? lo[i] : n > hi[i] ? hi[i] : n;
      }
    }
  }
  for (let i = 0; i < N; i++) { rx[i] = cx[i] + nOff[i] * nx[i]; ry[i] = cy[i] + nOff[i] * ny[i]; }
  // curvature of racing line, and segment lengths
  rk = new Float64Array(N); const seg = new Float64Array(N);
  const m = 3;
  for (let i = 0; i < N; i++) {
    const a = (i - m + N) % N, b = (i + m) % N;
    const ax = rx[i] - rx[a], ay = ry[i] - ry[a], bx = rx[b] - rx[i], by = ry[b] - ry[i];
    const cr = ax * by - ay * bx; const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by), lc = Math.hypot(rx[b] - rx[a], ry[b] - ry[a]);
    rk[i] = 2 * cr / Math.max(1e-6, la * lb * lc);
    const j = (i + 1) % N; seg[i] = Math.max(0.1, Math.hypot(rx[j] - rx[i], ry[j] - ry[i]));
  }
  const vc = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0; for (let d = -2; d <= 2; d++) k = Math.max(k, Math.abs(rk[(i + d + N) % N]));
    const den = k - P.MU * P.CL * P.LATM;
    let v = den <= 1e-5 ? 95 : Math.sqrt(P.MU * P.LATM * g / den);
    vc[i] = Math.min(95, v);
  }
  vLim = Float64Array.from(vc);
  const m_ = car.mass;
  for (let pass = 0; pass < 3; pass++) {
    // backward braking
    for (let q = 2 * N; q > 0; q--) {
      const i = q % N, j = (i + 1) % N; const v = vLim[j];
      const alat = v * v * Math.abs(rk[i]); const amax = P.MUB * (g + P.CL * v * v) ;
      const along = amax * Math.sqrt(Math.max(0.05, 1 - (alat / (amax/P.MUB*P.MU)) ** 2)) + 0.0006 * v * v;
      const vv = Math.sqrt(v * v + 2 * along * seg[i]);
      if (vv < vLim[i]) vLim[i] = vv;
    }
    // forward accel
    for (let q = 0; q < 2 * N; q++) {
      const i = q % N, j = (i + 1) % N; const v = Math.max(vLim[i], 3);
      const alat = v * v * Math.abs(rk[i]); const grip = P.MU * (g + P.CL * v * v) * 0.6;
      const atr = grip * Math.sqrt(Math.max(0.05, 1 - (alat / (grip / 0.6)) ** 2));
      const along = Math.min(atr, car.maxPower / (m_ * v) * 0.9) - 0.0006 * v * v;
      const vv = Math.sqrt(v * v + 2 * Math.max(0, along) * seg[i]);
      if (vv < vLim[j]) vLim[j] = vv;
    }
  }
}
let lastLog = -10;
export function step(t) {
  const i = Math.floor(t.s / ds) % N;
  const v = t.speed;
  const look = Math.max(6, 4 + 0.32 * v);
  const j = (i + Math.round(look / ds)) % N;
  const dx = rx[j] - t.x, dy = ry[j] - t.y;
  let alpha = Math.atan2(dy, dx) - t.yaw;
  alpha = Math.atan2(Math.sin(alpha), Math.cos(alpha));
  const dist = Math.hypot(dx, dy);
  let sa = Math.atan2(2 * car.wheelbase * Math.sin(alpha), dist);
  // yaw-rate damping
  const kTarget = rk[(i + Math.round(0.2 * v / ds)) % N];
  sa += 0.02 * (kTarget * v - t.yawRate);
  const smax = car.wheelbase * (P.MU * (g + P.CL * v * v)) / Math.max(25, v * v) + 0.07;
  if (sa > smax) sa = smax; else if (sa < -smax) sa = -smax;
  const steer = Math.max(-1, Math.min(1, sa / car.maxSteer));
  const vt = vLim[(i + Math.round((v * 0.25 + 2) / ds)) % N];
  const err = vt - v;
  let throttle = 0, brake = 0;
  if (err > 0) {
    const cap = Math.min(1, 0.35 + v / 45);
    throttle = Math.min(cap, 0.3 + err * 0.5);
    const alatMax = P.MU * (g + P.CL * v * v);
    const use = Math.min(1, Math.abs(t.ay) / alatMax);
    if (v < 45) throttle *= Math.max(0.25, 1 - 0.8 * use * use);
    const slip = Math.abs(t.vy) / Math.max(5, v);
    if (slip > 0.04) throttle *= Math.max(0, 1 - (slip - 0.04) * 15);
  } else {
    throttle = err > -1 ? 0.2 : 0;
    brake = err < -1 ? Math.min(1, -err * 0.3) : 0;
    const alatMax = P.MU * (g + P.CL * v * v);
    const use = Math.min(1, Math.abs(t.ay) / alatMax);
    brake *= Math.max(0.15, Math.sqrt(1 - 0.9 * use * use));
  }
  // oversteer guard: yaw rate exceeding what the path needs, or big sideslip
  const yawWant = rk[i] * v;
  const slip2 = Math.abs(t.vy) / Math.max(5, v);
  if (slip2 > 0.08 || (Math.abs(t.yawRate) > Math.abs(yawWant) + 0.25 && v > 6)) { brake = Math.min(brake, 0.1); throttle = Math.min(throttle, 0.1); }
  if (t.surface !== "track" && t.surface !== "kerb") { throttle = Math.min(throttle, 0.4); }
  return { throttle, brake, steer };
}
