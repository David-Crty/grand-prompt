// Racing-line driver: min-curvature line, grip/aero speed profile, pure pursuit + feedforward.
const P = {
  A0: 15.6,      // lateral accel at zero speed, m/s^2
  A2: 0.0041,    // extra lateral accel per v^2
  B0: 13.0,      // braking decel at zero speed
  B2: 0.0030,
  margin: 0.7,   // keep line this far inside white line (m)
  vMax: 95,
  T0: 7.5,
  T2: 0.0015,
  lookT: 0.45,
};

let S = [], N = 0, ds = 2, L = 0, wb = 3.6, maxSteer = 0.35, mass = 800, power = 740000;
let lx = [], ly = [], lk = [], ln = [], vT = [], lsArr = [];

function aLat(v) { return P.A0 + P.A2 * v * v; }
function aBrk(v) { return P.B0 + P.B2 * v * v; }
const DRAG = 0.00113, FDRIVE = 13000, BRK = 40;
function aAcc(v) {
  const trac = P.T0 + P.T2 * v * v;
  const pw = Math.min(FDRIVE, power / Math.max(v, 1)) / mass - DRAG * v * v;
  return Math.max(0.5, Math.min(trac, pw));
}

export function init(track, car) {
  S = track.samples; N = S.length; ds = track.sampleSpacing; L = track.length;
  wb = car.wheelbase; maxSteer = car.maxSteer; mass = car.mass; power = car.maxPower;
  const nx = new Array(N), ny = new Array(N), lo = new Array(N), hi = new Array(N);
  ln = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    nx[i] = -Math.sin(S[i].heading); ny[i] = Math.cos(S[i].heading);
    hi[i] = Math.max(0, S[i].widthLeft - P.margin);
    lo[i] = -Math.max(0, S[i].widthRight - P.margin);
  }
  lx = new Array(N); ly = new Array(N);
  const upd = () => { for (let i = 0; i < N; i++) { lx[i] = S[i].x + ln[i] * nx[i]; ly[i] = S[i].y + ln[i] * ny[i]; } };
  upd();
  // Iterative smoothing toward neighbour midpoint (multi-scale), projected on the normal.
  const scales = [12, 8, 5, 3, 2, 1];
  for (const k of scales) {
    const iters = 250;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        const a = (i - k + N) % N, b = (i + k) % N, a2 = (i - 2 * k + N) % N, b2 = (i + 2 * k) % N;
        const mx = (4 * (lx[a] + lx[b]) - lx[a2] - lx[b2]) / 6, my = (4 * (ly[a] + ly[b]) - ly[a2] - ly[b2]) / 6;
        const d = (mx - lx[i]) * nx[i] + (my - ly[i]) * ny[i];
        let n = ln[i] + 0.5 * d;
        if (n > hi[i]) n = hi[i]; if (n < lo[i]) n = lo[i];
        ln[i] = n;
        lx[i] = S[i].x + n * nx[i]; ly[i] = S[i].y + n * ny[i];
      }
    }
  }
  // Curvature of line via circumcircle over +-2 samples.
  lk = new Array(N); lsArr = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 2 + N) % N, b = (i + 2) % N;
    const ax = lx[i] - lx[a], ay = ly[i] - ly[a], bx = lx[b] - lx[i], by = ly[b] - ly[i];
    const cr = ax * by - ay * bx;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by), lc = Math.hypot(lx[b] - lx[a], ly[b] - ly[a]);
    lk[i] = 2 * cr / Math.max(1e-6, la * lb * lc);
    lsArr[i] = Math.hypot(lx[(i + 1) % N] - lx[i], ly[(i + 1) % N] - ly[i]);
  }
  // smooth curvature lightly
  const k2 = lk.slice();
  for (let i = 0; i < N; i++) lk[i] = (k2[(i - 1 + N) % N] + 2 * k2[i] + k2[(i + 1) % N]) / 4;
  // speed profile
  const vc = new Array(N);
  for (let i = 0; i < N; i++) {
    const k = Math.max(Math.abs(lk[i]), 1e-5);
    // solve v^2 k = A0 + A2 v^2
    const den = k - P.A2;
    let v = den > 0 ? Math.sqrt(P.A0 / den) : P.vMax;
    vc[i] = Math.min(P.vMax, v);
  }
  vT = vc.slice();
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 2 * N - 1; j >= 0; j--) {
      const i = j % N, nI = (i + 1) % N;
      const v = vT[nI];
      const al = v * v * Math.abs(lk[i]), am = aLat(v);
      const f = Math.sqrt(Math.max(0.05, 1 - (al / am) * (al / am)));
      const vv = Math.sqrt(v * v + 2 * aBrk(v) * f * lsArr[i]);
      if (vv < vT[i]) vT[i] = vv;
    }
    for (let j = 0; j < 2 * N; j++) {
      const i = j % N, nI = (i + 1) % N;
      const v = vT[i];
      const al = v * v * Math.abs(lk[i]), am = aLat(v);
      const f = Math.sqrt(Math.max(0.05, 1 - (al / am) * (al / am)));
      const vv = Math.sqrt(v * v + 2 * aAcc(v) * f * lsArr[i]);
      if (vv < vT[nI]) vT[nI] = vv;
    }
  }
}

