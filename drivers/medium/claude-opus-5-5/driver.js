let S=[],N=0,ds=2,L=3.6,maxSteer=0.35,px=[],py=[],vL=[],kk=[];
const P={aLat0:16,aLatK:0.0038,aBr0:14,aBrK:0.004,margin:0.6,acc0:9,tr0:8,trK:0.003};
function latMax(v){return P.aLat0+P.aLatK*v*v;}
export function init(track,car){
  S=track.samples;N=S.length;ds=track.sampleSpacing;L=car.wheelbase;maxSteer=car.maxSteer;
  const nx=new Float64Array(N),ny=new Float64Array(N),n=new Float64Array(N),lo=new Float64Array(N),hi=new Float64Array(N);
  for(let i=0;i<N;i++){nx[i]=-Math.sin(S[i].heading);ny[i]=Math.cos(S[i].heading);
    hi[i]=S[i].widthLeft-P.margin;lo[i]=-(S[i].widthRight-P.margin);if(hi[i]<lo[i]){hi[i]=lo[i]=0;}}
  const X=new Float64Array(N),Y=new Float64Array(N);
  for(let it=0;it<1500;it++){
    const st=it<500?8:it<1000?4:it<1300?2:1;
    for(let i=0;i<N;i++){X[i]=S[i].x+n[i]*nx[i];Y[i]=S[i].y+n[i]*ny[i];}
    for(let i=0;i<N;i++){const a=(i-st+N)%N,b=(i+st)%N,a2=(i-2*st+N)%N,b2=(i+2*st)%N;
      const mx=(4*X[a]+4*X[b]-X[a2]-X[b2])/6,my=(4*Y[a]+4*Y[b]-Y[a2]-Y[b2])/6;
      let d=(mx-S[i].x)*nx[i]+(my-S[i].y)*ny[i];
      let v=n[i]+0.6*(d-n[i]);
      n[i]=v<lo[i]?lo[i]:v>hi[i]?hi[i]:v;}
  }
  px=new Float64Array(N);py=new Float64Array(N);
  for(let i=0;i<N;i++){px[i]=S[i].x+n[i]*nx[i];py[i]=S[i].y+n[i]*ny[i];}
  kk=new Float64Array(N);const w=3;
  for(let i=0;i<N;i++){const a=(i-w+N)%N,b=(i+w)%N;
    const ax=px[i]-px[a],ay=py[i]-py[a],bx=px[b]-px[i],by=py[b]-py[i];
    const cr=ax*by-ay*bx,la=Math.hypot(ax,ay),lb=Math.hypot(bx,by),lc=Math.hypot(px[b]-px[a],py[b]-py[a]);
    kk[i]=2*cr/(la*lb*lc+1e-9);}
  const seg=new Float64Array(N);for(let i=0;i<N;i++){const b=(i+1)%N;seg[i]=Math.hypot(px[b]-px[i],py[b]-py[i]);}
  const vc=new Float64Array(N);
  for(let i=0;i<N;i++){const k=Math.max(Math.abs(kk[i]),Math.abs(kk[(i+1)%N]),Math.abs(kk[(i-1+N)%N]),1e-5);
    // solve v^2 k = a0 + aK v^2
    const den=k-P.aLatK;vc[i]=den<=0?120:Math.min(120,Math.sqrt(P.aLat0/den));}
  vL=Float64Array.from(vc);
  for(let pass=0;pass<3;pass++){
    for(let i=N-1;i>=0;i--){const j=(i+1)%N,v=vL[j];
      const lat=v*v*Math.abs(kk[j]),lm=latMax(v);const f=Math.sqrt(Math.max(0.05,1-(lat/lm)**2));
      const a=(P.aBr0+P.aBrK*v*v)*f;
      vL[i]=Math.min(vL[i],Math.sqrt(v*v+2*a*seg[i]));}
  }
  // forward pass acceleration (for realism only, not limiting)
  DN=n;log("init N",N);
}
let lastI=-1;
function nearest(t){
  let i=Math.floor(t.s/ds)%N;
  // refine using racing line points nearby
  let best=i,bd=1e18;
  for(let d=-6;d<=6;d++){const j=(i+d+N)%N;const e=(px[j]-t.x)**2+(py[j]-t.y)**2;if(e<bd){bd=e;best=j;}}
  return best;
}
export function step(t){
  const i=nearest(t);const v=Math.max(t.speed,1);
  const la=Math.max(4,Math.min(50,3+0.4*v));
  const k=Math.round(la/ds);const j=(i+k)%N;
  const dx=px[j]-t.x,dy=py[j]-t.y;
  const alpha=Math.atan2(dy,dx)-t.yaw;const dist=Math.hypot(dx,dy);
  let sa=Math.atan2(2*L*Math.sin(alpha),dist);
  const kf=kk[(i+3)%N];const cap=L*1.3*latMax(v)/(v*v)+0.01;sa=Math.max(-cap,Math.min(cap,sa));sa-=0.05*(t.yawRate-v*kf);
  const steer=Math.max(-1,Math.min(1,sa/maxSteer));
  const vt=vL[(i+Math.round((v*0.12)/ds))%N];
  const err=vt-v;
  let thr=0,br=0;
  if(err>0){const g=latMax(v),ay=Math.max(Math.abs(t.ay),v*v*Math.abs(kf));let axA=Math.min(P.tr0+P.trK*v*v,0.1*g+0.5*Math.sqrt(Math.max(0,g*g-ay*ay)));if(Math.abs(t.vy)>0.05*v+0.3)axA*=0.4;const F=800*axA+0.5*v*v;const cap=Math.min(1,Math.max(0.1,F*v/740000));thr=Math.min(cap,0.3+err*0.5);}
  else {thr=err>-0.5?0.15:0;br=err<-0.5?Math.min(1,-err*0.35):0;}
  if(Math.abs(t.vy)>0.035*v+0.3){br*=0.3;}
  if(t.lapTime<4&&Math.round(t.lapTime*50)%4==0)log(t.s.toFixed(1),t.n.toFixed(2),t.speed.toFixed(1),steer.toFixed(3),t.steer.toFixed(3),t.headingError.toFixed(3),i,vt.toFixed(1));
  return{throttle:thr,brake:br,steer};
}
let DN;export function dbg(){return{n:DN,kk,vL};}
