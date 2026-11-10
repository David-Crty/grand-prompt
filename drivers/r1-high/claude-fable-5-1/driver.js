// Racing driver: min-curvature racing line + grip-model speed profile + pure pursuit.
let N = 0, ds = 2, L = 3.6, maxSteer = 0.35, mass = 800, P = 740000, trackLen = 1000;
let px = [], py = [], pk = [], segLen = [], vProf = [], pn = [];
let samples = [];

// Grip model (calibrated from practice telemetry)
const LAT_A0 = 15.0, LAT_K = 0.0046;      // ayMax(v) = A0 + K v^2
const BRK_A0 = 16.0, BRK_K = 0.0050;      // full brake decel
const TRC_A0 = 9.5, TRC_K = 0.0016;       // traction-limited accel
const DRAG_K = 0.0032;                    // drag decel ~ K v^2 (rough)
const LAT_F = 0.82;                       // safety factor on lateral grip
const BRK_F = 0.65;                       // safety factor on braking
const V_MAX = 95;
const MARGIN = 1.1;                       // keep centre this far inside the white line

function ayMax(v) { return LAT_A0 + LAT_K * v * v; }
function brkMax(v) { return BRK_A0 + BRK_K * v * v; }
function trcMax(v) { return Math.min(TRC_A0 + TRC_K * v * v, P / (mass * Math.max(v, 5))) - DRAG_K * v * v; }

export function init(track, car) {
  samples = track.samples; N = samples.length; ds = track.sampleSpacing; trackLen = track.length;
  L = car.wheelbase; maxSteer = car.maxSteer; mass = car.mass; P = car.maxPower;

  // --- racing line: coarse min-curvature optimisation on lateral offsets, then refine ---
  const nx = new Float64Array(N), ny = new Float64Array(N), lim = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const sm = samples[i];
    nx[i] = -Math.sin(sm.heading); ny[i] = Math.cos(sm.heading);
    lim[i] = Math.max(0.3, Math.min(sm.widthLeft, sm.widthRight) - MARGIN);
  }
  const limL = new Float64Array(N), limR = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    limL[i] = Math.max(0.3, samples[i].widthLeft - MARGIN);
    limR[i] = Math.max(0.3, samples[i].widthRight - MARGIN);
  }
  // coarse grid every C samples
  const C = Math.max(1, Math.round(8 / ds));
  const M = Math.floor(N / C);
  const cn = new Float64Array(M);
  const idx = (j) => (j * C) % N;
  const cx = new Float64Array(M), cy = new Float64Array(M);
  const dpx = new Float64Array(M), dpy = new Float64Array(M);
  const cL = new Float64Array(M), cR = new Float64Array(M);
  for (let j = 0; j < M; j++) {
    // tightest limit over the coarse cell
    let l = 1e9, r = 1e9;
    for (let d = -C; d <= C; d++) { const i = (idx(j) + d + N) % N; l = Math.min(l, limL[i]); r = Math.min(r, limR[i]); }
    cL[j] = l; cR[j] = r;
  }
  const ITER = 1500, STEP = 0.11;
  for (let it = 0; it < ITER; it++) {
    for (let j = 0; j < M; j++) { const i = idx(j); cx[j] = samples[i].x + cn[j] * nx[i]; cy[j] = samples[i].y + cn[j] * ny[i]; }
    for (let j = 0; j < M; j++) {
      const a = (j - 1 + M) % M, b = (j + 1) % M;
      dpx[j] = cx[a] - 2 * cx[j] + cx[b]; dpy[j] = cy[a] - 2 * cy[j] + cy[b];
    }
    for (let j = 0; j < M; j++) {
      const a = (j - 1 + M) % M, b = (j + 1) % M; const i = idx(j);
      const gx = dpx[a] - 2 * dpx[j] + dpx[b], gy = dpy[a] - 2 * dpy[j] + dpy[b];
      const g = gx * nx[i] + gy * ny[i];
      let v = cn[j] - STEP * g;
      if (v > cL[j]) v = cL[j]; else if (v < -cR[j]) v = -cR[j];
      cn[j] = v;
    }
  }
  // interpolate to fine grid
  pn = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const j = Math.floor(i / C); const f = (i - j * C) / C;
    const a = cn[j % M], b = cn[(j + 1) % M];
    let v = a + (b - a) * f;
    if (v > limL[i]) v = limL[i]; else if (v < -limR[i]) v = -limR[i];
    pn[i] = v;
  }
  // light smoothing passes on fine grid with clamping
  for (let it = 0; it < 30; it++) {
    for (let i = 0; i < N; i++) {
      const a = pn[(i - 1 + N) % N], b = pn[(i + 1) % N];
      let v = 0.5 * pn[i] + 0.25 * (a + b);
      if (v > limL[i]) v = limL[i]; else if (v < -limR[i]) v = -limR[i];
      pn[i] = v;
    }
  }
  px = new Float64Array(N); py = new Float64Array(N);
  for (let i = 0; i < N; i++) { px[i] = samples[i].x + pn[i] * nx[i]; py[i] = samples[i].y + pn[i] * ny[i]; }
  // path curvature and segment lengths
  pk = new Float64Array(N); segLen = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    const x1 = px[i] - px[a], y1 = py[i] - py[a], x2 = px[b] - px[i], y2 = py[b] - py[i];
    const l1 = Math.hypot(x1, y1), l2 = Math.hypot(x2, y2);
    segLen[i] = l2;
    const cross = x1 * y2 - y1 * x2;
    const h1 = Math.atan2(y1, x1), h2 = Math.atan2(y2, x2);
    let dh = h2 - h1; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    pk[i] = dh / (0.5 * (l1 + l2));
  }
  // smooth curvature slightly (3-point)
  const k2 = new Float64Array(N);
  for (let i = 0; i < N; i++) k2[i] = 0.25 * pk[(i - 1 + N) % N] + 0.5 * pk[i] + 0.25 * pk[(i + 1) % N];
  pk = k2;

  // --- speed profile ---
  vProf = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const k = Math.abs(pk[i]);
    // v^2 k = F*(A0 + K v^2)  =>  v^2 (k - F K) = F A0
    const den = k - LAT_F * LAT_K;
    let v = V_MAX;
    if (den > 1e-9) v = Math.min(V_MAX, Math.sqrt(LAT_F * LAT_A0 / den));
    vProf[i] = v;
  }
  // backward pass (braking), with combined grip
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const nxt = vProf[(i + 1) % N];
      const k = Math.abs(pk[(i + 1) % N]);
      const ayUse = nxt * nxt * k / (LAT_F * ayMax(nxt));
      const frac = Math.max(0.12, 1 - ayUse * ayUse);
      const a = BRK_F * brkMax(nxt) * frac;
      const v = Math.sqrt(nxt * nxt + 2 * a * segLen[i]);
      if (v < vProf[i]) vProf[i] = v;
    }
  }
}

