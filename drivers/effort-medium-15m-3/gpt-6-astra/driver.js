// Baseline driver: follows the centerline with pure pursuit and drives a conservative speed
// computed from track curvature. It finishes laps, slowly. Start here and make it fast.

let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let vLimit = [];

const LATERAL_ACCEL = 17; // m/s^2, deliberately conservative (ignores downforce)
const BRAKE_DECEL = 18; // m/s^2
const MAX_SPEED = 95; // m/s

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  // Minimize bending of a bounded path, using only the supplied geometry.
  const center = samples;
  const nx = center.map(p => -Math.sin(p.heading));
  const ny = center.map(p => Math.cos(p.heading));
  let offsets = new Array(N).fill(0);
  let nextOffsets = new Array(N).fill(0);
  let px = center.map(p => p.x), py = center.map(p => p.y);
  const h = Math.max(1, Math.round(6 / ds));
  for (let iteration = 0; iteration < 1200; iteration++) {
    for (let i = 0; i < N; i++) {
      const a = (i - 2*h + N) % N, b = (i - h + N) % N;
      const c = (i + h) % N, d = (i + 2*h) % N;
      const dx = (-px[a] + 4*px[b] + 4*px[c] - px[d]) / 6 - px[i];
      const dy = (-py[a] + 4*py[b] + 4*py[c] - py[d]) / 6 - py[i];
      const launch = Math.min(1, Math.min(i*ds, (N-i)*ds) / 60);
      const lo = -Math.max(0, center[i].widthRight - 2.5) * launch;
      const hi = Math.max(0, center[i].widthLeft - 2.5) * launch;
      nextOffsets[i] = Math.max(lo, Math.min(hi, offsets[i] + 0.4 * (dx*nx[i] + dy*ny[i])));
    }
    const tmp = offsets; offsets = nextOffsets; nextOffsets = tmp;
    for (let i = 0; i < N; i++) {
      px[i] = center[i].x + nx[i]*offsets[i];
      py[i] = center[i].y + ny[i]*offsets[i];
    }
  }
  samples = center.map((p,i) => ({...p, x:px[i], y:py[i]}));
  for (let i = 0; i < N; i++) {
    const a = (i - 2 + N)%N, b = (i+2)%N;
    const ux=px[i]-px[a], uy=py[i]-py[a], vx=px[b]-px[i], vy=py[b]-py[i];
    samples[i].curvature = 2*(ux*vy-uy*vx) / Math.max(1e-9, Math.hypot(ux,uy)*Math.hypot(vx,vy)*Math.hypot(px[b]-px[a],py[b]-py[a]));
  }

  // Corner speed from the worst curvature within +-10 m.
  const w = Math.max(1, Math.round(10 / ds));
  const vCorner = new Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) k = Math.max(k, Math.abs(samples[(i + d + N) % N].curvature));
    vCorner[i] = Math.min(MAX_SPEED, Math.sqrt(LATERAL_ACCEL / Math.max(k - 0.0025, 1e-6)));
  }

  // Backward pass so we brake in time: v_i <= sqrt(v_{i+1}^2 + 2 a ds). Two loops handle wrap-around.
  vLimit = vCorner.slice();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = vLimit[(i + 1) % N];
      vLimit[i] = Math.min(vLimit[i], Math.sqrt(next * next + 2 * BRAKE_DECEL * Math.sqrt(Math.max(0.12, 1 - Math.pow(Math.abs(samples[i].curvature) * next * next / (20 + 0.003 * next * next), 2))) * Math.min(ds * 1.2, Math.hypot(samples[(i+1)%N].x-samples[i].x, samples[(i+1)%N].y-samples[i].y))));
    }
  }
}

export function step(t) {
  const i = Math.floor(t.s / ds) % N;

  // Pure pursuit: aim at a point on the centerline ahead of the car.
  const lookahead = Math.min(40, 8 + 0.35 * t.speed);
  const target = samples[(i + Math.round(lookahead / ds)) % N];
  const dx = target.x - t.x;
  const dy = target.y - t.y;
  const alpha = Math.atan2(dy, dx) - t.yaw;
  const dist = Math.hypot(dx, dy);
  const steerAngle = Math.atan2(2 * wheelbase * Math.sin(alpha), dist);
  const steer = Math.max(-1, Math.min(1, steerAngle / maxSteer));

  // Speed: look a little ahead to account for actuator delay.
  const vTarget = vLimit[(i + Math.round((t.speed * 0.3) / ds)) % N];
  const err = vTarget - t.speed;
  // Full throttle at low speed spins the rear wheels (traction limited), so cap it by speed and steering.
  const lateral = Math.max(Math.abs(t.ay), t.speed * Math.abs(t.yawRate));
  const grip = 20 + 0.004 * t.speed * t.speed;
  const reserve = Math.sqrt(Math.max(0.08, 1 - Math.pow(lateral / grip, 2)));
  const rearSlip = Math.abs(Math.atan2(t.vy - t.yawRate * wheelbase * 0.55, Math.max(t.vx, 1)));
  const slipCap = Math.max(0, Math.min(1, (0.085 - rearSlip) / 0.045));
  const throttleCap = Math.min(1, Math.max(0.20, t.speed / 65)) * reserve * slipCap;
  const throttle = err > 0 ? Math.min(throttleCap, 0.2 + err * 0.4) : 0;
  const brake = err < -0.5 ? Math.min(0.65 * Math.sqrt(Math.max(0.08, 1 - Math.pow(lateral / grip, 2))), -err * 0.25) : 0;

  return { throttle, brake, steer };
}
