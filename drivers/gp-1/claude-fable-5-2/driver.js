// Racing-line driver: min-curvature line, friction-ellipse speed profile, feedforward+preview steering.
const CFG = {
  margin: 0.7, // m inside the white line for the car centre
  gLat: 0.9,
  gBrk: 0.9,
  gTrc: 0.9,
  lat0: 16.5, lat1: 0.003, // lateral grip model a = lat0 + lat1 v^2
  brk0: 16.9, brk1: 0.0042, // peak braking decel (incl. drag)
  trc0: 10.3, trc1: 0.0026, // traction-limited drive accel (before drag)
  drag: 0.0011, // drag decel = drag v^2
  thrA: 17.3, // drive accel at full throttle, low speed
  brkA: 43.5, // decel per unit brake
  vTop: 110,
  blend: 150,
};

let N = 0, ds = 2, L = 3.6, maxSteer = 0.35, PM = 925;
let px, py, hd, kap, vp, sl, nOff, cx, cy, chd;
let prevSteer = 0, cnt = 0;

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

export function init(track, car) {
  const S = track.samples;
  N = S.length;
  ds = track.sampleSpacing;
  L = car.wheelbase;
  maxSteer = car.maxSteer;
  PM = car.maxPower / car.mass;
  cx = new Float64Array(N); cy = new Float64Array(N); chd = new Float64Array(N);
  const nx = new Float64Array(N), ny = new Float64Array(N);
  const lo = new Float64Array(N), hi = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const s = S[i];
    cx[i] = s.x; cy[i] = s.y; chd[i] = s.heading;
    nx[i] = -Math.sin(s.heading); ny[i] = Math.cos(s.heading);
    let h = s.widthLeft - CFG.margin, l = -(s.widthRight - CFG.margin);
    if (h < 0.1) h = 0.1;
    if (l > -0.1) l = -0.1;
    hi[i] = h; lo[i] = l;
  }
  nOff = new Float64Array(N);
  px = new Float64Array(N); py = new Float64Array(N);
  for (let i = 0; i < N; i++) { px[i] = cx[i]; py[i] = cy[i]; }

  // Multi-level projected Gauss-Seidel on sum |P[i-1] - 2P[i] + P[i+1]|^2 (minimum curvature).
  const levels = [[16, 600], [8, 1500], [4, 3000], [2, 2000], [1, 500]];
  for (let lv = 0; lv < levels.length; lv++) {
    const k = levels[lv][0], iters = levels[lv][1];
    const M = Math.floor(N / k);
    if (M < 12) continue;
    const wt = new Float64Array(M);
    for (let it = 0; it < iters; it++) {
      if (it % 4 === 0) {
        // weights 1/h^3 so the objective is the integral of curvature^2 (not of the raw 2nd difference)
        for (let j = 0; j < M; j++) {
          const i = j * k, a = ((j - 1 + M) % M) * k, b = ((j + 1) % M) * k;
          const h = 0.5 * (Math.hypot(px[i] - px[a], py[i] - py[a]) + Math.hypot(px[b] - px[i], py[b] - py[i])) / (k * ds);
          wt[j] = 1 / (h * h * h + 1e-6);
        }
      }
      for (let j = 0; j < M; j++) {
        const i = j * k;
        const ja = (j - 1 + M) % M, jb = (j + 1) % M;
        const a = ja * k, b = jb * k;
        const a2 = ((j - 2 + M) % M) * k, b2 = ((j + 2) % M) * k;
        const wa = wt[ja], wi = wt[j], wb = wt[jb];
        const Nx = nx[i], Ny = ny[i], Cx = cx[i], Cy = cy[i];
        const A = (px[a2] - 2 * px[a] + Cx) * Nx + (py[a2] - 2 * py[a] + Cy) * Ny;
        const B = (px[a] + px[b] - 2 * Cx) * Nx + (py[a] + py[b] - 2 * Cy) * Ny;
        const C = (px[b2] - 2 * px[b] + Cx) * Nx + (py[b2] - 2 * py[b] + Cy) * Ny;
        let n = (-wa * A + 2 * wi * B - wb * C) / (wa + 4 * wi + wb);
        if (n > hi[i]) n = hi[i]; else if (n < lo[i]) n = lo[i];
        nOff[i] = n;
        px[i] = cx[i] + n * nx[i]; py[i] = cy[i] + n * ny[i];
      }
    }
    if (k > 1) {
      // interpolate offsets to intermediate samples
      for (let j = 0; j < M; j++) {
        const i0 = j * k;
        const i1 = j === M - 1 ? N : i0 + k;
        const n0 = nOff[i0], n1 = nOff[i1 % N];
        for (let i = i0 + 1; i < i1; i++) {
          let n = n0 + ((n1 - n0) * (i - i0)) / (i1 - i0);
          if (n > hi[i]) n = hi[i]; else if (n < lo[i]) n = lo[i];
          nOff[i] = n;
          px[i] = cx[i] + n * nx[i]; py[i] = cy[i] + n * ny[i];
        }
      }
    }
  }

  // Flying start: the car is on the centerline at s=0, so blend the line in from n=0.
  const nb = Math.min(Math.floor(N / 4), Math.round(CFG.blend / ds));
  for (let i = 0; i < nb; i++) {
    const q = i / nb;
    const n = nOff[i] * q * q * (3 - 2 * q);
    nOff[i] = n;
    px[i] = cx[i] + n * nx[i]; py[i] = cy[i] + n * ny[i];
  }
  // Geometry of the line.
  hd = new Float64Array(N); kap = new Float64Array(N); sl = new Float64Array(N);
  const W = 2;
  for (let i = 0; i < N; i++) {
    let a = (i - W + N) % N, b = (i + W) % N;
    if (i < W) a = i; // do not look back across the line (the lap starts there)
    if (i >= N - W) b = i;
    const x1 = px[a], y1 = py[a], x2 = px[i], y2 = py[i], x3 = px[b], y3 = py[b];
    hd[i] = Math.atan2(y3 - y1, x3 - x1);
    const d12 = Math.hypot(x2 - x1, y2 - y1), d23 = Math.hypot(x3 - x2, y3 - y2), d13 = Math.hypot(x3 - x1, y3 - y1);
    const cr = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
    kap[i] = (2 * cr) / (d12 * d23 * d13 + 1e-9);
    if (i < W || i >= N - W) kap[i] = S[i].curvature;
    const n1 = (i + 1) % N;
    sl[i] = i === N - 1 ? ds : Math.hypot(px[n1] - px[i], py[n1] - py[i]);
  }
  // light smoothing of curvature
  for (let p = 0; p < 2; p++) {
    const t = kap.slice();
    for (let i = 0; i < N; i++) kap[i] = 0.25 * t[(i - 1 + N) % N] + 0.5 * t[i] + 0.25 * t[(i + 1) % N];
  }

  // Speed profile.
  vp = new Float64Array(N);
  const g1 = CFG.gLat * CFG.lat1, g0 = CFG.gLat * CFG.lat0;
  for (let i = 0; i < N; i++) {
    const k = Math.abs(kap[i]);
    let v = CFG.vTop;
    if (k > g1 + 1e-6) v = Math.min(v, Math.sqrt(g0 / (k - g1)));
    vp[i] = v;
  }
  for (let pass = 0; pass < 1; pass++) {
    for (let i = N - 2; i >= 0; i--) {
      const j = (i + 1) % N;
      const v = vp[j];
      const ayl = g0 + g1 * v * v;
      const u = (v * v * Math.abs(kap[j])) / ayl;
      const f = Math.sqrt(Math.max(0, 1 - u * u));
      const a = CFG.gBrk * (CFG.brk0 + CFG.brk1 * v * v) * f + (1 - f) * CFG.drag * v * v;
      const vn = Math.sqrt(v * v + 2 * a * sl[i]);
      if (vn < vp[i]) vp[i] = vn;
    }
  }
  vp[0] = Math.min(vp[0], 72);
  for (let pass = 0; pass < 1; pass++) {
    for (let i = 0; i < N - 1; i++) {
      const j = i + 1;
      const v = vp[i];
      const ayl = g0 + g1 * v * v;
      const u = (v * v * Math.abs(kap[i])) / ayl;
      const f = Math.sqrt(Math.max(0, 1 - u * u));
      const drive = Math.min(CFG.thrA, PM / Math.max(v, 1), CFG.gTrc * (CFG.trc0 + CFG.trc1 * v * v) * f);
      const a = drive - CFG.drag * v * v;
      const vn = Math.sqrt(Math.max(1, v * v + 2 * a * sl[i]));
      if (vn < vp[j]) vp[j] = vn;
    }
  }
}

