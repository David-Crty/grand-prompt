// Geometry-only racing line and a load-sensitive speed envelope.
let samples, path, curvature, limits, N, ds, length, wheelbase, maxSteer;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const wrap=(i)=>(i%N+N)%N;
function index(s){s=(s%length+length)%length;return s/ds;}
function at(arr,s){const q=index(s),i=Math.floor(q),f=q-i;return arr[i%N]*(1-f)+arr[(i+1)%N]*f;}
function speedAt(s){
 const q=clamp(s/ds,0,N-1),i=Math.floor(q),f=q-i;
 return limits[i]*(1-f)+limits[Math.min(N-1,i+1)]*f;
}
function brakingGrip(v,lat,base,aero){
 const grip=base+aero*v*v;
 const B=2*.55*grip*.18, C=.55*.55*(lat*lat-grip*grip), A=.38*.38-.18*.18;
 return Math.max(0,(-B+Math.sqrt(Math.max(0,B*B-4*A*C)))/(2*A));
}
function point(s){const q=index(s),i=Math.floor(q)%N,j=(i+1)%N,f=q-Math.floor(q);return {x:path[i].x*(1-f)+path[j].x*f,y:path[i].y*(1-f)+path[j].y*f};}
export function init(track,car){
 samples=track.samples;N=samples.length;ds=track.sampleSpacing;length=track.length;wheelbase=car.wheelbase;maxSteer=car.maxSteer;
 const nx=samples.map(p=>-Math.sin(p.heading)),ny=samples.map(p=>Math.cos(p.heading));
 const offsets=new Array(N).fill(0);path=samples.map(p=>({x:p.x,y:p.y}));
 // Relax the squared bending of the path on progressively finer scales.
 for(const [w,iterations] of [[8,350],[4,500],[2,250],[1,150]]){
  for(let it=0;it<iterations;it++){
   for(let i=0;i<N;i++){
    const a=path[wrap(i-2*w)],b=path[wrap(i-w)],c=path[i],d=path[wrap(i+w)],e=path[wrap(i+2*w)];
    const gx=a.x-4*b.x+6*c.x-4*d.x+e.x,gy=a.y-4*b.y+6*c.y-4*d.y+e.y;
    const n=clamp(offsets[i]-.06*(gx*nx[i]+gy*ny[i]),-Math.max(0,samples[i].widthRight-2),Math.max(0,samples[i].widthLeft-2));
    offsets[i]=n;path[i].x=samples[i].x+n*nx[i];path[i].y=samples[i].y+n*ny[i];
   }
  }
 }
 curvature=new Array(N);
 for(let i=0;i<N;i++){
  const a=path[wrap(i-2)],b=path[i],c=path[wrap(i+2)];
  const ux=b.x-a.x,uy=b.y-a.y,vx=c.x-b.x,vy=c.y-b.y;
  curvature[i]=2*(ux*vy-uy*vx)/Math.max(.001,Math.hypot(ux,uy)*Math.hypot(vx,vy)*Math.hypot(c.x-a.x,c.y-a.y));
 }
 limits=new Array(N);
 for(let i=0;i<N;i++){
  let k=0;
  for(let j=-2;j<=2;j++)k=Math.max(k,Math.abs(curvature[wrap(i+j)]));
  limits[i]=Math.min(95,Math.sqrt(16.5/Math.max(.0001,k-.0039)));
 }
 for(let i=N-2;i>=0;i--){
  const j=(i+1)%N,v=limits[j],lat=v*v*Math.abs(curvature[j]);
  const decel=Math.max(3,.84*brakingGrip(v,lat,18,.0045))+.0011*v*v;
  const dist=Math.hypot(path[j].x-path[i].x,path[j].y-path[i].y);
  limits[i]=Math.min(limits[i],Math.sqrt(v*v+2*decel*dist));
 }
}
let logTick=0,yawFiltered=0;
export function step(t){
 const v=t.speed,beta=Math.atan2(t.vy,Math.max(1,t.vx));
 const look=7+.30*v,target=point(t.s+look);
 const dx=target.x-t.x,dy=target.y-t.y,dist=Math.max(1,Math.hypot(dx,dy));
 const alpha=Math.atan2(dy,dx)-t.yaw-beta;
 const k=2*Math.sin(alpha)/dist;
 yawFiltered += .5*(t.yawRate-yawFiltered);
 let delta=Math.atan(wheelbase*k)+.00024*v*v*k-.22*(yawFiltered-v*k);
 const steer=clamp(delta/maxSteer,-1,1);
 const vt=speedAt(t.s+v*.20),err=vt-v;
 const grip=17+.004*v*v;
 const lat=Math.max(Math.abs(t.ay),Math.abs(k)*v*v);
 const fraction=clamp(lat/grip,0,.98);
 const driveCap=(10+.0033*v*v)*Math.sqrt(1-fraction*fraction);
 const drag=.0011*v*v+.12;
 const engine=Math.min(17.5,925/Math.max(v,1));
 let throttle=0,brake=0;
 const ff=vt*(speedAt(t.s+v*.20+3)-speedAt(t.s+v*.20-3))/6;
 const demand=ff+6*err+drag;
 if(demand>0)throttle=clamp(demand/engine,0,Math.min(1,driveCap/engine));
 else{
  const brakeCap=.92*brakingGrip(v,lat,19,.0048);
  brake=clamp(-demand/42.5,0,Math.min(1,brakeCap/42.5));
 }
 const rearSlip=Math.abs(Math.atan2(1.62*t.yawRate-t.vy,Math.max(1,t.vx)));
 const slipScale=clamp((.075-rearSlip)/.025,0,1);
 throttle*=slipScale;brake*=slipScale;
 // Avoid feeding power into a rear slide.
 if(Math.abs(beta)>.16&&v>18)throttle*=clamp(1-(Math.abs(beta)-.16)*7,0,1);
 if(logTick++%20===0)log([t.s,v,vt,at(curvature,t.s),k,t.n,beta,t.ay,ff,throttle,brake].map(x=>Math.round(x*10000)/10000).join(","));
 return {throttle,brake,steer};
}
