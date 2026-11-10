// Racing-line + speed-profile driver.
let N = 0, ds = 2, L = 0;
let wheelbase = 3.6, maxSteer = 0.35, mass = 800, power = 740000, wf = 0.45;
let samples = [];
let rx, ry, rk, vProf, nOff;

// Tunables (grip model): aLat(v) = MU * (G + KD * v^2)
const G = 9.81;
let MU = 1.6;       // tire friction
let KD = 0.0030;     // downforce per v^2 (as accel / g-equivalent factor)
let CDA = 0.00113;    // drag decel per v^2 (m/s^2 per (m/s)^2)
let LAT_SAFE = 1.0;
let LATMU = 1.6; // fraction of lateral grip used in profile
let BRK_SAFE = 0.9;
let FMAX = 14000;
let TRAC = 1.12; // fraction of braking grip used
let MARGIN = 0.75;    // m from white line for racing line

function aGrip(v) { return MU * (G + KD * v * v); }
let LA = 16.8, LB = 0.0028;
function latGrip(v) { return LA + LB * v * v; }

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  L = track.length;
  wheelbase = car.wheelbase; maxSteer = car.maxSteer; mass = car.mass; power = car.maxPower; wf = car.weightFront;

  const cx = new Float64Array(N), cy = new Float64Array(N), nx = new Float64Array(N), ny = new Float64Array(N);
  const lo = new Float64Array(N), hi = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const p = samples[i];
    cx[i] = p.x; cy[i] = p.y; nx[i] = -Math.sin(p.heading); ny[i] = Math.cos(p.heading);
    const m = Math.min(MARGIN, 0.3 * (p.widthLeft + p.widthRight));
    hi[i] = p.widthLeft - m; lo[i] = -(p.widthRight - m);
    if (hi[i] < lo[i]) { hi[i] = lo[i] = 0.5 * (hi[i] + lo[i]); }
  }
  // Minimum-curvature-ish line by multi-scale Laplacian relaxation of lateral offset.
  nOff = new Float64Array(N);
  const steps = [32, 16, 8, 4, 2, 1];
  for (const k of steps) {
    const iters = k === 1 ? 400 : 150;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        const a = (i - k + N) % N, b = (i + k) % N;
        const ax_ = cx[a] + nOff[a] * nx[a], ay_ = cy[a] + nOff[a] * ny[a];
        const bx_ = cx[b] + nOff[b] * nx[b], by_ = cy[b] + nOff[b] * ny[b];
        const mx = 0.5 * (ax_ + bx_), my = 0.5 * (ay_ + by_);
        // projection of midpoint onto normal line at i
        let n = (mx - cx[i]) * nx[i] + (my - cy[i]) * ny[i];
        n = nOff[i] + 0.8 * (n - nOff[i]);
        if (n > hi[i]) n = hi[i]; else if (n < lo[i]) n = lo[i];
        nOff[i] = n;
      }
    }
  }
  rx = new Float64Array(N); ry = new Float64Array(N); rk = new Float64Array(N);
  for (let i = 0; i < N; i++) { rx[i] = cx[i] + nOff[i] * nx[i]; ry[i] = cy[i] + nOff[i] * ny[i]; }
  const seg = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    seg[i] = Math.hypot(rx[j] - rx[i], ry[j] - ry[i]);
  }
  // curvature via circumcircle over +-2 samples
  const kraw = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 2 + N) % N, b = (i + 2) % N;
    const x1 = rx[a], y1 = ry[a], x2 = rx[i], y2 = ry[i], x3 = rx[b], y3 = ry[b];
    const d12 = Math.hypot(x2 - x1, y2 - y1), d23 = Math.hypot(x3 - x2, y3 - y2), d13 = Math.hypot(x3 - x1, y3 - y1);
    const cr = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
    kraw[i] = 2 * cr / Math.max(1e-6, d12 * d23 * d13);
  }
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let d = -3; d <= 3; d++) s += kraw[(i + d + N) % N];
    rk[i] = s / 7;
  }
  // Speed limit from curvature
  const vMax = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let k = 1e-5;
    for (let d = -3; d <= 3; d++) { const kk = Math.abs(rk[(i + d + N) % N]); if (kk > k) k = kk; }
    // v^2 k = LAT_SAFE*MU*(G + KD v^2)  -> v^2 (k - LAT_SAFE*MU*KD) = LAT_SAFE*MU*G
    const den = k - LAT_SAFE * LB;
    let v = den <= 1e-6 ? 120 : Math.sqrt(LAT_SAFE * LA / den);
    vMax[i] = Math.min(v, 120);
  }
  // Backward (braking) pass, twice for wrap.
  vProf = Float64Array.from(vMax);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const j = (i + 1) % N;
      const v = vProf[j];
      const g = aGrip(v) * BRK_SAFE;
      const u = v * v * Math.abs(rk[j]) / latGrip(v);
      const rem = Math.max(0.1, 1 - u * u);
      const along = (rem > 0 ? g * Math.sqrt(rem) : 0) + CDA * v * v;
      const vi = Math.sqrt(v * v + 2 * along * seg[i]);
      if (vi < vProf[i]) vProf[i] = vi;
    }
  }
  // Forward (traction/power) pass
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const v = Math.max(vProf[i], 1);
      const g = aGrip(v) * (1 - wf) * 0.9;
      const u = v * v * Math.abs(rk[i]) / latGrip(v);
      const rem = 1 - u * u;
      const trac = rem > 0 ? g * Math.sqrt(rem) : 0;
      const acc = Math.min(trac, FMAX / mass, power / (mass * v)) - CDA * v * v;
      const vj = Math.sqrt(Math.max(0, v * v + 2 * Math.max(acc, 0) * seg[i]));
      if (vj < vProf[j]) vProf[j] = vj;
    }
  }
}

