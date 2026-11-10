// Racing-line driver: smoothed line within track width, speed-dependent grip profile,
// forward/backward passes with friction ellipse, pure pursuit + lateral correction.

let S = [], N = 0, ds = 2, L = 3.6, maxSteer = 0.35, mass = 800, P = 740000;
let px = [], py = [], pn = [], pk = [], dl = [], vT = [], ks = [];
const DRAG_K = 0.0012;

// ---- tunables (grip model; hidden constants inferred from practice) ----
const MARGIN = 1.4;        // m inside the white line for the racing line
const A_LAT0 = 16.0;       // lateral accel at zero speed, m/s^2
const A_LATK = 0.0025;     // + k*v^2 (downforce)
const A_BRK0 = 15.0;       // braking decel at zero speed
const A_BRKK = 0.0032;     // + k*v^2 (downforce + drag)
const A_TRAC0 = 8.5;       // rear traction accel at low speed
const A_TRACK = 0.0020;
const V_MAX = 95;
const SMOOTH_ITERS = 400;

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function aLat(v) { return A_LAT0 + A_LATK * v * v; }
function aBrk(v) { return A_BRK0 + A_BRKK * v * v; }
function aEng(v) { return Math.min(16.5, P / (mass * Math.max(v, 5))); }
function aTrac(v) { return Math.min(A_TRAC0 + A_TRACK * v * v, 0.92 * P / (mass * Math.max(v, 5))); }

export function init(track, car) {
  S = track.samples; N = S.length; ds = track.sampleSpacing;
  L = car.wheelbase; maxSteer = car.maxSteer; mass = car.mass; P = car.maxPower;
  const nx = new Array(N), ny = new Array(N), lo = new Array(N), hi = new Array(N);
  for (let i = 0; i < N; i++) {
    nx[i] = -Math.sin(S[i].heading); ny[i] = Math.cos(S[i].heading);
    hi[i] = Math.max(0, S[i].widthLeft - MARGIN);
    lo[i] = -Math.max(0, S[i].widthRight - MARGIN);
    pn[i] = 0;
  }
  // Smooth lateral offsets: pull each point toward the chord of neighbours +-k.
  for (let it = 0; it < SMOOTH_ITERS; it++) {
    const k = it < SMOOTH_ITERS / 2 ? 4 : 2;
    for (let i = 0; i < N; i++) {
      const a = (i - k + N) % N, b = (i + k) % N;
      const ax = S[a].x + pn[a] * nx[a], ay = S[a].y + pn[a] * ny[a];
      const bx = S[b].x + pn[b] * nx[b], by = S[b].y + pn[b] * ny[b];
      const mx = 0.5 * (ax + bx) - S[i].x, my = 0.5 * (ay + by) - S[i].y;
      const want = mx * nx[i] + my * ny[i];
      pn[i] = clamp(pn[i] + 0.5 * (want - pn[i]), lo[i], hi[i]);
    }
  }
  for (let i = 0; i < N; i++) { px[i] = S[i].x + pn[i] * nx[i]; py[i] = S[i].y + pn[i] * ny[i]; }
  // Path curvature (3-point) and segment lengths.
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    const x1 = px[a], y1 = py[a], x2 = px[i], y2 = py[i], x3 = px[b], y3 = py[b];
    const d = 2 * ((x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1));
    const la = Math.hypot(x2 - x1, y2 - y1), lb = Math.hypot(x3 - x2, y3 - y2), lc = Math.hypot(x3 - x1, y3 - y1);
    pk[i] = Math.abs(d) / Math.max(la * lb * lc, 1e-9);
    dl[i] = lb;
  }
  // Smooth curvature a bit (max over +-2 for safety).
  ks = new Array(N);
  for (let i = 0; i < N; i++) { let m = 0; for (let d = -3; d <= 3; d++) m += pk[(i + d + N) % N]; ks[i] = m / 7; }
  for (let i = 0; i < N; i++) { let m = 0; for (let d = -1; d <= 1; d++) m = Math.max(m, ks[(i + d + N) % N]); pk[i] = m; }
  for (let i = 0; i < N; i++) ks[i] = pk[i];
  // Corner speed: solve v^2 * k = aLat(v) = A0 + K v^2  ->  v^2 = A0 / (k - K)
  for (let i = 0; i < N; i++) {
    const k = ks[i];
    let v = V_MAX;
    if (k > A_LATK + 1e-6) v = Math.min(V_MAX, Math.sqrt(A_LAT0 / (k - A_LATK)));
    vT[i] = v;
  }
  // Backward pass (braking) with friction ellipse.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const j = (i + 1) % N, v = vT[j];
      const used = clamp(v * v * ks[j] / aLat(v), 0, 0.98);
      const a = aBrk(v) * Math.sqrt(1 - used * used);
      vT[i] = Math.min(vT[i], Math.sqrt(v * v + 2 * a * dl[i]));
    }
  }
  // Forward pass (traction) from the slowest point.
  let i0 = 0; for (let i = 1; i < N; i++) if (vT[i] < vT[i0]) i0 = i;
  for (let c = 0; c < N; c++) {
    const i = (i0 + c) % N, j = (i + 1) % N, v = vT[i];
    const used = clamp(v * v * ks[i] / aLat(v), 0, 0.98);
    const a = aTrac(v) * Math.sqrt(1 - used * used);
    vT[j] = Math.min(vT[j], Math.sqrt(v * v + 2 * a * dl[i]));
  }
  if (typeof log === "function") {
    let mn = 1e9, mx = 0; for (let i = 0; i < N; i++) { mn = Math.min(mn, vT[i]); mx = Math.max(mx, vT[i]); }
    log("init", track.id, "N", N, "vmin", mn.toFixed(1), "vmax", mx.toFixed(1));
  }
}

