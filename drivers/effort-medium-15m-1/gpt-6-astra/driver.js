// Baseline driver: follows the centerline with pure pursuit and drives a conservative speed
// computed from track curvature. It finishes laps, slowly. Start here and make it fast.

let samples = [];
let N = 0;
let ds = 2;
let wheelbase = 3.6;
let maxSteer = 0.35;
let vLimit = [];

const LATERAL_ACCEL = 18; // m/s^2, deliberately conservative (ignores downforce)
const BRAKE_DECEL = 17; // m/s^2
const MAX_SPEED = 90; // m/s

export function init(track, car) {
  samples = track.samples;
  N = samples.length;
  ds = track.sampleSpacing;
  wheelbase = car.wheelbase;
  maxSteer = car.maxSteer;

  // Smooth a path inside the road by reducing changes in curvature at several scales.
  const original = samples;
  const offsets = new Array(N).fill(0);
  const nx = original.map(p => -Math.sin(p.heading));
  const ny = original.map(p => Math.cos(p.heading));
  const px = original.map(p => p.x), py = original.map(p => p.y);
  const ddx = new Array(N), ddy = new Array(N);
  for (let pass=0; pass<180; pass++) {
    for (const q of [8,4,2,1]) {
      for (let i=0;i<N;i++) {
        const a=(i-q+N)%N,b=(i+q)%N;
        ddx[i]=px[a]-2*px[i]+px[b];
        ddy[i]=py[a]-2*py[i]+py[b];
      }
      for (let i=0;i<N;i++) {
        const a=(i-q+N)%N,b=(i+q)%N;
        const grad=(ddx[a]-2*ddx[i]+ddx[b])*nx[i]+(ddy[a]-2*ddy[i]+ddy[b])*ny[i];
        offsets[i]=Math.max(-original[i].widthRight+2,Math.min(original[i].widthLeft-2,offsets[i]-0.055*grad));
        px[i]=original[i].x+nx[i]*offsets[i];
        py[i]=original[i].y+ny[i]*offsets[i];
      }
    }
  }
  samples = original.map((p,i) => {
    const a=(i-2+N)%N,b=(i+2)%N;
    const ux=px[i]-px[a],uy=py[i]-py[a],vx=px[b]-px[i],vy=py[b]-py[i];
    const k=2*(ux*vy-uy*vx)/Math.max(1e-6,Math.hypot(ux,uy)*Math.hypot(vx,vy)*Math.hypot(ux+vx,uy+vy));
    return {...p,x:px[i],y:py[i],curvature:k};
  });

  // Corner speed from the worst curvature within +-10 m.
  const w = Math.max(1, Math.round(7 / ds));
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
      vLimit[i] = Math.min(vLimit[i], Math.sqrt(next * next + 2 * Math.min(BRAKE_DECEL, Math.max(4, 14 * Math.sqrt(Math.max(0, 1 - Math.pow(next * next * Math.max(Math.abs(samples[i].curvature), Math.abs(samples[(i+1)%N].curvature)) / (19 + 0.0025 * next * next), 2))))) * ds));
    }
  }
}

export function step(t) {
  const i = Math.floor(t.s / ds) % N;

  // Pure pursuit: aim at a point on the centerline ahead of the car.
  const lookahead = Math.min(40, 6 + 0.32 * t.speed);
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
  const throttleCap = Math.min(1, Math.max(0.3, t.speed / 55)) * (1 - 0.6 * Math.abs(steer));
  const rearSlip = Math.abs(Math.atan2(t.vy - 1.62 * t.yawRate, Math.max(1,t.vx)));
  const traction = Math.max(0, Math.min(1, (0.085 - rearSlip)/0.04));
  const throttle = err > 0 ? traction * Math.min(throttleCap, 0.2 + err * 0.4) : 0;
  const brake = err < -0.5 ? Math.max(0, Math.min(1, (0.09-rearSlip)/0.035)) * Math.min(0.32+0.00006*t.speed*t.speed, -err * 0.25) : 0;

  return { throttle, brake, steer };
}
