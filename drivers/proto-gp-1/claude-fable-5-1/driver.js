// Racing driver: minimum-curvature line within the track width, friction-circle speed profile,
// curvature feedforward + lateral/heading feedback steering, traction- and lock-up-aware pedals.

// ---------------- tunables ----------------
const EXPERIMENT = false; // brake-step experiment on the main straight in lap 1 (practice only)
const LOG_EVERY = 4;

const MARGIN = 0.8; // m between the car centre and the white line on the inside bound
const TIRE_G = 1.0; // scale of the total tire capacity estimated from braking (sliding was measured)
const TIRE_A0 = 16.6; // m/s^2 at zero speed
const TIRE_A2 = 0.0039; // m/s^2 per (m/s)^2 (downforce)
const LAT_F = 0.86; // lateral share of the tire capacity
const BRK_F = 0.85; // braking share of the tire capacity
const TRAC_A0 = 10.5; // rear traction limit at zero speed, m/s^2
const TRAC_A2 = 0.0026;
const TRAC_F = 0.88;
const DRAG_K = 0.00111; // m/s^2 per (m/s)^2
const ENG_FMAX = 13700; // N
const BRAKE_PER_UNIT = 43; // m/s^2 of tire demand per unit of brake command
const V_MAX = 95;

const STEER_LEAD_T = 0.12; // s of curvature feedforward lead
const OMEGA = 2.0; // rad/s lateral error loop bandwidth
const ZETA = 0.8;
const K_US = 0.0007; // rad per m/s^2 of lateral accel at low speed (slip compensation)
const K_US_V = 55; // m/s: the compensation falls as 1/(1+(v/K_US_V)^2) with downforce
const SPEED_LEAD_T = 0.10;
const K_V = 1.5; // 1/s speed error gain
const ALPHA_LIM = 0.07; // rad, front slip angle the steering clamp allows
const AR_SPIN = 0.14; // rad of rear slip angle that triggers spin recovery
const AR_SLIDE = 0.07; // rad of rear slip angle above which the pedals are released
const K_I = 0.0008; // 1/(m s) integral gain on the lateral error (curvature units)
const K_I_MAX = 0.0015;
const K_YR = 0.05; // rad of steer per rad/s of yaw-rate error (yaw damping)

// ---------------- state ----------------
let samples = [];
let N = 0;
let ds = 2;
let L = 3.6;
let maxSteer = 0.35;
let mass = 800;
let maxPower = 740000;
let nPath = []; // lateral offset of the racing line at each sample
let pX = [];
let pY = [];
let kPath = []; // path curvature at each sample
let thPath = []; // path heading at each sample
let vProf = []; // target speed at each sample
let dl = []; // path length from sample i to i+1

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}
function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function tireCap(v) {
  return TIRE_G * (TIRE_A0 + TIRE_A2 * v * v);
}
function latCap(v) {
  return LAT_F * tireCap(v);
}
function tracCap(v) {
  return TRAC_F * (TRAC_A0 + TRAC_A2 * v * v);
}
function engForce(v) {
  return Math.min(ENG_FMAX, maxPower / Math.max(v, 1));
}

