let samples,N,ds,L,ms,path,limit,curve,rear;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function init(track,car){
 samples=track.samples;N=samples.length;ds=track.sampleSpacing;L=car.wheelbase;ms=car.maxSteer;rear=L*car.weightFront;
 const nx=samples.map(p=>-Math.sin(p.heading)),ny=samples.map(p=>Math.cos(p.heading));
 const off=new Float64Array(N),xx=new Float64Array(N),yy=new Float64Array(N),ddx=new Float64Array(N),ddy=new Float64Array(N);
 const iterations=Math.min(1800,Math.floor(8000000/N));
 for(let it=0;it<iterations;it++){
  const phase=it/iterations;
  const h=phase<1/6?8:phase<1/3?4:phase<1/2?2:1;
  for(let i=0;i<N;i++){xx[i]=samples[i].x+nx[i]*off[i];yy[i]=samples[i].y+ny[i]*off[i];}
  for(let i=0;i<N;i++){let a=(i+N-h)%N,b=(i+h)%N;ddx[i]=xx[a]+xx[b]-2*xx[i];ddy[i]=yy[a]+yy[b]-2*yy[i];}
  for(let i=0;i<N;i++){let a=(i+N-h)%N,b=(i+h)%N;let g=(ddx[a]+ddx[b]-2*ddx[i])*nx[i]+(ddy[a]+ddy[b]-2*ddy[i])*ny[i];off[i]=clamp(off[i]-0.055*g,-Math.max(0,samples[i].widthRight-1.2),Math.max(0,samples[i].widthLeft-1.2));}
 }
 path=samples.map((p,i)=>({x:p.x+nx[i]*off[i],y:p.y+ny[i]*off[i]}));
 curve=new Float64Array(N);limit=new Float64Array(N);
 let w=Math.max(1,Math.round(4/ds));
 for(let i=0;i<N;i++){let a=path[(i-w+N)%N],b=path[i],c=path[(i+w)%N];let ux=b.x-a.x,uy=b.y-a.y,vx=c.x-b.x,vy=c.y-b.y;curve[i]=2*(ux*vy-uy*vx)/Math.max(1e-6,Math.hypot(ux,uy)*Math.hypot(vx,vy)*Math.hypot(c.x-a.x,c.y-a.y));}
 for(let i=0;i<N;i++){let k=0;for(let j=-2;j<=2;j++)k=Math.max(k,Math.abs(curve[(i+j+N)%N]));limit[i]=Math.min(88,Math.sqrt(16.5/Math.max(0.002,k-0.0025)));}
 for(let pass=0;pass<3;pass++)for(let i=N-1;i>=0;i--){let b=limit[(i+1)%N];let lat=b*b*Math.abs(curve[i]);let reserve=Math.sqrt(Math.max(0.12,1-(lat/(18+0.003*b*b))**2));let decel=(12+0.003*b*b)*reserve;limit[i]=Math.min(limit[i],Math.sqrt(b*b+2*decel*ds));}
}
export function step(t){
 const i=Math.floor(t.s/ds)%N,v=t.speed;
 const look=6+0.30*v;
 const ti=(t.s+look)/ds,j=Math.floor(ti)%N,f=ti-Math.floor(ti),p=path[j],q=path[(j+1)%N];
 let dx=p.x+(q.x-p.x)*f-t.x,dy=p.y+(q.y-p.y)*f-t.y;
 let alpha=Math.atan2(dy,dx)-t.yaw;
 let angle=Math.atan2(2*L*Math.sin(alpha),Math.hypot(dx,dy));
 let kr=curve[(i+Math.round(v*0.12/ds))%N];
 angle-=0.10*(t.yawRate-v*kr);
 let steer=clamp(angle/ms,-1,1);
 const target=limit[(i+Math.round(v*0.20/ds))%N];
 const err=target-v;
 const lat=Math.max(Math.abs(t.ay),Math.abs(v*v*curve[i]));
 const grip=18+0.003*v*v;
 const traction=Math.sqrt(Math.max(0.08,1-(lat/grip)**2));
 const force=Math.min(13600,740000/Math.max(v,1));
 let cap=clamp((7.0+0.0023*v*v)*800/force*traction,0.10,1);
 const slip=Math.abs(Math.atan2(t.vy-rear*t.yawRate,Math.max(4,t.vx)));
 cap*=clamp((0.09-slip)/0.035,0,1);
 let throttle=err>0?Math.min(cap,0.06+err*0.65):0;
 let brake=err<-.25?Math.min(0.55*traction,-err*0.15):0;
 
 return {throttle,brake,steer};
}
