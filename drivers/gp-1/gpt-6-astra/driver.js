// Track-independent path planning and closed-loop control.
let samples, path, vLimit, N, ds, length, wheelbase, maxSteer;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function index(i) { return (i % N + N) % N; }
function interpolate(s) {
  const f = ((s % length + length) % length) / ds;
  const i = Math.floor(f) % N, j = (i + 1) % N, a = f - Math.floor(f);
  return {x:path[i].x*(1-a)+path[j].x*a, y:path[i].y*(1-a)+path[j].y*a};
}
export function init(track, car) {
  samples = track.samples; N = samples.length; ds = track.sampleSpacing; length = track.length;
  wheelbase = car.wheelbase; maxSteer = car.maxSteer;
  path = samples.map(p => ({x:p.x,y:p.y,n:0,nx:-Math.sin(p.heading),ny:Math.cos(p.heading)}));
  // Minimize bending energy subject to a safe corridor. Multiscale relaxation
  // resolves both long sweeping bends and short transitions without track IDs.
  // Bound the initialization work even on unusually long circuits.
  const levels = [16,8,4,2,1];
  for (let level=0;level<levels.length;level++) {
    const h=levels[level], passes=Math.ceil((level===4?700:250)*Math.min(1,3500/N));
    for (let pass=0;pass<passes;pass++) {
      for (let i=0;i<N;i++) {
        const p=path[i], a=path[index(i-h)], b=path[index(i+h)], c=path[index(i-2*h)], d=path[index(i+2*h)];
        const gx=4*(a.x+b.x)-6*p.x-c.x-d.x;
        const gy=4*(a.y+b.y)-6*p.y-c.y-d.y;
        const change=clamp(0.12*(gx*p.nx+gy*p.ny),-0.3,0.3);
        const n=clamp(p.n+change,-Math.max(0,samples[i].widthRight-1.8),Math.max(0,samples[i].widthLeft-1.8));
        p.n=n; p.x=samples[i].x+p.nx*n; p.y=samples[i].y+p.ny*n;
      }
    }
  }
  const curv=new Array(N), seg=new Array(N);
  for(let i=0;i<N;i++) {
    const a=path[index(i-2)],p=path[i],b=path[index(i+2)];
    const ux=p.x-a.x,uy=p.y-a.y,vx=b.x-p.x,vy=b.y-p.y;
    curv[i]=2*(ux*vy-uy*vx)/Math.max(0.01,Math.hypot(ux,uy)*Math.hypot(vx,vy)*Math.hypot(b.x-a.x,b.y-a.y));
    const q=path[(i+1)%N]; seg[i]=Math.hypot(q.x-p.x,q.y-p.y);
  }
  // Downforce raises the lateral acceleration envelope with speed squared.
  vLimit=new Array(N);
  const w=Math.max(1,Math.round(6/ds));
  for(let i=0;i<N;i++) {
    let k=0;
    for(let j=-w;j<=w;j++) k=Math.max(k,Math.abs(curv[index(i+j)]));
    vLimit[i]=Math.min(95,Math.sqrt(17.5/Math.max(k-0.0035,1e-6)));
  }
  // Plan braking backward along the actual path, reserving grip for turning.
  for(let pass=0;pass<3;pass++) for(let i=N-1;i>=0;i--) {
    const next=vLimit[(i+1)%N];
    const lateral=next*next*Math.max(Math.abs(curv[i]),Math.abs(curv[(i+1)%N]));
    const use=clamp(lateral/(18+0.004*next*next),0,0.98);
    const decel=(15+0.003*next*next)*Math.max(0.12,1-use*use);
    vLimit[i]=Math.min(vLimit[i],Math.sqrt(next*next+2*decel*seg[i]));
  }
}
export function step(t) {
  const i=Math.floor(t.s/ds)%N;
  const lookahead=Math.min(40,5.5+0.35*t.speed);
  const target=interpolate(t.s+lookahead);
  const dx=target.x-t.x,dy=target.y-t.y;
  const alpha=Math.atan2(dy,dx)-t.yaw;
  const dist=Math.hypot(dx,dy);
  const steerAngle=Math.atan2(2*wheelbase*Math.sin(alpha),dist);
  // Limit front slip and countersteer early if the rear starts to slide.
  const frontAngle=Math.atan2(t.vy+wheelbase*0.55*t.yawRate,Math.max(1,t.vx));
  const rearSlip=-Math.atan2(t.vy-wheelbase*0.45*t.yawRate,Math.max(1,t.vx));
  const rearExcess=Math.sign(rearSlip)*Math.max(0,Math.abs(rearSlip)-0.075);
  const corrected=steerAngle-0.6*rearExcess;
  const safeAngle=t.speed>8?clamp(corrected,frontAngle-0.105,frontAngle+0.105):corrected;
  const steer=clamp(safeAngle/maxSteer,-1,1);
  // Preview actuator delay; share the available grip between both controls.
  const vTarget=vLimit[(i+Math.round(t.speed*0.3/ds))%N];
  const err=vTarget-t.speed;
  const grip=18+0.004*t.speed*t.speed;
  const use=Math.min(0.95,Math.abs(t.ay)/grip);
  const throttleCap=Math.min(1,0.46+0.00017*t.speed*t.speed)*Math.sqrt(1-use*use);
  const slipScale=clamp((0.12-Math.abs(rearSlip))/0.045,0,1);
  const throttle=err>0?Math.min(throttleCap,0.2+err*0.4)*slipScale:0;
  const brakeCap=Math.min(1,(0.4+0.00012*t.speed*t.speed)*Math.max(0.12,1-use*use));
  const brake=err< -0.5?Math.min(brakeCap,-err*0.25)*slipScale:0;
  return {throttle,brake,steer};
}
