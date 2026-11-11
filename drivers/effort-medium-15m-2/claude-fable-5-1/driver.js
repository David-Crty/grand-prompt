// Racing-line driver: min-curvature line, grip model with downforce, forward/backward speed profile,
// pure pursuit steering on the line, anticipatory throttle/brake.

let S = [], N = 0, ds = 2, L = 1, wb = 3.6, maxSteer = 0.35, mass = 800, P = 740000;
let px = [], py = [], ph = [], pk = [], pn = []; // path position, heading, curvature, offset
let vLim = [];
let car = null;

// Grip model parameters (tunable from telemetry)
const MU_LAT0 = 14.0;      // m/s^2 lateral at low speed
const K_LAT = 0.0028;      // downforce term: ay_max = MU_LAT0 + K_LAT*v^2
const BRK0 = 13.5;         // m/s^2 braking at low speed
const K_BRK = 0.0032;      // braking gain with speed^2 (downforce + drag)
const TRAC_ACC = 11.0;      // m/s^2 traction limited accel at low speed
const DRAG = 0.0011;      // m/s^2 per (m/s)^2 (drag decel = DRAG*v^2)
const VMAX = 95;
const MARGIN = 1.0;        // keep line this far inside the white line
const SAFETY = 0.9;       // fraction of modelled lateral grip to use

function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

export function init(track, c) {
  car = c; S = track.samples; N = S.length; ds = track.sampleSpacing; L = track.length;
  wb = c.wheelbase; maxSteer = c.maxSteer; mass = c.mass; P = c.maxPower;

  // --- racing line on coarse grid ---
  const step = Math.max(1, Math.round(8 / ds));
  const M = Math.floor(N / step);
  const cds = L / M;
  const kc = new Array(M), lo = new Array(M), hi = new Array(M), n = new Array(M).fill(0);
  for (let j = 0; j < M; j++) {
    const i = j * step;
    kc[j] = S[i].curvature;
    // conservative width in neighbourhood
    let wl = Infinity, wr = Infinity;
    for (let d = 0; d < step; d++) { const q = S[(i + d) % N]; wl = Math.min(wl, q.widthLeft); wr = Math.min(wr, q.widthRight); }
    hi[j] = Math.max(0, wl - MARGIN); lo[j] = -Math.max(0, wr - MARGIN);
  }
  const k = new Array(M);
  const ds2 = cds * cds;
  const eta = 0.08 * ds2;
  for (let it = 0; it < 1500; it++) {
    for (let j = 0; j < M; j++) {
      const a = n[(j - 1 + M) % M], b = n[(j + 1) % M];
      k[j] = kc[j] + (a - 2 * n[j] + b) / ds2;
    }
    for (let j = 0; j < M; j++) {
      const g = k[(j - 1 + M) % M] - 2 * k[j] + k[(j + 1) % M];
      let v = n[j] - eta * g;
      if (v > hi[j]) v = hi[j]; else if (v < lo[j]) v = lo[j];
      n[j] = v;
    }
  }
  // interpolate to fine grid (linear in n, then smooth a bit)
  pn = new Array(N);
  for (let i = 0; i < N; i++) {
    const f = i / step; const j0 = Math.floor(f) % M; const j1 = (j0 + 1) % M; const w = f - Math.floor(f);
    pn[i] = n[j0] * (1 - w) + n[j1] * w;
  }
  for (let r = 0; r < 3; r++) {
    const t = pn.slice();
    for (let i = 0; i < N; i++) pn[i] = 0.25 * t[(i - 1 + N) % N] + 0.5 * t[i] + 0.25 * t[(i + 1) % N];
  }
  px = new Array(N); py = new Array(N); ph = new Array(N); pk = new Array(N);
  for (let i = 0; i < N; i++) {
    const q = S[i];
    px[i] = q.x - Math.sin(q.heading) * pn[i]; py[i] = q.y + Math.cos(q.heading) * pn[i];
  }
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    const dx = px[b] - px[a], dy = py[b] - py[a];
    ph[i] = Math.atan2(dy, dx);
  }
  const segLen = new Array(N);
  for (let i = 0; i < N; i++) { const b = (i + 1) % N; segLen[i] = Math.hypot(px[b] - px[i], py[b] - py[i]); }
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N;
    pk[i] = wrap(ph[(i + 1) % N] - ph[a]) / (segLen[a] + segLen[i]);
  }
  // smooth curvature slightly for speed profile
  const ks = new Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0; for (let d = -2; d <= 2; d++) s += pk[(i + d + N) % N]; ks[i] = s / 5;
  }

  // --- speed profile ---
  const vc = new Array(N);
  for (let i = 0; i < N; i++) {
    const kk = Math.max(Math.abs(ks[i]), 1e-5);
    // solve v^2 * k = SAFETY*(MU_LAT0 + K_LAT v^2)  -> v^2 (k - SAFETY*K_LAT) = SAFETY*MU_LAT0
    const den = kk - SAFETY * K_LAT;
    vc[i] = den <= 1e-6 ? VMAX : Math.min(VMAX, Math.sqrt(SAFETY * MU_LAT0 / den));
  }
  vLim = vc.slice();
  // backward pass (braking), combined grip: remaining long. accel = aBrk*sqrt(1-(ay/aymax)^2)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const nx = (i + 1) % N; const v1 = vLim[nx];
      const ab = BRK0 + K_BRK * v1 * v1;
      const ay = Math.abs(ks[nx]) * v1 * v1; const aym = MU_LAT0 + K_LAT * v1 * v1;
      const fr = Math.sqrt(Math.max(0.05, 1 - Math.pow(Math.min(1, ay / aym), 2)));
      const a = ab * fr * 0.9;
      vLim[i] = Math.min(vLim[i], Math.sqrt(v1 * v1 + 2 * a * segLen[i]));
    }
  }
  // forward pass (acceleration)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const nx = (i + 1) % N; const v0 = vLim[i];
      const aPow = P / (mass * Math.max(v0, 5)) - DRAG * v0 * v0;
      const ay = Math.abs(ks[i]) * v0 * v0; const aym = MU_LAT0 + K_LAT * v0 * v0;
      const fr = Math.sqrt(Math.max(0.05, 1 - Math.pow(Math.min(1, ay / aym), 2)));
      const a = Math.max(0.5, Math.min(aPow, (TRAC_ACC + 0.6 * K_LAT * v0 * v0) * fr));
      vLim[nx] = Math.min(vLim[nx], Math.sqrt(v0 * v0 + 2 * a * segLen[i]));
    }
  }
  if (typeof log === "function") {
    let mn = 1e9, mx = 0, sum = 0; for (let i = 0; i < N; i++) { mn = Math.min(mn, vLim[i]); mx = Math.max(mx, vLim[i]); sum += segLen[i] / vLim[i]; }
    log("init", track.id, "N", N, "vmin", mn.toFixed(1), "vmax", mx.toFixed(1), "estLap", sum.toFixed(2));
  }
}

