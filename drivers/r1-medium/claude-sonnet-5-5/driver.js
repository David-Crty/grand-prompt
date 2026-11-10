let N=0,ds=2,wb=3.6,maxSteer=0.35;
let px=[],py=[],vLimit=[],vK=[];
const P={A:12,B:0.004,b0:11,b1:0.0012,margin:1.3,vmax:95,G:14,GB:0.002};
export function init(track,car){
  const S=track.samples;N=S.length;ds=track.sampleSpacing;wb=car.wheelbase;maxSteer=car.maxSteer;
  const lo=[],hi=[],n=new Array(N).fill(0);
  for(let i=0;i<N;i++){lo[i]=-(S[i].widthRight-P.margin-1.0);hi[i]=S[i].widthLeft-P.margin-1.0;if(lo[i]>hi[i]){lo[i]=hi[i]=0}}
  // hi/lo: margin from edge incl half car width
  for(let it=0;it<1500;it++){
    for(let i=0;i<N;i++){
      const a=(i+N-1)%N,b=(i+1)%N,h=S[i].heading;
      const ax=S[a].x-Math.sin(S[a].heading)*n[a],ay=S[a].y+Math.cos(S[a].heading)*n[a];
      const bx=S[b].x-Math.sin(S[b].heading)*n[b],by=S[b].y+Math.cos(S[b].heading)*n[b];
      const mx=(ax+bx)/2-S[i].x,my=(ay+by)/2-S[i].y;
      const v=-Math.sin(h)*mx+Math.cos(h)*my;
      n[i]=Math.max(lo[i],Math.min(hi[i],n[i]+0.6*(v-n[i])));
    }
  }
  for(let i=0;i<N;i++){const h=S[i].heading;px[i]=S[i].x-Math.sin(h)*n[i];py[i]=S[i].y+Math.cos(h)*n[i];}
  // curvature of line via 3-point (spacing 3 samples)
  const k=[];const w=3;
  for(let i=0;i<N;i++){
    const a=(i-w+N)%N,b=(i+w)%N;
    const h1=Math.atan2(py[i]-py[a],px[i]-px[a]),h2=Math.atan2(py[b]-py[i],px[b]-px[i]);
    let d=h2-h1;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;
    k[i]=Math.abs(d)/(w*ds);
  }
  const kk=[];
  for(let i=0;i<N;i++){let m=0;for(let d=-3;d<=3;d++)m=Math.max(m,k[(i+d+N)%N]);kk[i]=m}
  vLimit=new Array(N);
  for(let i=0;i<N;i++){
    // v^2 * k = A + B v^2 -> v^2 = A/(k-B)
    const den=kk[i]-P.B;
    vLimit[i]=den<=1e-6?P.vmax:Math.min(P.vmax,Math.sqrt(P.A/den));
  }
  for(let pass=0;pass<2;pass++)for(let i=N-1;i>=0;i--){
    const nx=vLimit[(i+1)%N];
    const v0=vLimit[i];
    const G=P.A+P.B*nx*nx;
    const al=nx*nx*kk[i];
    const f=Math.sqrt(Math.max(0.05,1-Math.pow(Math.min(1,al/G),2)));
    const dec=(P.b0+P.b1*nx*nx)*f;
    vLimit[i]=Math.min(v0,Math.sqrt(nx*nx+2*dec*ds));
  }
}
export function step(t){
  const i=Math.floor(t.s/ds)%N;
  const look=Math.min(30,5+0.22*t.speed);
  const j=(i+Math.round(look/ds))%N;
  const dx=px[j]-t.x,dy=py[j]-t.y;
  const al=Math.atan2(dy,dx)-t.yaw;
  const dist=Math.hypot(dx,dy);
  const sa=Math.atan2(2*wb*Math.sin(al),dist);
  const steer=Math.max(-1,Math.min(1,sa/maxSteer));
  const vT=vLimit[(i+Math.round(t.speed*0.25/ds))%N];
  const err=vT-t.speed;
  const cap=Math.min(1,Math.max(0.35,t.speed/45))*(1-0.6*Math.abs(steer));
  const q=Math.min(1,Math.abs(t.ay)/(P.G+P.GB*t.speed*t.speed));
  const fc=Math.sqrt(Math.max(0,1-q*q));
  const throttle=err>0?Math.min(cap,fc,0.1+err*0.3):0;
  const brake=err<-0.3?Math.min(1,-err*0.3):0;
  return{throttle,brake,steer};
}