let logCount = 0;
export function step(t) {
  const v = Math.max(t.speed, 0.1);
  const i = Math.round(t.s / ds) % N;
  // Pure pursuit on the racing line.
  const look = clamp(6 + 0.45 * v, 8, 60);
  const j = (i + Math.round(look / ds)) % N;
  const dx = px[j] - t.x, dy = py[j] - t.y;
  const dist = Math.max(Math.hypot(dx, dy), 1);
  let alpha = Math.atan2(dy, dx) - t.yaw;
  while (alpha > Math.PI) alpha -= 2 * Math.PI; while (alpha < -Math.PI) alpha += 2 * Math.PI;
  const steerAngle = Math.atan2(2 * L * Math.sin(alpha), dist);
  // Grip-based steering clamp: wheel angle beyond ~1.6x the kinematic cornering angle just slides.
  let dMax = v > 8 ? Math.min(maxSteer, 1.3 * aLat(v) * L / (v * v) + 0.02) : maxSteer;
  // Rear axle busy accelerating: less steering until the throttle comes down.
  const axUse = clamp(Math.max(t.ax, 0) / (aTrac(v) + 2), 0, 0.92);
  if (v > 8) dMax *= Math.sqrt(1 - axUse * axUse);
  const steer = clamp(steerAngle, -dMax, dMax) / maxSteer;
  const usedSteer = Math.abs(steerAngle) / dMax;

  // Speed target: minimum of the profile over the next reaction distance.
  const ahead = Math.round((0.35 * v + 3) / ds);
  let vt = vT[i];
  for (let d = 1; d <= ahead; d++) vt = Math.min(vt, vT[(i + d) % N]);
  const err = vt - v;
  // Friction ellipse: how much of the lateral budget is in use (planned and measured).
  const usedPlan = v * v * ks[i] / aLat(v);
  const usedMeas = Math.abs(t.ay) / aLat(v);
  const used = clamp(Math.max(usedPlan, usedMeas, usedSteer), 0, 0.97);
  const spare = Math.sqrt(1 - used * used);
  let throttle = 0, brake = 0;
  if (err > 0) {
    const aDes = aTrac(v) * spare * clamp(err / 2.5, 0.25, 1);
    throttle = clamp((aDes + DRAG_K * v * v) / aEng(v), 0, 1);
    if (v < 10) throttle = Math.min(throttle, 0.6);
  } else if (err < -0.3) {
    brake = clamp(-err * 0.3, 0.15, 1);
    brake = Math.min(brake, spare + 0.05);
  }
  if (typeof log === "function" && logCount < 400 && (logCount++ % 10) === 0)
    log(t.lapTime.toFixed(2), "s", t.s.toFixed(0), "v", v.toFixed(1), "vt", vt.toFixed(1), "n", t.n.toFixed(2), "ay", t.ay.toFixed(1), "ax", t.ax.toFixed(1), "st", steer.toFixed(2));
  return { throttle, brake, steer };
}
export function debug(samples) {
  for (let i = 0; i < 40; i++) log(i, samples[i].heading.toFixed(3), samples[i].curvature.toFixed(4), pn[i].toFixed(2), pk[i].toFixed(4), vT[i].toFixed(1));
}