export function step(t) {
  let i = Math.floor(t.s / ds) % N;
  if (i < 0) i += N;
  const v = Math.max(t.speed, 1);
  // refine nearest line point around i
  let best = i, bd = 1e18;
  for (let d = -3; d <= 3; d++) {
    const j = (i + d + N) % N;
    const dx = t.x - px[j], dy = t.y - py[j];
    const q = dx * dx + dy * dy;
    if (q < bd) { bd = q; best = j; }
  }
  i = best;
  const ch = Math.cos(hd[i]), sh = Math.sin(hd[i]);
  const dx = t.x - px[i], dy = t.y - py[i];
  const e = -dx * sh + dy * ch; // lateral error, left positive
  const beta = Math.atan2(t.vy, Math.max(t.vx, 3));
  const psi = wrap(t.yaw + 0.5 * beta - hd[i]);

  // Steering: curvature feedforward (previewed) + preview-point feedback.
  const dla = 5 + 0.22 * v;
  const iff = Math.min(N - 1, i + Math.round((0.08 * v) / ds));
  const kff = 0.5 * (kap[iff] + kap[Math.min(N - 1, i + Math.round((0.16 * v) / ds))]);
  let delta = L * kff - (2 * L * (e + dla * Math.sin(psi))) / (dla * dla);
  // yaw-rate damping
  delta -= 0.02 * (t.yawRate - v * kap[i]);
  const dmax = (L * (CFG.lat0 + CFG.lat1 * v * v)) / (v * v) + 0.035;
  delta = clamp(delta, -dmax, dmax);
  const steer = clamp(delta / maxSteer, -1, 1);

  // Longitudinal.
  const il = Math.min(N - 2, i + Math.max(1, Math.round((0.06 * v) / ds)));
  const vt = vp[il];
  const i2 = il + 1;
  const aProf = (vp[i2] * vp[i2] - vp[il] * vp[il]) / (2 * sl[il]);
  let aDes = aProf + 5 * (vt - v);
  if (Math.abs(e) > 1.5) aDes = Math.min(aDes, 4 * (Math.max(8, 0.6 * vt) - v));
  const drag = CFG.drag * v * v;
  const ayl = CFG.lat0 + CFG.lat1 * v * v;
  const u = Math.min(1, Math.abs(t.ay) / ayl);
  const f = Math.sqrt(Math.max(0, 1 - u * u));
  let throttle = 0, brake = 0;
  if (aDes > -drag) {
    const full = Math.min(CFG.thrA, PM / v);
    const cap = (CFG.gTrc * (CFG.trc0 + CFG.trc1 * v * v) * Math.max(f, 0.15)) / full;
    throttle = clamp((aDes + drag) / full, 0, Math.min(1, cap));
    if (Math.abs(beta) > 0.12) throttle *= 0.3;
  } else {
    const cap = (CFG.gBrk * (CFG.brk0 + CFG.brk1 * v * v) * Math.max(f, 0.1) - drag) / CFG.brkA;
    brake = clamp((-aDes - drag) / CFG.brkA, 0, Math.max(0.02, cap));
  }
  if (typeof log === "function" && (cnt++ % 12 === 0)) log(t.s.toFixed(0), "e", e.toFixed(2), "psi", psi.toFixed(3), "v", v.toFixed(1), "vt", vt.toFixed(1), "k", kap[i].toFixed(4), "st", (delta / maxSteer).toFixed(2), "nL", nOff[i].toFixed(2), "ay", t.ay.toFixed(1));
  prevSteer = steer;
  return { throttle, brake, steer };
}