// Minimum-curvature line: Gauss-Seidel on the squared second differences of the path points,
// coarse-to-fine over the sample index, bounded by the track width minus the margin.
function optimizeLine() {
  const nx = new Float64Array(N);
  const ny = new Float64Array(N);
  const cx = new Float64Array(N);
  const cy = new Float64Array(N);
  const lo = new Float64Array(N);
  const hi = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const sm = samples[i];
    nx[i] = -Math.sin(sm.heading);
    ny[i] = Math.cos(sm.heading);
    cx[i] = sm.x;
    cy[i] = sm.y;
    hi[i] = Math.max(0.3, sm.widthLeft - MARGIN);
    lo[i] = -Math.max(0.3, sm.widthRight - MARGIN);
  }
  let n = new Float64Array(N);
  const levels = [16, 8, 4, 2, 1];
  const sweeps = [1500, 800, 400, 200, 120];
  for (let li = 0; li < levels.length; li++) {
    const K = levels[li];
    const M = Math.floor(N / K);
    // coarse arrays
    const idx = new Int32Array(M);
    for (let j = 0; j < M; j++) idx[j] = Math.round((j * N) / M) % N;
    const cn = new Float64Array(M);
    const clo = new Float64Array(M);
    const chi = new Float64Array(M);
    for (let j = 0; j < M; j++) {
      const i = idx[j];
      let l = lo[i];
      let h = hi[i];
      // bounds must hold over the whole coarse cell (the fine path interpolates between nodes)
      const half = Math.floor(K / 2);
      for (let d = -half; d <= half; d++) {
        const q = (i + d + N) % N;
        if (lo[q] > l) l = lo[q];
        if (hi[q] < h) h = hi[q];
      }
      clo[j] = l;
      chi[j] = Math.max(h, l + 0.1);
      cn[j] = clamp(n[i], clo[j], chi[j]);
    }
    const px = new Float64Array(M);
    const py = new Float64Array(M);
    for (let j = 0; j < M; j++) {
      const i = idx[j];
      px[j] = cx[i] + cn[j] * nx[i];
      py[j] = cy[i] + cn[j] * ny[i];
    }
    // Curvature ~ (normal component of the second difference) / h^2. The path normal and the
    // weights 1/h^4 are lagged (recomputed every few sweeps), which keeps each update linear.
    const w = new Float64Array(M);
    const tx = new Float64Array(M); // path normal (perpendicular to the tangent)
    const ty = new Float64Array(M);
    const reweight = () => {
      for (let j = 0; j < M; j++) {
        const jm1 = (j - 1 + M) % M;
        const jp1 = (j + 1) % M;
        const a = Math.hypot(px[j] - px[jm1], py[j] - py[jm1]);
        const b = Math.hypot(px[jp1] - px[j], py[jp1] - py[j]);
        const h = Math.max(0.5, (a + b) / 2);
        w[j] = 1 / (h * h * h * h);
        const ex = px[jp1] - px[jm1];
        const ey = py[jp1] - py[jm1];
        const el = Math.hypot(ex, ey) || 1;
        tx[j] = -ey / el;
        ty[j] = ex / el;
      }
    };
    for (let it = 0; it < sweeps[li]; it++) {
      if (it % 10 === 0) reweight();
      for (let j = 0; j < M; j++) {
        const i = idx[j];
        const jm2 = (j - 2 + M) % M;
        const jm1 = (j - 1 + M) % M;
        const jp1 = (j + 1) % M;
        const jp2 = (j + 2) % M;
        // D_{j-1} = P_{j-2} - 2P_{j-1} + P_j ; D_j = P_{j-1} - 2P_j + P_{j+1} ; D_{j+1} = P_j - 2P_{j+1} + P_{j+2}
        // with P_j = C_j + n_j N_j; minimise sum w (D . T)^2 over n_j (D0 = D at n_j = 0).
        const bx = cx[i];
        const by = cy[i];
        const ax = nx[i];
        const ay = ny[i];
        const d1 = (px[jm2] - 2 * px[jm1] + bx) * tx[jm1] + (py[jm2] - 2 * py[jm1] + by) * ty[jm1];
        const d2 = (px[jm1] - 2 * bx + px[jp1]) * tx[j] + (py[jm1] - 2 * by + py[jp1]) * ty[j];
        const d3 = (bx - 2 * px[jp1] + px[jp2]) * tx[jp1] + (by - 2 * py[jp1] + py[jp2]) * ty[jp1];
        const m1 = ax * tx[jm1] + ay * ty[jm1];
        const m2 = -2 * (ax * tx[j] + ay * ty[j]);
        const m3 = ax * tx[jp1] + ay * ty[jp1];
        const w1 = w[jm1];
        const w2 = w[j];
        const w3 = w[jp1];
        const den = w1 * m1 * m1 + w2 * m2 * m2 + w3 * m3 * m3;
        let v = den > 1e-12 ? -(w1 * m1 * d1 + w2 * m2 * d2 + w3 * m3 * d3) / den : cn[j];
        if (v < clo[j]) v = clo[j];
        else if (v > chi[j]) v = chi[j];
        cn[j] = v;
        px[j] = bx + v * ax;
        py[j] = by + v * ay;
      }
    }
    // upsample to the fine grid by linear interpolation along the index
    const fine = new Float64Array(N);
    for (let j = 0; j < M; j++) {
      const i0 = idx[j];
      const i1 = idx[(j + 1) % M];
      const span = ((i1 - i0 + N) % N) || N;
      for (let d = 0; d < span; d++) {
        const q = (i0 + d) % N;
        const f = d / span;
        fine[q] = clamp(cn[j] * (1 - f) + cn[(j + 1) % M] * f, lo[q], hi[q]);
      }
    }
    n = fine;
  }
  nPath = Array.from(n);
}

