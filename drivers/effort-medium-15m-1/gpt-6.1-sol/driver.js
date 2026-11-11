let samples, path, N, ds, wb, ms, vl, length;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function init(track,car){
 samples=track.samples; N=samples.length;ds=track.sampleSpacing;length=track.length;wb=car.wheelbase;ms=car.maxSteer;
 path=samples.map(p=>({x:p.x,y:p.y,n:0,k:0}));
 const normals=samples.map(p=>({x:-Math.sin(p.heading),y:Math.cos(p.heading)}));
 for(let iter=0;iter<1100;iter++)for(let i=0;i<N;i++){
  const a=path[(i+N-2)%N],b=path[(i+N-1)%N],c=path[(i+1)%N],d=path[(i+2)%N],s=samples[i],norm=normals[i];
  const qx=(4*(b.x+c.x)-a.x-d.x)/6,qy=(4*(b.y+c.y)-a.y-d.y)/6;
  let off=clamp((qx-s.x)*norm.x+(qy-s.y)*norm.y,-s.widthRight+1.2,s.widthLeft-1.2);
  const edge=Math.min(s.s,length-s.s);const blend=clamp(edge/65,0,1);off=clamp(off,-(s.widthRight-1.2)*blend,(s.widthLeft-1.2)*blend);
  path[i].x=s.x+norm.x*off;path[i].y=s.y+norm.y*off;path[i].n=off;
 }
 for(let i=0;i<N;i++){
  const a=path[(i+N-1)%N],b=path[i],c=path[(i+1)%N];
  const ux=b.x-a.x,uy=b.y-a.y,vx=c.x-b.x,vy=c.y-b.y;
  b.k=2*(ux*vy-uy*vx)/(Math.hypot(ux,uy)*Math.hypot(vx,vy)*Math.hypot(c.x-a.x,c.y-a.y));
 }
 vl=path.map((p,i)=>{
  let k=0;for(let j=-5;j<=5;j++) k=Math.max(k,Math.abs(path[(i+j+N)%N].k));
  return Math.min(90,Math.sqrt(14/Math.max(.00001,k-.0025)));
 });
 for(let pass=0;pass<3;pass++)for(let i=N-1;i>=0;i--){
  const j=(i+1)%N,v=vl[j];const d=Math.hypot(path[i].x-path[j].x,path[i].y-path[j].y);
  const lateral=v*v*Math.abs(path[i].k);const grip=17+.003*v*v;
  const decel=Math.max(6,Math.sqrt(Math.max(0,grip*grip-lateral*lateral))*.65);
  vl[i]=Math.min(vl[i],Math.sqrt(v*v+2*decel*d));
 }
}
export function step(t){
 const i=Math.floor(t.s/ds)%N;
 const look=6+.34*t.speed;
 const f=(t.s+look)/ds,idx=Math.floor(f)%N,u=f-Math.floor(f),a=path[idx],b=path[(idx+1)%N];
 const dx=a.x+(b.x-a.x)*u-t.x,dy=a.y+(b.y-a.y)*u-t.y;
 const alpha=Math.atan2(dy,dx)-t.yaw,dist=Math.hypot(dx,dy);
 let steer=Math.atan2(2*wb*Math.sin(alpha),dist)/ms;
 steer=clamp(steer,-1,1);
 const target=vl[Math.floor((t.s+t.speed*.3)/ds)%N];
 const err=target-t.speed;
 const usage=clamp(Math.abs(t.ay)/(19+.004*t.speed*t.speed),0,.97);
 const cap=clamp(.34+t.speed/95,.3,1)*Math.sqrt(1-usage*usage)*(1-.2*Math.abs(steer));
 return {steer, throttle:err>0?Math.min(cap,.15+err*.45):0, brake:err<-.2?Math.min(.65*Math.sqrt(1-usage*usage),-err*.22):0};
}
