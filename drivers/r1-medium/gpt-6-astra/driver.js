let p=[], N=0, ds=2, wb=3.6, ms=.35, line=[], vl=[], curv=[];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function interp(a,s){let u=((s/ds)%N+N)%N,i=Math.floor(u),f=u-i;return a[i]*(1-f)+a[(i+1)%N]*f;}
export function init(track,car){
 p=track.samples;N=p.length;ds=track.sampleSpacing;wb=car.wheelbase;ms=car.maxSteer;
 const nx=p.map(q=>-Math.sin(q.heading)),ny=p.map(q=>Math.cos(q.heading));
 const off=new Array(N).fill(0),x=p.map(q=>q.x),y=p.map(q=>q.y);
 for(const h of [8,4,2,1]){
  for(let it=0;it<Math.min(500,Math.floor(1500000/N));it++){
   for(let j=0;j<N;j++){
    let i=it%2?N-1-j:j,a=(i-h+N)%N,b=(i+h)%N,c=(i-2*h+N)%N,d=(i+2*h)%N;
    let tx=(4*(x[a]+x[b])-x[c]-x[d])/6,ty=(4*(y[a]+y[b])-y[c]-y[d])/6;
    const start=clamp(Math.min(p[i].s,track.length-p[i].s)/35,0,1);
    let n=clamp((tx-p[i].x)*nx[i]+(ty-p[i].y)*ny[i],-Math.max(0,p[i].widthRight-1.8)*start,Math.max(0,p[i].widthLeft-1.8)*start);
    n=off[i]+.7*(n-off[i]);off[i]=n;x[i]=p[i].x+nx[i]*n;y[i]=p[i].y+ny[i]*n;
   }
  }
 }
 line=x.map((v,i)=>({x:v,y:y[i]}));curv=[];
 for(let i=0;i<N;i++){
  let a=line[(i-2+N)%N],b=line[i],c=line[(i+2)%N];
  let ux=b.x-a.x,uy=b.y-a.y,vx=c.x-b.x,vy=c.y-b.y;
  curv[i]=2*(ux*vy-uy*vx)/Math.max(1e-9,Math.hypot(ux,uy)*Math.hypot(vx,vy)*Math.hypot(c.x-a.x,c.y-a.y));
 }
 vl=new Array(N);
 for(let i=0;i<N;i++){
  let k=0;for(let d=-3;d<=3;d++)k=Math.max(k,Math.abs(curv[(i+d+N)%N]));
  vl[i]=Math.min(90,Math.sqrt(15.5/Math.max(k-.0025,.0001)));
 }
 for(let pass=0;pass<3;pass++)for(let i=N-1;i>=0;i--){let j=(i+1)%N,v=vl[j],dist=Math.hypot(x[j]-x[i],y[j]-y[i]);vl[i]=Math.min(vl[i],Math.sqrt(v*v+2*(12+.003*v*v)*dist));}
}
export function step(t){
 let look=6+.30*t.speed,u=((t.s+look)/ds)%N,i=Math.floor(u),f=u-i;
 let a=line[i],b=line[(i+1)%N],dx=a.x+(b.x-a.x)*f-t.x,dy=a.y+(b.y-a.y)*f-t.y;
 let alpha=Math.atan2(dy,dx)-t.yaw;
 let steer=clamp(Math.atan2(2*wb*Math.sin(alpha),Math.hypot(dx,dy))/ms,-1,1);
 let target=interp(vl,t.s+.28*t.speed),err=target-t.speed;
 let lat=Math.max(Math.abs(t.ay),t.speed*t.speed*Math.abs(interp(curv,t.s+6)));
 let fraction=clamp(lat/(18+.004*t.speed*t.speed),0,1);
 let cap=Math.min(1,Math.max(.28,t.speed/55),(.50+.00012*t.speed*t.speed)*Math.sqrt(1-fraction*fraction));
 let signedSlip=Math.atan2(t.vy-t.yawRate*wb*.45,Math.max(3,t.vx));
 let rearSlip=Math.abs(signedSlip);
 if(t.vx>20)steer=clamp(steer+Math.sign(signedSlip)*Math.max(0,rearSlip-.045)/ms,-1,1);
 cap*=clamp((.075-rearSlip)/.035,0,1);
 let throttle=err>0?Math.min(cap,.16+.4*err):0;
 let brake=err<-.35?Math.min(.85,-err*.24):0;
 if(t.vx>20)brake*=clamp((.12-rearSlip)/.065,.2,1);
 return {throttle,brake,steer};
}
