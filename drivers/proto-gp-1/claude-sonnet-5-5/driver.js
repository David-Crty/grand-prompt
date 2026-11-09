const P = {
  A0: 19, C: 0.0035, BR0: 18, BRC: 0.0015, ACC: 9, MARGIN: 2.2, VMAX: 95, LA0: 6, LAK: 0.30, SAFE: 0.92,
};
let N = 0, ds = 2, wb = 3.6, maxSteer = 0.35, L = 0;
let px = [], py = [], vLim = [], lineN = [];

export function init(track, car) {
  const S = track.samples;
  N = S.length; ds = track.sampleSpacing; wb = car.wheelbase; maxSteer = car.maxSteer; L = track.length;
  const n = new Array(N).fill(0);
  const nx = S.map((s) => -Math.sin(s.heading)), ny = S.map((s) => Math.cos(s.heading));
  const lo = S.map((s) => -(s.widthRight - P.MARGIN)), hi = S.map((s) => s.widthLeft - P.MARGIN);
  const X = (i) => S[i].x + n[i] * nx[i], Y = (i) => S[i].y + n[i] * ny[i];
  for (let it = 0; it < 1500; it++) {
    for (let i = 0; i < N; i++) {
      const a = (i + N - 1) % N, b = (i + 1) % N;
      const mx = (X(a) + X(b)) / 2 - S[i].x, my = (Y(a) + Y(b)) / 2 - S[i].y;
      let v = mx * nx[i] + my * ny[i];
      v = n[i] + 1.0 * (v - n[i]);
      n[i] = Math.max(lo[i], Math.min(hi[i], v));
    }
  }
  lineN = n;
  px = new Array(N); py = new Array(N);
  for (let i = 0; i < N; i++) { px[i] = X(i); py[i] = Y(i); }
  // curvature of line
  const k = new Array(N), seg = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N, b = (i + 1) % N;
    const h1 = Math.atan2(py[i] - py[a], px[i] - px[a]);
    let h2 = Math.atan2(py[b] - py[i], px[b] - px[i]);
    let d = h2 - h1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    seg[i] = Math.hypot(px[b] - px[i], py[b] - py[i]);
    k[i] = d / ((Math.hypot(px[i] - px[a], py[i] - py[a]) + seg[i]) / 2);
  }
  const ks = new Array(N);
  for (let i = 0; i < N; i++) { let m = 0; for (let d = -2; d <= 2; d++) m += k[(i + d + N) % N]; ks[i] = Math.abs(m / 5); }
  const latMax = (v) => (P.A0 + P.C * v * v) * P.SAFE;
  vLim = new Array(N);
  for (let i = 0; i < N; i++) {
    const kk = Math.max(ks[i], 1e-6);
    let v = P.VMAX;
    for (let j = 0; j < 30; j++) { // fixed point: v = sqrt(latMax(v)/k)
      v = Math.min(P.VMAX, Math.sqrt(latMax(v) / kk));
    }
    vLim[i] = v;
  }
  const brk = (v) => P.BR0 + P.BRC * v * v;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const j = (i + 1) % N, v = vLim[j];
      const ay = v * v * ks[j];
      const f = Math.sqrt(Math.max(0.05, 1 - Math.pow(Math.min(1, ay / latMax(v)), 2)));
      vLim[i] = Math.min(vLim[i], Math.sqrt(v * v + 2 * brk(v) * f * seg[i]));
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, v = vLim[i];
      const ay = v * v * ks[i];
      const f = Math.sqrt(Math.max(0.05, 1 - Math.pow(Math.min(1, ay / latMax(v)), 2)));
      const a = Math.min(P.ACC, 740000 / 800 / Math.max(v, 10)) * f;
      vLim[j] = Math.min(vLim[j], Math.sqrt(v * v + 2 * a * seg[i]));
    }
  }
}

let lastI = 0;
export function step(t) {
  const i = Math.floor(t.s / ds) % N;
  const la = P.LA0 + P.LAK * t.speed;
  const j = (i + Math.round(la / ds)) % N;
  const dx = px[j] - t.x, dy = py[j] - t.y;
  const alpha = Math.atan2(Math.sin(Math.atan2(dy, dx) - t.yaw), Math.cos(Math.atan2(dy, dx) - t.yaw));
  const dist = Math.max(1, Math.hypot(dx, dy));
  const delta = Math.atan2(2 * wb * Math.sin(alpha), dist);
  const steer = Math.max(-1, Math.min(1, delta / maxSteer));

  const ahead = (i + Math.round((t.speed * 0.25) / ds)) % N;
  const vT = vLim[ahead];
  const err = vT - t.speed;
  let throttle = 0, brake = 0;
  if (err > 0) {
    const cap = Math.min(1, 0.25 + t.speed / 40) * (1 - 0.6 * Math.abs(steer));
    throttle = Math.min(cap, 0.3 + err * 0.5);
    const lm = (P.A0 + P.C * t.speed * t.speed);
    const use = Math.min(1, Math.abs(t.ay) / lm);
    throttle *= Math.sqrt(Math.max(0, 1 - use * use * 1.1));
    const slip = Math.abs(t.vy) / Math.max(t.vx, 5);
    if (slip > 0.05) throttle *= Math.max(0, 1 - (slip - 0.05) * 15);
  } else if (err < -0.4) brake = Math.min(1, -err * 0.3);
  return { throttle, brake, steer };
}
