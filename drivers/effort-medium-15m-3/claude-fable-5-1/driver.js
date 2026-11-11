// Racing-line driver: smoothed path within track limits, speed-dependent grip model,
// backward/forward speed profile, pure pursuit steering, progressive throttle.

let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let vLimit = [];
let px = [], py = [], pn = [], pk = [];

// Grip model (tuned from telemetry): lateral accel limit vs speed.
const A_LAT0 = 18;      // m/s^2 at low speed
const K_LAT = 0.0030;   // downforce term: a = A_LAT0 + K_LAT*v^2
const A_LAT_MAX = 38;
const A_BRK0 = 17;      // braking decel at low speed
const K_BRK = 0.004;
const A_BRK_MAX = 42;
const MAX_SPEED = 95;
const MARGIN = 1.6;     // keep path this far inside the white line

function aLat(v) { return Math.min(A_LAT_MAX, A_LAT0 + K_LAT * v * v); }
function aBrk(v) { return Math.min(A_BRK_MAX, A_BRK0 + K_BRK * v * v); }

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  const nx = new Array(N), ny = new Array(N), lo = new Array(N), hi = new Array(N);
  for (let i = 0; i < N; i++) {
    const h = samples[i].heading;
    nx[i] = -Math.sin(h); ny[i] = Math.cos(h);
    hi[i] = Math.max(0, samples[i].widthLeft - MARGIN);
    lo[i] = -Math.max(0, samples[i].widthRight - MARGIN);
    pn[i] = 0;
  }
  // Iterative smoothing of lateral offset: pull each point toward the chord of its neighbours.
  const K = Math.max(2, Math.round(12 / ds));
  for (let it = 0; it < 400; it++) {
    for (let i = 0; i < N; i++) {
      const a = (i - K + N) % N, b = (i + K) % N;
      const ax = samples[a].x + pn[a] * nx[a], ay = samples[a].y + pn[a] * ny[a];
      const bx = samples[b].x + pn[b] * nx[b], by = samples[b].y + pn[b] * ny[b];
      const mx = 0.5 * (ax + bx) - samples[i].x, my = 0.5 * (ay + by) - samples[i].y;
      const target = mx * nx[i] + my * ny[i];
      let v = pn[i] + 0.6 * (target - pn[i]);
      if (v > hi[i]) v = hi[i]; else if (v < lo[i]) v = lo[i];
      pn[i] = v;
    }
  }
  for (let i = 0; i < N; i++) {
    px[i] = samples[i].x + pn[i] * nx[i];
    py[i] = samples[i].y + pn[i] * ny[i];
  }
  // Curvature of the path: wide 3-point stencil (+-6 m) to filter out kinks, then light smoothing.
  const K2 = Math.max(2, Math.round(6 / ds));
  const raw = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - K2 + N) % N, b = (i + K2) % N;
    const x1 = px[a], y1 = py[a], x2 = px[i], y2 = py[i], x3 = px[b], y3 = py[b];
    const d = 2 * ((x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2));
    const l1 = Math.hypot(x2 - x1, y2 - y1), l2 = Math.hypot(x3 - x2, y3 - y2), l3 = Math.hypot(x3 - x1, y3 - y1);
    raw[i] = Math.abs(d) / Math.max(1e-9, l1 * l2 * l3);
  }
  for (let i = 0; i < N; i++) {
    pk[i] = (raw[(i - 1 + N) % N] + 2 * raw[i] + raw[(i + 1) % N]) / 4;
  }
  // Smooth curvature a little (max over +-4 m) for safety.
  const w = Math.max(1, Math.round(4 / ds));
  const vCorner = new Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) k = Math.max(k, pk[(i + d + N) % N]);
    // Solve v^2 * k = aLat(v) = A0 + K v^2  -> v^2 = A0 / (k - K), capped
    let v;
    if (k <= 1e-6) v = MAX_SPEED;
    else if (k - K_LAT <= 1e-6) v = MAX_SPEED;
    else v = Math.sqrt(A_LAT0 / (k - K_LAT));
    v = Math.min(v, Math.sqrt(A_LAT_MAX / Math.max(k, 1e-6)), MAX_SPEED);
    vCorner[i] = v * 0.95;
  }
  vLimit = vCorner.slice();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = vLimit[(i + 1) % N];
      // Available decel reduced by lateral usage (friction circle).
      const k = pk[i];
      const a = 0.8 * aBrk(next);
      const latFrac = Math.min(1, next * next * k / aLat(next));
      const ad = a * Math.sqrt(Math.max(0.05, 1 - latFrac * latFrac));
      vLimit[i] = Math.min(vLimit[i], Math.sqrt(next * next + 2 * ad * ds));
    }
  }
}

export function step(t) {
  const i = Math.floor(t.s / ds) % N;
  const v = t.speed;

  // Pure pursuit on the racing line.
  const lookahead = Math.min(45, 7 + 0.28 * v);
  const j = (i + Math.round(lookahead / ds)) % N;
  const dx = px[j] - t.x;
  const dy = py[j] - t.y;
  let alpha = Math.atan2(dy, dx) - t.yaw;
  while (alpha > Math.PI) alpha -= 2 * Math.PI;
  while (alpha < -Math.PI) alpha += 2 * Math.PI;
  const dist = Math.hypot(dx, dy);
  const steerAngle = Math.atan2(2 * wheelbase * Math.sin(alpha), dist);
  const steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

  // Speed target: minimum of limit over the braking horizon, accounting for reaction lag.
  const lagIdx = Math.round((v * 0.25) / ds);
  let vT = vLimit[(i + lagIdx) % N];
  const err = vT - v;

  let throttle = 0, brake = 0;
  const latUse = Math.min(1, Math.abs(t.ay) / aLat(v));
  // Rear traction limit: accel ~ 10.5 + downforce; throttle cap = a*m*v/P, reduced by lateral use.
  const aTrac = (10.5 + 0.003 * v * v) * Math.sqrt(Math.max(0.05, 1 - latUse * latUse));
  const cap = Math.min(1, Math.max(0.08, aTrac * v / 925));
  const beta = Math.abs(Math.atan2(t.vy, Math.max(1, t.vx)));
  if (err > 0 && beta < 0.12) {
    throttle = Math.min(cap, 0.3 + err * 0.6);
  } else if (err < -1.0) {
    brake = Math.min(1, (-err) * 0.25);
  }
  return { throttle, brake, steer };
}