function buildPath() {
  pX = new Array(N);
  pY = new Array(N);
  for (let i = 0; i < N; i++) {
    const sm = samples[i];
    pX[i] = sm.x - Math.sin(sm.heading) * nPath[i];
    pY[i] = sm.y + Math.cos(sm.heading) * nPath[i];
  }
  dl = new Array(N);
  thPath = new Array(N);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    dl[i] = Math.hypot(pX[j] - pX[i], pY[j] - pY[i]);
    const h = (i - 1 + N) % N;
    thPath[i] = Math.atan2(pY[j] - pY[h], pX[j] - pX[h]);
  }
  const kRaw = new Array(N);
  for (let i = 0; i < N; i++) {
    const h = (i - 1 + N) % N;
    const j = (i + 1) % N;
    const dth = wrapAngle(thPath[j] - thPath[h]);
    kRaw[i] = dth / (dl[h] + dl[i]);
  }
  kPath = new Array(N);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let d = -2; d <= 2; d++) acc += kRaw[(i + d + N) % N];
    kPath[i] = acc / 5;
  }
}

function buildSpeedProfile() {
  const v = new Array(N);
  for (let i = 0; i < N; i++) {
    const k = Math.abs(kPath[i]);
    const a0 = LAT_F * TIRE_G * TIRE_A0;
    const a2 = LAT_F * TIRE_G * TIRE_A2;
    let vl = V_MAX;
    if (k > a2 + 1e-6) vl = Math.min(V_MAX, Math.sqrt(a0 / (k - a2)));
    v[i] = vl;
  }
  // backward pass: braking
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const j = (i + 1) % N;
      const vn = v[j];
      const ay = Math.abs(kPath[j]) * vn * vn;
      const cap = BRK_F * tireCap(vn);
      const along = Math.sqrt(Math.max(0, cap * cap - ay * ay)) + DRAG_K * vn * vn;
      const vb = Math.sqrt(vn * vn + 2 * along * dl[i]);
      if (vb < v[i]) v[i] = vb;
    }
  }
  // forward pass: traction and power
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const vc = v[i];
      const ay = Math.abs(kPath[i]) * vc * vc;
      const lc = latCap(vc);
      const circ = Math.sqrt(Math.max(0, 1 - (ay / lc) * (ay / lc)));
      const aTr = tracCap(vc) * circ;
      const aEng = engForce(vc) / mass;
      const along = Math.max(0.2, Math.min(aTr, aEng) - DRAG_K * vc * vc);
      const vf = Math.sqrt(vc * vc + 2 * along * dl[i]);
      if (vf < v[j]) v[j] = vf;
    }
  }
  vProf = v;
}

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  L = car.wheelbase;
  maxSteer = car.maxSteer;
  mass = car.mass;
  maxPower = car.maxPower;
  optimizeLine();
  buildPath();
  buildSpeedProfile();
}

// interpolate a per-sample array at position s (wrapping)
function at(arr, s) {
  const f = s / ds;
  let i = Math.floor(f);
  const r = f - i;
  i = ((i % N) + N) % N;
  const j = (i + 1) % N;
  return arr[i] * (1 - r) + arr[j] * r;
}
function atAngle(arr, s) {
  const f = s / ds;
  let i = Math.floor(f);
  const r = f - i;
  i = ((i % N) + N) % N;
  const j = (i + 1) % N;
  return arr[i] + wrapAngle(arr[j] - arr[i]) * r;
}

let tick = 0;
let kInt = 0;
let buf = [];
let bufT = 0;
let expPhase = 0;
let expT0 = 0;

function experiment(t) {
  if (!EXPERIMENT || t.lap !== 1) return null;
  const s = t.s;
  if (s < 600 || s > 1500) return null;
  // brake steps once the car is fast; each level held for 0.5 s
  const levels = [0.25, 0.35, 0.45, 0.55, 0.7, 0.85, 1.0, 0.3, 0.45, 0.6, 0.8, 1.0, 0.35, 0.5, 0.7];
  if (expPhase === 0) {
    if (t.speed > 80) {
      expPhase = 1;
      expT0 = t.t;
    } else return null;
  }
  if (expPhase === 1) {
    const k = Math.floor((t.t - expT0) / 0.5);
    if (k >= levels.length || t.speed < 18) {
      expPhase = 2;
      return null;
    }
    return { throttle: 0, brake: levels[k], steer: 0 };
  }
  return null;
}

