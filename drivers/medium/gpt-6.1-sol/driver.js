// Baseline driver: follows the centerline with pure pursuit and drives a conservative speed
// computed from track curvature. It finishes laps, slowly. Start here and make it fast.

let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let carRear = 1.62;
let vLimit = [];

const LATERAL_ACCEL = 17; // m/s^2, deliberately conservative (ignores downforce)
const BRAKE_DECEL = 16; // m/s^2
const MAX_SPEED = 90; // m/s

export function init(track, car) {
  samples = track.samples.map(p => ({...p}));
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;
  carRear = car.wheelbase * car.weightFront;

  // Smooth a bounded racing line by minimizing bending energy at several scales.
  const base = track.samples;
  const nx = base.map(p => -Math.sin(p.heading));
  const ny = base.map(p => Math.cos(p.heading));
  const offset = new Array(N).fill(0);
  for (const stride of [16, 8, 4, 2, 1]) {
    const rounds = stride === 1 ? 160 : 80;
    for (let it = 0; it < rounds; it++) {
      for (let j = 0; j < N; j++) {
        const i = it % 2 ? N-1-j : j;
        const a = samples[(i-stride+N)%N], b = samples[(i+stride)%N];
        const c = samples[(i-2*stride+N)%N], d = samples[(i+2*stride)%N];
        const p = samples[i];
        const dx = (4*(a.x+b.x)-c.x-d.x)/6-p.x;
        const dy = (4*(a.y+b.y)-c.y-d.y)/6-p.y;
        const val = Math.max(-Math.max(0,base[i].widthRight-2.5), Math.min(Math.max(0,base[i].widthLeft-2.5),offset[i]+0.8*(dx*nx[i]+dy*ny[i])));
        offset[i]=val;
        p.x=base[i].x+val*nx[i]; p.y=base[i].y+val*ny[i];
      }
    }
  }
  for (let i=0;i<N;i++) {
    const a=samples[(i-3+N)%N], b=samples[i], c=samples[(i+3)%N];
    const ux=b.x-a.x, uy=b.y-a.y, vx=c.x-b.x, vy=c.y-b.y;
    samples[i].curvature=2*(ux*vy-uy*vx)/Math.max(1e-9,Math.hypot(ux,uy)*Math.hypot(vx,vy)*Math.hypot(c.x-a.x,c.y-a.y));
  }

  // Corner speed from the worst curvature within +-10 m.
  const w = Math.max(1, Math.round(6 / ds));
  const vCorner = new Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let d = -w; d <= w; d++) k = Math.max(k, Math.abs(samples[(i + d + N) % N].curvature));
    vCorner[i] = Math.min(MAX_SPEED, Math.sqrt(LATERAL_ACCEL / Math.max(k - 0.0013, 1e-6)));
  }

  // Backward pass so we brake in time: v_i <= sqrt(v_{i+1}^2 + 2 a ds). Two loops handle wrap-around.
  vLimit = vCorner.slice();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = vLimit[(i + 1) % N];
      vLimit[i] = Math.min(vLimit[i], Math.sqrt(next * next + 2 * BRAKE_DECEL * ds));
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
  const rearSlip = Math.atan2(carRear * t.yawRate - t.vy, Math.max(5,t.vx));
  const stability = t.speed > 20 ? 0.65 * Math.sign(rearSlip) * Math.max(0,Math.abs(rearSlip)-0.06) : 0;
  const steer = Math.max(-1, Math.min(1, (steerAngle-stability) / maxSteer));

  // Speed: look a little ahead to account for actuator delay.
  const vTarget = vLimit[(i + Math.round((t.speed * 0.3) / ds)) % N];
  const err = vTarget - t.speed;
  // Full throttle at low speed spins the rear wheels (traction limited), so cap it by speed and steering.
  const throttleCap = Math.min(1, 0.3 + t.speed / 80) * (1 - 0.65 * Math.min(1, Math.abs(t.ay) / (20 + 0.004 * t.speed*t.speed)));
  const throttle = err > 0 ? Math.min(throttleCap, 0.2 + err * 0.4) : 0;
  const brake = err < -0.5 ? Math.min(1, -err * 0.25) : 0;

  return { throttle, brake, steer };
}
