// Racing-line driver: smoothed line within track width, downforce-aware speed profile,
// pure pursuit steering with curvature feedforward, traction-aware throttle.

let S = [], N = 0, ds = 2, L = 3.6, maxSteer = 0.35, mass = 800, P = 740000;
let px = [], py = [], pn = [], pk = [], pds = [], vLim = [];

// Tunables (grip model; calibrate from telemetry)
const MU_G = 16.0;      // m/s^2 lateral at zero speed
const C_DF = 0.0050;    // extra lateral m/s^2 per (m/s)^2 from downforce
const BRK0 = 17.0;      // braking decel at zero speed
const BRK_DF = 0.0040;  // extra braking decel per v^2 (downforce + drag)
const ACC_TRAC = 12.0;   // traction-limited accel at low speed
const DRAG = 0.0018;    // decel per v^2 (m/s^2)
const MAX_V = 95;
const MARGIN = 1.2;     // keep this far inside the white line (car centre)
const SAFETY = 0.92;    // fraction of modelled lateral grip used

export function init(track, car) {
  S = track.samples; N = S.length; ds = track.sampleSpacing;
  L = car.wheelbase; maxSteer = car.maxSteer; mass = car.mass; P = car.maxPower;

  // --- racing line: smooth lateral offset n within bounds ---
  const nx = new Float64Array(N), ny = new Float64Array(N), lo = new Float64Array(N), hi = new Float64Array(N);
  pn = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    nx[i] = -Math.sin(S[i].heading); ny[i] = Math.cos(S[i].heading);
    lo[i] = -Math.max(0.3, S[i].widthRight - MARGIN); hi[i] = Math.max(0.3, S[i].widthLeft - MARGIN);
  }
  px = new Float64Array(N); py = new Float64Array(N);
  const upd = () => { for (let i = 0; i < N; i++) { px[i] = S[i].x + pn[i] * nx[i]; py[i] = S[i].y + pn[i] * ny[i]; } };
  upd();
  const w = Math.max(2, Math.round(12 / ds));
  const ITER = 500, alpha = 0.35;
  for (let it = 0; it < ITER; it++) {
    for (let i = 0; i < N; i++) {
      const a = (i - w + N) % N, b = (i + w) % N;
      const tx = 0.5 * (px[a] + px[b]) - px[i], ty = 0.5 * (py[a] + py[b]) - py[i];
      let n = pn[i] + alpha * (tx * nx[i] + ty * ny[i]);
      if (n < lo[i]) n = lo[i]; else if (n > hi[i]) n = hi[i];
      pn[i] = n; px[i] = S[i].x + n * nx[i]; py[i] = S[i].y + n * ny[i];
    }
  }
  // --- path curvature and spacing ---
  pk = new Float64Array(N); pds = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    const x1 = px[i] - px[a], y1 = py[i] - py[a], x2 = px[b] - px[i], y2 = py[b] - py[i];
    const l1 = Math.hypot(x1, y1), l2 = Math.hypot(x2, y2);
    pds[i] = l2;
    const cross = x1 * y2 - y1 * x2, dot = x1 * x2 + y1 * y2;
    pk[i] = Math.atan2(cross, dot) / (0.5 * (l1 + l2) + 1e-9);
  }
  // smooth curvature a little (3-point)
  const ks = new Float64Array(N);
  for (let i = 0; i < N; i++) ks[i] = (pk[(i - 1 + N) % N] + pk[i] + pk[(i + 1) % N]) / 3;
  pk = ks;

  // --- speed profile ---
  const vc = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -2; d <= 2; d++) k = Math.max(k, Math.abs(pk[(i + d + N) % N]));
    const g = MU_G * SAFETY, c = C_DF * SAFETY;
    let v = MAX_V;
    if (k > c) v = Math.min(MAX_V, Math.sqrt(g / (k - c)));
    vc[i] = v;
  }
  vLim = Float64Array.from(vc);
  // backward (braking)
  for (let pass = 0; pass < 2; pass++) for (let i = N - 1; i >= 0; i--) {
    const nv = vLim[(i + 1) % N];
    const k = Math.abs(pk[i]);
    const ayUse = k * nv * nv, ayMax = (MU_G + C_DF * nv * nv) * SAFETY;
    const frac = Math.sqrt(Math.max(0.05, 1 - Math.min(1, (ayUse / ayMax) ** 2)));
    const dec = (BRK0 + BRK_DF * nv * nv) * frac * 0.95;
    vLim[i] = Math.min(vLim[i], Math.sqrt(nv * nv + 2 * dec * pds[i]));
  }
  // forward (acceleration)
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < N; i++) {
    const j = (i + 1) % N, v = vLim[i];
    const k = Math.abs(pk[i]);
    const ayUse = k * v * v, ayMax = (MU_G + C_DF * v * v) * SAFETY;
    const frac = Math.sqrt(Math.max(0.05, 1 - Math.min(1, (ayUse / ayMax) ** 2)));
    const acc = Math.max(0.3, Math.min(ACC_TRAC * frac, P / (mass * Math.max(v, 5))) - DRAG * v * v);
    vLim[j] = Math.min(vLim[j], Math.sqrt(v * v + 2 * acc * pds[i]));
  }
}

let prevSteer = 0;

export function step(t) {
  const v = t.speed;
  const i = Math.floor(t.s / ds) % N;

  // --- steering: pure pursuit on racing line + curvature feedforward ---
  const la = Math.max(7, Math.min(28, 4 + 0.28 * v));
  const j = (i + Math.round(la / ds)) % N;
  const dx = px[j] - t.x, dy = py[j] - t.y;
  let alpha = Math.atan2(dy, dx) - t.yaw;
  while (alpha > Math.PI) alpha -= 2 * Math.PI; while (alpha < -Math.PI) alpha += 2 * Math.PI;
  const dist = Math.hypot(dx, dy);
  const pp = Math.atan2(2 * L * Math.sin(alpha), dist);
  const kAhead = pk[(i + Math.round((2 + 0.1 * v) / ds)) % N];
  const ff = Math.atan(L * kAhead) * 0.35;
  let steer = (pp + ff) / maxSteer;
  steer = Math.max(-1, Math.min(1, steer));
  prevSteer = steer;

  // --- longitudinal ---
  const ahead = Math.round((0.25 * v + 2) / ds);
  let vT = vLim[(i + ahead) % N];
  for (let d = 0; d <= ahead; d += 2) vT = Math.min(vT, vLim[(i + d) % N] + 0.0 );
  const err = vT - v;
  const ayN = Math.abs(t.ay) / (MU_G + C_DF * v * v);
  const latFree = Math.sqrt(Math.max(0, 1 - Math.min(1, ayN * ayN)));
  let throttle = 0, brake = 0;
  if (err > 0) {
    const ayEst = Math.max(Math.abs(t.ay), Math.abs(pk[i]) * v * v);
    const aR = 9.5 + 0.003 * v * v;
    const axAllow = Math.sqrt(Math.max(0.15 * aR * aR, aR * aR - ayEst * ayEst));
    const cap = Math.max(0.15, Math.min(1, axAllow / Math.min(16, 1000 / Math.max(v, 1))));
    throttle = Math.min(cap, 0.4 + err * 0.5);
  } else if (err < -0.6) {
    brake = Math.min(1, 0.3 + (-err) * 0.3);
    brake *= 0.5 + 0.5 * latFree;
  }
  return { throttle, brake, steer };
}

export { pn, vLim, pk };