export function step(t) {
  const v = t.speed;
  const vE = Math.max(v, 6);
  const s = t.s;

  // ---- steering ----
  const sLead = s + 2 + v * STEER_LEAD_T;
  const kFF = at(kPath, sLead);
  const e = at(nPath, s) - t.n; // positive: path is to the left of the car
  const course = t.yaw + Math.atan2(t.vy, Math.max(t.vx, 1));
  const psiE = wrapAngle(course - atAngle(thPath, s));
  const onTrack = t.surface === "track" || t.surface === "kerb";
  const gain = onTrack ? 1 : 0.5;
  if (onTrack && Math.abs(e) < 3) kInt = clamp(kInt + e * K_I * 0.02, -K_I_MAX, K_I_MAX);
  else kInt = 0;
  let kCmd = kFF + kInt + (gain * (e * OMEGA * OMEGA)) / (vE * vE) - (gain * psiE * 2 * ZETA * OMEGA) / vE;
  const kUs = K_US / (1 + (v / K_US_V) * (v / K_US_V));
  let delta = Math.atan(L * kCmd) + kUs * kCmd * v * v;
  delta += K_YR * (v * kCmd - t.yawRate);
  // keep the front slip angle below the tire peak
  const vx = Math.max(t.vx, 3);
  const aF = L * 0.55; // CG to front axle
  const slipBase = Math.atan((t.vy + aF * t.yawRate) / vx);
  delta = clamp(delta, slipBase - ALPHA_LIM, slipBase + ALPHA_LIM);
  const bR = L - aF;
  const alphaR = -Math.atan((t.vy - bR * t.yawRate) / vx);
  const spinning = v > 8 && Math.abs(alphaR) > AR_SPIN;
  const sliding = v > 8 && Math.abs(alphaR) > AR_SLIDE;
  if (sliding) delta -= 1.5 * (alphaR - Math.sign(alphaR) * AR_SLIDE);
  if (spinning) delta = clamp(-2 * Math.atan2(t.vy, vx), -maxSteer, maxSteer);
  const steer = clamp(delta / maxSteer, -1, 1);

  // ---- speed ----
  const sAhead = s + v * SPEED_LEAD_T;
  const vT = at(vProf, sAhead);
  const vNow = at(vProf, s);
  const dAhead = Math.max(1, v * SPEED_LEAD_T);
  const aFF = (vT * vT - vNow * vNow) / (2 * dAhead);
  let aCmd = aFF + K_V * (vT - v);
  const ayNow = Math.max(Math.abs(t.ay), Math.abs(at(kPath, s)) * v * v);
  const tc = tireCap(v) * 1.05;
  const circ = Math.sqrt(Math.max(0, 1 - (ayNow / tc) * (ayNow / tc)));
  const drag = DRAG_K * v * v;
  let throttle = 0;
  let brake = 0;
  if (aCmd + drag > 0) {
    const aTr = tracCap(v) * Math.max(0.15, circ);
    const aWant = Math.min(aCmd + drag, aTr);
    throttle = clamp((aWant * mass) / engForce(v), 0, 1);
  } else {
    const dem = -aCmd - drag; // tire decel demand
    const cap = BRK_F * tireCap(v) * Math.max(0.3, circ);
    brake = clamp(Math.min(dem, cap) / BRAKE_PER_UNIT, 0, 1);
  }
  if (!onTrack) {
    // low grip: little power, gentle braking, let the steering bring the car back
    throttle = Math.min(throttle, v < 12 ? 0.5 : 0.1);
    brake = Math.min(brake, 0.25);
  }
  if (sliding) {
    throttle = Math.min(throttle, 0.1);
    brake = Math.min(brake, 0.1);
  }
  if (spinning) {
    throttle = 0;
    brake = 0.3;
  }

  tick++;
  if (tick % LOG_EVERY === 0) {
    if (buf.length === 0) bufT = t.t;
    buf.push(`${t.vy.toFixed(2)} ${t.yawRate.toFixed(3)} ${at(nPath, s).toFixed(2)} ${vT.toFixed(1)} ${(kFF * 1e4).toFixed(0)}`);
    if (buf.length >= 10) {
      log(`${bufT.toFixed(2)}|${buf.join("|")}`);
      buf = [];
    }
  }

  const ex = experiment(t);
  if (ex) return ex;
  return { throttle, brake, steer };
}

export function _debug() {
  return { nPath, kPath, vProf, dl, thPath, pX, pY };
}
