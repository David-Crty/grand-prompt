let N=0, ds=2, L=3.6, maxSteer=0.35, px=[], py=[], vLim=[], lineN=[];
const MARGIN=1.2;
let A0=15.6, AK=0.0033, BR0=15, BRK=0.0028, P=740000, M=800;
function alat(v){return A0+AK*v*v;}
export function init(track, car){
  const S=track.samples; N=S.length; ds=track.sampleSpacing; L=car.wheelbase; maxSteer=car.maxSteer; P=car.maxPower; M=car.mass;
  const cx=S.map(a=>a.x), cy=S.map(a=>a.y), nx=S.map(a=>-Math.sin(a.heading)), ny=S.map(a=>Math.cos(a.heading));
  const lo=S.map(a=>-a.widthRight+MARGIN), hi=S.map(a=>a.widthLeft-MARGIN);
  const n=new Float64Array(N);
  for(let it=0;it<600;it++){
    for(let i=0;i<N;i++){
      const a=(i-1+N)%N,b=(i+1)%N;
      const xa=cx[a]+n[a]*nx[a], ya=cy[a]+n[a]*ny[a], xb=cx[b]+n[b]*nx[b], yb=cy[b]+n[b]*ny[b];
      const xi=cx[i]+n[i]*nx[i], yi=cy[i]+n[i]*ny[i];
      const d=((xa+xb)/2-xi)*nx[i]+((ya+yb)/2-yi)*ny[i];
      let v=n[i]+0.9*d; if(v<lo[i])v=lo[i]; if(v>hi[i])v=hi[i]; n[i]=v;
    }
  }
  lineN=Array.from(n);
  px=new Array(N); py=new Array(N);
  for(let i=0;i<N;i++){px[i]=cx[i]+n[i]*nx[i]; py[i]=cy[i]+n[i]*ny[i];}
  // curvature via circumcircle with +-3 samples
  const k=new Array(N), h=5;
  for(let i=0;i<N;i++){
    const a=(i-h+N)%N,b=(i+h)%N;
    const x1=px[a],y1=py[a],x2=px[i],y2=py[i],x3=px[b],y3=py[b];
    const cr=(x2-x1)*(y3-y1)-(y2-y1)*(x3-x1);
    const d12=Math.hypot(x2-x1,y2-y1),d23=Math.hypot(x3-x2,y3-y2),d13=Math.hypot(x3-x1,y3-y1);
    k[i]=Math.abs(2*cr/(d12*d23*d13+1e-9));
  }
  {const k2=k.slice(); for(let i=0;i<N;i++){let m=0;for(let d=-3;d<=3;d++)m+=k2[(i+d+N)%N]; k[i]=Math.max(m/7, 0.8*k2[i]);}}
  const seg=new Array(N);
  for(let i=0;i<N;i++){const b=(i+1)%N; seg[i]=Math.hypot(px[b]-px[i],py[b]-py[i]);}
  const v=new Array(N);
  for(let i=0;i<N;i++){
    let kk=Math.max(k[i],k[(i+1)%N],k[(i-1+N)%N],1e-5);
    // solve v^2 k = A0 + AK v^2
    const den=kk-AK; v[i]= den<=0?95:Math.min(95,Math.sqrt(A0/den));
  }
  for(let pass=0;pass<3;pass++){
    for(let i=N-1;i>=0;i--){ const j=(i+1)%N; const vj=v[j];
      const kk=k[i]; const al=alat(vj); const lat=Math.min(al, vj*vj*kk);
      const dec=(BR0+BRK*vj*vj)*Math.sqrt(Math.max(0,1-(lat/al)**2));
      v[i]=Math.min(v[i],Math.sqrt(vj*vj+2*dec*seg[i]));}
  }
  // forward pass accel
  for(let pass=0;pass<2;pass++){
    for(let i=0;i<N;i++){ const j=(i+1)%N; const vi=Math.max(v[i],5);
      const acc=Math.min(9, P/(M*vi)) - 0.0012*vi*vi;
      v[j]=Math.min(v[j],Math.sqrt(vi*vi+2*Math.max(0,acc)*seg[i]));}
  }
  vLim=v; globalThis.__k=k;
}
let lastI=-1;
function nearest(t){
  let i0=Math.floor(t.s/ds)%N, best=i0, bd=1e18;
  for(let d=-6;d<=6;d++){const j=(i0+d+N)%N; const dd=(px[j]-t.x)**2+(py[j]-t.y)**2; if(dd<bd){bd=dd;best=j;}}
  return best;
}
export function step(t){
  const i=nearest(t);
  const v=t.speed;
  const look=Math.min(35,6+0.3*v);
  const j=(i+Math.round(look/ds))%N;
  const dx=px[j]-t.x, dy=py[j]-t.y;
  const alpha=Math.atan2(dy,dx)-t.yaw;
  const dist=Math.hypot(dx,dy);
  let st=Math.atan2(2*L*Math.sin(alpha),dist)/maxSteer;
  st-=0.05*t.yawRate*0; 
  st=Math.max(-1,Math.min(1,st));
  const vt=vLim[(i+Math.round(v*0.25/ds))%N];
  const err=vt-v;
  let thr=0, br=0;
  if(err>0){ thr=Math.min(1,0.4+err*0.6); const al=alat(v); const r=Math.min(1,Math.abs(t.ay)/al);
    const cap=Math.min(1, 1.0*al*M*Math.max(v,5)/P)*Math.sqrt(Math.max(0.05,1-r*r)); thr=Math.min(thr,Math.max(0.1,cap));
    if(Math.abs(t.vy)>0.6) thr=Math.min(thr,0.1); }
  else if(err<-0.3){ const r=Math.min(1,Math.abs(t.ay)/alat(v)); br=Math.min(1,-err*0.4)*Math.max(0.25,Math.sqrt(1-r*r)); if(Math.abs(t.vy)>0.5) br*=0.3; thr=0; }
  else thr=0.15;
  return {throttle:thr, brake:br, steer:st};
}