let lastI = -1;
let dbg = 0;
export function step(t) {
  let i = Math.floor(t.s / ds) % N;
  if (i < 0) i += N;
  const v = t.speed;
  // Pure pursuit on racing line
  const look = Math.max(6, Math.min(60, 4 + 0.55 * v));
  // find nearest racing-line point near i (search +-6)
  const fx = t.x, fy = t.y;
  const li = Math.round(look / ds);
  const j = (i + li) % N;
  let tx = rx[j], ty = ry[j];
  if (t.lapTime < 15 && t.s < 400) {
    const f = Math.min(1, t.s / 400);
    const p = samples[j];
    const no = nOff[j] * f;
    tx = p.x - Math.sin(p.heading) * no; ty = p.y + Math.cos(p.heading) * no;
  }
  const dx = tx - fx, dy = ty - fy;
  const c = Math.cos(t.yaw), sn = Math.sin(t.yaw);
  const lx = c * dx + sn * dy, ly = -sn * dx + c * dy;
  const d2 = lx * lx + ly * ly;
  const kpp = 2 * ly / Math.max(d2, 1);
  // feedforward from racing-line curvature near the car
  const kff = rk[(i + Math.round(Math.min(10, 0.1 * v) / ds)) % N];
  let kcmd = 0.75 * kpp + 0.25 * kff;
  const kLim = 1.0 * latGrip(v) / Math.max(v * v, 1);
  if (kcmd > kLim) kcmd = kLim; else if (kcmd < -kLim) kcmd = -kLim;
  let ang = Math.atan(wheelbase * kcmd);
  // damp yaw rate mismatch
  ang += 0.02 * (kcmd * v - t.yawRate);
  let steer = ang / maxSteer;
  if (steer > 1) steer = 1; else if (steer < -1) steer = -1;

  // Longitudinal
  const lookV = (i + Math.round((v * 0.12 + 1) / ds)) % N;
  let vt = vProf[lookV];
  // also check a bit further ahead with constant decel
  const err = vt - v;
  let throttle = 0, brake = 0;
  if (err > 0) {
    const grip = aGrip(v);
    const latA = Math.max(Math.abs(t.ay), v * v * Math.abs(rk[i]));
    const u = latA / latGrip(v);
    const remF = Math.max(0, 1 - u * u);
    const tracF = grip * Math.sqrt(remF) * mass * (1 - wf) * TRAC;
    let cap = tracF / Math.min(FMAX, power / Math.max(v, 1));
    if (cap > 1) cap = 1;
    throttle = Math.min(cap, err * 1.0 + 0.1 * cap);
    if (throttle < 0) throttle = 0;
    const beta = Math.abs(t.vy - t.yawRate * wheelbase * wf) / Math.max(v, 1);
    if (beta > 0.05) throttle *= Math.max(0, 1 - (beta - 0.05) * 20);
  } else {
    brake = Math.min(1, -err * 0.5);
    const lu = Math.abs(t.ay) / latGrip(v);
    const bcap = Math.sqrt(Math.max(0.12, 1 - lu * lu));
    if (brake > bcap) brake = bcap;
    const beta = (t.vy - t.yawRate * wheelbase * wf) / Math.max(v, 1);
    if (Math.abs(beta) > 0.03) brake *= Math.max(0.2, 1 - (Math.abs(beta) - 0.03) * 15);
  }
  return { throttle, brake, steer };
}
export function _dbg(){ let t=0; for(let i=0;i<N;i++){t+=ds/vProf[i];} console.log("est lap",t.toFixed(1),"min v",Math.min(...vProf).toFixed(1),"max",Math.max(...vProf).toFixed(1)); let s=""; for(let i=0;i<N;i+=25) s+=vProf[i].toFixed(0)+"/"+nOff[i].toFixed(1)+" "; console.log(s);}
export function _get(){return {vProf,nOff,rk};}
