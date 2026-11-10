// Racing-line + speed-profile driver
const G = 0.95;            // grip scale for lateral limit
const A0 = 15.5, A1 = 0.003; // a_lat = G*(A0 + A1 v^2)
const BR0 = 16, BR1 = 0.003;   // planned braking decel
const MARGIN = 1.3;
const VMAX = 100;

let N, ds, L, W, MS, P;
let px, py, pk, vProf, nOff, ch;

function wrapi(i) { return ((i % N) + N) % N; }

export function init(track, car) {
  const S = track.samples; N = S.length; ds = track.sampleSpacing; L = track.length;
  W = car.wheelbase; MS = car.maxSteer;
  const nx = new Array(N), ny = new Array(N), lo = new Array(N), hi = new Array(N);
  for (let i = 0; i < N; i++) {
    nx[i] = -Math.sin(S[i].heading); ny[i] = Math.cos(S[i].heading);
    hi[i] = Math.max(0.3, S[i].widthLeft - MARGIN);
    lo[i] = -Math.max(0.3, S[i].widthRight - MARGIN);
  }
  const SL = 0.06;
  for (let i = 0; i < N; i++) {
    const d = Math.min(i, N - i) * ds * SL; // distance-from-line slope limit (start line)
    hi[i] = Math.min(hi[i], d); lo[i] = Math.max(lo[i], -d);
    if (hi[i] < lo[i]) { hi[i] = 0; lo[i] = 0; }
  }
  nOff = new Array(N).fill(0);
  const X = (i) => S[i].x + nOff[i] * nx[i], Y = (i) => S[i].y + nOff[i] * ny[i];
  const K = 4;
  for (let it = 0; it < 600; it++) {
    for (let i = 0; i < N; i++) {
      const a = wrapi(i - K), b = wrapi(i + K);
      const mx = 0.5 * (X(a) + X(b)), my = 0.5 * (Y(a) + Y(b));
      const t = (mx - S[i].x) * nx[i] + (my - S[i].y) * ny[i];
      let v = nOff[i] + 1.0 * (t - nOff[i]);
      nOff[i] = Math.min(hi[i], Math.max(lo[i], v));
    }
  }
  px = new Array(N); py = new Array(N); pk = new Array(N);
  for (let i = 0; i < N; i++) { px[i] = X(i); py[i] = Y(i); }
  // curvature (signed, + left) smoothed
  const k0 = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = wrapi(i - 2), b = wrapi(i + 2);
    const ax = px[i] - px[a], ay = py[i] - py[a], bx = px[b] - px[i], by = py[b] - py[i];
    const cr = ax * by - ay * bx;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by), lc = Math.hypot(px[b] - px[a], py[b] - py[a]);
    k0[i] = 2 * cr / Math.max(1e-6, la * lb * lc);
  }
  for (let i = 0; i < N; i++) {
    pk[i] = (k0[wrapi(i - 1)] + 2 * k0[i] + k0[wrapi(i + 1)]) / 4;
  }
  // speed profile
  vProf = new Array(N);
  for (let i = 0; i < N; i++) {
    const k = Math.abs(pk[i]);
    const den = k - G * A1;
    let v = den <= 1e-6 ? VMAX : Math.sqrt(G * A0 / den);
    vProf[i] = Math.min(VMAX, v);
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 2 * N; i >= 0; i--) {
      const j = wrapi(i), nx2 = vProf[wrapi(i + 1)];
      const alat = Math.min(G * (A0 + A1 * nx2 * nx2), nx2 * nx2 * Math.abs(pk[j]));
      const amax = G * (A0 + A1 * nx2 * nx2);
      const fr = Math.sqrt(Math.max(0.05, 1 - (alat / amax) * (alat / amax)));
      const dec = (BR0 + BR1 * nx2 * nx2) * fr;
      vProf[j] = Math.min(vProf[j], Math.sqrt(nx2 * nx2 + 2 * dec * ds));
    }
  }
}

let lastI = 0;
export function step(t) {
  const i = Math.floor(t.s / ds) % N;
  const v = t.speed;
  // pure pursuit toward racing line
  const look = Math.max(7, 6 + 0.22 * v);
  const ti = wrapi(i + Math.round(look / ds));
  const dx = px[ti] - t.x, dy = py[ti] - t.y;
  const alpha = Math.atan2(Math.sin(Math.atan2(dy, dx) - t.yaw), Math.cos(Math.atan2(dy, dx) - t.yaw));
  const dist = Math.hypot(dx, dy);
  const delta = Math.atan2(2 * W * Math.sin(alpha), dist);
  const steer = Math.max(-1, Math.min(1, delta / MS));

  const ahead = wrapi(i + Math.round(v * 0.15 / ds));
  const vt = vProf[ahead];
  const err = vt - v;
  let throttle = 0, brake = 0;
  if (err > 0) {
    const amax = G * (A0 + A1 * v * v);
    const ayu = Math.max(Math.abs(t.ay), v * v * Math.abs(pk[ahead]));
    const fr = Math.sqrt(Math.max(0, 1 - Math.pow(Math.min(1, ayu / amax), 2)));
    let cap = Math.min(1, 0.3 + v / 40) * fr;
    if (Math.abs(t.vy) > 1.2) cap = 0;
    throttle = Math.min(cap, err * 0.5 + 0.1);
    if (err > 3) throttle = cap;
  } else if (err < -0.3) {
    brake = Math.min(1, -err * 0.3);
  }
  if (t.lapTime < 1 || (t.s % 500) < 2) log(t.s.toFixed(0), v.toFixed(1), t.n.toFixed(2), t.ay.toFixed(1), steer.toFixed(2), alpha.toFixed(3), nOff[ti].toFixed(2), vt.toFixed(1));
  return { throttle, brake, steer };
}