let prevI = 0;
export function step(t) {
  const i0 = Math.floor(t.s / ds) % N;
  // find nearest path index around i0 (path offset shifts s slightly)
  let i = i0, best = Infinity;
  for (let d = -4; d <= 4; d++) {
    const j = (i0 + d + N) % N; const dd = (px[j] - t.x) ** 2 + (py[j] - t.y) ** 2;
    if (dd < best) { best = dd; i = j; }
  }
  const v = t.speed;

  // --- pure pursuit on racing line ---
  const la = Math.max(6, Math.min(30, 4 + 0.28 * v));
  const ti = (i + Math.round(la / ds)) % N;
  const dx = px[ti] - t.x, dy = py[ti] - t.y;
  const alpha = wrap(Math.atan2(dy, dx) - t.yaw);
  const dist = Math.hypot(dx, dy);
  let steerAngle = Math.atan2(2 * wb * Math.sin(alpha), dist);
  // feedforward curvature at the car + slip compensation (understeer gradient)
  const kff = pk[(i + Math.round(0.1 * v / ds)) % N];
  steerAngle = 0.6 * steerAngle + 0.4 * (Math.atan(wb * kff) + kff * v * v * 0.0025);
  // cross-track feedback (Stanley-like): signed lateral error relative to the line
  const eLat = t.n - pn[i];
  steerAngle -= Math.atan(0.9 * eLat / Math.max(v, 5));
  let steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

  // --- longitudinal ---
  // look ahead for the lowest target considering reaction/actuator delay
  const dAhead = v * 0.12 + 2;
  let vT = Infinity;
  const nA = Math.max(1, Math.round(dAhead / ds));
  for (let d = 0; d <= nA; d++) vT = Math.min(vT, vLim[(i + d) % N]);
  // off-line correction: if we're far from the line, slow a bit
  const latErr = Math.sqrt(best);
  if (latErr > 1.5) vT *= Math.max(0.85, 1 - 0.03 * (latErr - 1.5));
  const err = vT - v;
  let throttle = 0, brake = 0;
  if (err > 0) {
    const cap = Math.min(1, 0.25 + v / 60);
    throttle = Math.min(cap, 0.3 + err * 0.5);
    // rear friction circle: lateral load leaves little for drive
    const ayR = 13.0 + 0.0025 * v * v;
    const ayPlan = Math.abs(pk[(i + Math.round(0.15 * v / ds)) % N]) * v * v;
    const u = Math.min(1, Math.max(Math.abs(t.ay), ayPlan) / ayR);
    throttle *= Math.max(0.08, Math.sqrt(Math.max(0, 1 - u * u)) * 0.95);
    // sliding: body slip or heading error large -> back off
    const slip = Math.abs(t.vy) / Math.max(v, 3);
    if (slip > 0.06 || Math.abs(t.headingError) > 0.25) throttle *= 0.3;
  } else if (err < -0.3) {
    brake = Math.min(1, 0.15 + (-err) * 0.18);
  }
  return { throttle, brake, steer };
}