let stepCount = 0;
let braking = false;
export function step(t) {
  const v = t.speed;
  const i = ((Math.floor(t.s / ds) % N) + N) % N;

  // --- steering: pure pursuit on the racing line ---
  const look = 5 + 0.21 * v;
  let j = i, dist = 0;
  // walk ahead along path
  for (let c = 0; c < 60; c++) { dist += segLen[j]; j = (j + 1) % N; if (dist >= look) break; }
  const dx = px[j] - t.x, dy = py[j] - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const d = Math.hypot(dx, dy);
  let steerAngle = Math.atan2(2 * L * Math.sin(alpha), Math.max(d, 1));
  let steer = steerAngle / maxSteer;
  const sLim = v > 8 ? Math.min(1, (L * 1.6 * ayMax(v) / (v * v) + 0.1) / maxSteer) : 1;
  if (steer > sLim) steer = sLim; else if (steer < -sLim) steer = -sLim;

  // --- longitudinal ---
  // required decel to meet the braking profile at any point ahead (max over horizon)
  let aNeed = -1e9, dd2 = 0, j2 = i, vT = vProf[i];
  const lead = 0.12 * v + 1.0; // actuator lag + command hold distance
  for (let c = 0; c < 90; c++) {
    dd2 += segLen[j2]; j2 = (j2 + 1) % N;
    const vp = vProf[j2];
    if (dd2 < 3 + 0.1 * v && vp < vT) vT = vp;
    const a = (v * v - vp * vp) / (2 * Math.max(dd2 - lead, 0.5));
    if (a > aNeed) aNeed = a;
    if (dd2 > 140) break;
  }
  const err = vT - v;
  const sliding = v > 6 && (Math.abs(t.vy) > 0.08 * v || Math.abs(t.headingError) > 0.25);
  let throttle = 0, brake = 0;
  const planned = BRK_F * brkMax(v);
  if (!braking && (aNeed > 0.85 * planned || err < -1.5)) braking = true;
  else if (braking && aNeed < 0.55 * planned && err > -1.0) braking = false;
  if (braking) {
    let b = (aNeed * 1.1) / brkMax(v);
    if (err < -1.5) b = Math.max(b, -err * 0.12);
    const uB = Math.min(1, Math.abs(t.ay) / ayMax(v));
    const bCap = 0.5 * (1 - uB) + 0.04;
    brake = Math.min(bCap, Math.max(0.12, b));
    if (sliding) brake = Math.min(brake, 0.3);
    throttle = 0;
  } else {
    // rear traction cap: combined friction circle on the rear axle
    const kAhead = Math.abs(pk[(i + Math.round((2 + 0.1 * v) / ds)) % N]);
    const ayPred = Math.max(Math.abs(t.ay), v * v * kAhead);
    const u = Math.min(1, ayPred / ayMax(v));
    const engineAx = Math.min(17, P / (mass * Math.max(v, 3)));
    const trac = TRC_A0 + TRC_K * v * v;
    let cap = (trac * Math.sqrt(Math.max(0, 1 - u * u)) * 0.9) / engineAx;
    const capFloor = 0.22 * (1 - u); if (cap < capFloor) cap = capFloor;
    let th = 0.5 + err * 0.5;
    if (aNeed > 0.6 * planned) th = Math.min(th, 0.3);
    throttle = Math.min(cap, Math.max(0, Math.min(1, th)));
    if (u > 0.9 || sliding) throttle = 0;
  }
  if (t.surface === "grass" || t.surface === "gravel") throttle = Math.min(throttle, 0.3);
  if ((stepCount++ % 25) === 0 && typeof log === "function") log(t.s.toFixed(0), v.toFixed(1), (t.n - pn[i]).toFixed(2), throttle.toFixed(2), brake.toFixed(2), t.ay.toFixed(1), vProf[i].toFixed(1));
  return { throttle, brake, steer };
}
