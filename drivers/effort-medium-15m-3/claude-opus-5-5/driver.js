let S=[],N=0,ds=2,L=3.6,maxSteer=0.35,mass=800,P=740000;
let px=[],py=[],vT=[],kL=[];
const P_ = {A0:15,A1:0.006,B0:13,B1:0.006,margin:1.2,lat:0.95};
export function init(track,car){
  S=track.samples;N=S.length;ds=track.sampleSpacing;L=car.wheelbase;maxSteer=car.maxSteer;mass=car.mass;P=car.maxPower;
  const nx=new Float64Array(N),ny=new Float64Array(N),cx=new Float64Array(N),cy=new Float64Array(N);
  const lo=new Float64Array(N),hi=new Float64Array(N),n=new Float64Array(N);
  for(let i=0;i<N;i++){const s=S[i];nx[i]=-Math.sin(s.heading);ny[i]=Math.cos(s.heading);cx[i]=s.x;cy[i]=s.y;
    lo[i]=-s.widthRight+P_.margin;hi[i]=s.widthLeft-P_.margin;if(lo[i]>hi[i]){lo[i]=hi[i]=(lo[i]+hi[i])/2;}}
  // minimize curvature: relaxation at multiple scales
  const scales=[16,8,4,2,1];
  for(const k of scales){
    for(let it=0;it<150;it++){
      for(let i=0;i<N;i++){
        const a=(i-k+N)%N,b=(i+k)%N;
        const mx=(cx[a]+nx[a]*n[a]+cx[b]+nx[b]*n[b])/2, my=(cy[a]+ny[a]*n[a]+cy[b]+ny[b]*n[b])/2;
        let v=(mx-cx[i])*nx[i]+(my-cy[i])*ny[i];
        v=n[i]+0.8*(v-n[i]);
        n[i]=v<lo[i]?lo[i]:v>hi[i]?hi[i]:v;
      }
    }
  }
  px=new Float64Array(N);py=new Float64Array(N);
  for(let i=0;i<N;i++){px[i]=cx[i]+nx[i]*n[i];py[i]=cy[i]+ny[i]*n[i];}
  kL=new Float64Array(N);
  const h=3;
  for(let i=0;i<N;i++){
    const a=(i-h+N)%N,b=(i+h)%N;
    const ax=px[i]-px[a],ay=py[i]-py[a],bx=px[b]-px[i],by=py[b]-py[i];
    const cr=ax*by-ay*bx, la=Math.hypot(ax,ay),lb=Math.hypot(bx,by),lc=Math.hypot(px[b]-px[a],py[b]-py[a]);
    kL[i]=2*cr/(la*lb*lc+1e-9);
  }
  // smooth curvature a bit
  const k2=new Float64Array(N);
  for(let i=0;i<N;i++){k2[i]=(kL[(i-1+N)%N]+2*kL[i]+kL[(i+1)%N])/4;}
  kL=k2;
  // segment lengths
  const seg=new Float64Array(N);
  for(let i=0;i<N;i++){const b=(i+1)%N;seg[i]=Math.hypot(px[b]-px[i],py[b]-py[i]);}
  vT=new Float64Array(N);
  for(let i=0;i<N;i++){const k=Math.abs(kL[i]);
    let v= k>P_.A1? Math.sqrt(P_.A0/(k-P_.A1)) : 95; vT[i]=Math.min(95,v*P_.lat);}
  for(let pass=0;pass<3;pass++) for(let i=N-1;i>=0;i--){const nx_=vT[(i+1)%N];
    const dec0=P_.B0+P_.B1*nx_*nx_; const al=P_.A0+P_.A1*nx_*nx_; const u=Math.min(0.95,nx_*nx_*Math.abs(kL[i])/al); const dec=dec0*Math.sqrt(1-u*u); const v=Math.sqrt(nx_*nx_+2*dec*seg[i]); if(v<vT[i])vT[i]=v;}
}
let last=0;
export function step(t){
  const i=Math.floor(t.s/ds)%N;
  const v=Math.max(t.speed,1);
  // find nearest racing-line point near i
  let best=i,bd=1e18;
  for(let d=-6;d<=6;d++){const j=(i+d+N)%N;const dd=(px[j]-t.x)**2+(py[j]-t.y)**2;if(dd<bd){bd=dd;best=j;}}
  const la=Math.max(6,Math.min(35,4+0.28*v));
  const j=(best+Math.round(la/ds))%N;
  const dx=px[j]-t.x,dy=py[j]-t.y;
  const alpha=Math.atan2(dy,dx)-t.yaw;
  const dist=Math.hypot(dx,dy);
  let ang=Math.atan2(2*L*Math.sin(alpha),dist);
  // yaw damping
  const kAhead=kL[(best+Math.round(0.3*v/ds))%N];
  ang+= 0.08*(kAhead*v - t.yawRate);
  const steer=Math.max(-1,Math.min(1,ang/maxSteer));
  const vt=vT[(best+Math.round(v*0.25/ds))%N];
  const err=vt-t.speed;
  let thr=0,brk=0;
  // traction-limited throttle cap
  const latUse=Math.min(1,Math.abs(t.ay)/(P_.A0+P_.A1*v*v));
  let cap=Math.min(1,0.25+v/45)*Math.max(0.15,1-latUse*latUse);
  if(err>0){thr=Math.min(cap,0.3+err*0.5);}
  else if(err<-0.3){brk=Math.min(Math.max(0.25,Math.sqrt(Math.max(0,1-latUse*latUse))),-err*0.3);}
  const slip=Math.abs(t.vy);
  if(slip>1.2){brk=Math.min(brk,0.1);thr=Math.min(thr,0.1);}
  if(t.lapTime<0.05)log('v0',t.speed,'N',N);
  if(Math.floor(t.lapTime)!==last){last=Math.floor(t.lapTime);if(last%5===0)log(t.s.toFixed(0),t.speed.toFixed(1),vt.toFixed(1),t.n.toFixed(2));}
  return {throttle:thr,brake:brk,steer};
}