let logged = 0;
function startDist(s) { return s < L / 2 ? s : 1e9; }
export function step(t) {
  const i = ((Math.floor(t.s / ds) % N) + N) % N;
  const v = t.speed;
  // pure pursuit on racing line
  const look = Math.max(6, Math.min(45, P.lookT * v + 4));
  // find closest line point near i (line offset small vs ds)
  const j = (i + Math.round(look / ds)) % N;
  let tx = lx[j], ty = ly[j];
  const dist0 = (t.lapTime < 1 ? 0 : 0) + startDist(t.s);
  if (dist0 < 250) {
    const b = 1 - (dist0 + look) / 250;
    if (b > 0) { const h = S[j].heading; tx += b * (-ln[j]) * -Math.sin(h); ty += b * (-ln[j]) * Math.cos(h); }
  }
  const dx = tx - t.x, dy = ty - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const dist = Math.hypot(dx, dy);
  const kpp = 2 * Math.sin(alpha) / Math.max(dist, 1);
  let delta = Math.atan(wb * kpp);
  // lateral error correction toward line
  const en = ln[i] - t.n;
  delta += 0.0 * en;
  // understeer gradient-ish: small, rely on pursuit
  let steer = Math.max(-1, Math.min(1, delta / maxSteer));

  // speed control: feedforward on planned accel + P on speed error
  const ib = (i + Math.max(1, Math.round((v * 0.12) / ds))) % N;
  const ib1 = (ib + 1) % N;
  const vt = vT[ib];
  const aPlan = (vT[ib1] * vT[ib1] - vt * vt) / (2 * lsArr[ib]);
  const err = vt - v;
  let aDes = aPlan + 2.0 * err;
  const drag = DRAG * v * v;
  let throttle = 0, brake = 0;
  const use = Math.min(1, Math.abs(t.ay) / aLat(v));
  if (aDes > -drag) {
    const fmax = Math.min(FDRIVE, power / Math.max(v, 1));
    throttle = Math.min(1, (aDes + drag) * mass / fmax);
    const aTr = (P.T0 + P.T2 * v * v) * Math.sqrt(Math.max(0.0, 1 - use * use)) + 0.5;
    const cap = Math.min(1, (aTr + drag) * mass / fmax);
    throttle = Math.min(throttle, cap);
  } else {
    brake = Math.min(1, (-aDes - drag) / BRK);
  }
  const beta = Math.atan2(t.vy, Math.max(1, t.vx));
  if (Math.abs(beta) > 0.05 && v > 8) throttle *= Math.max(0, 1 - (Math.abs(beta) - 0.05) * 20);
  if (logged < 300 && (Math.floor(t.lapTime * 50) % 25 === 0)) {
    logged++;
    log(t.lapTime.toFixed(1), t.s.toFixed(0), v.toFixed(1), vt.toFixed(1), t.n.toFixed(2), ln[i].toFixed(2), steer.toFixed(2), beta.toFixed(3));
  }
  return { throttle, brake, steer };
}
