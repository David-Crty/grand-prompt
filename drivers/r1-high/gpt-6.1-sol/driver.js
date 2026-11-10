let samples,N,ds,wb,ms,pathX,pathY,offset,curv,vLimit;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=(a)=>Math.atan2(Math.sin(a),Math.cos(a));
export function init(track,car){
 samples=track.samples;N=samples.length;ds=track.sampleSpacing;wb=car.wheelbase;ms=car.maxSteer;
 pathX=new Float64Array(N);pathY=new Float64Array(N);offset=new Float64Array(N);
 const nx=new Float64Array(N),ny=new Float64Array(N), lo=new Float64Array(N),hi=new Float64Array(N);
 for(let i=0;i<N;i++){pathX[i]=samples[i].x;pathY[i]=samples[i].y;nx[i]=-Math.sin(samples[i].heading);ny[i]=Math.cos(samples[i].heading);const d=Math.min(samples[i].s,track.length-samples[i].s);const f=1-Math.exp(-d*d/900);lo[i]=(-samples[i].widthRight+1.65)*f;hi[i]=(samples[i].widthLeft-1.65)*f;}
 // Minimize bending of the path while retaining room inside both white lines.
 for(const h of [16,8,4,2,1]){
  for(let iter=0;iter<220;iter++){
   for(let j=0;j<N;j++){
    const i=iter%2?N-1-j:j;
    const a=(i-2*h+N*2)%N,b=(i-h+N)%N,c=(i+h)%N,d=(i+2*h)%N;
    const gx=pathX[a]-4*pathX[b]+6*pathX[i]-4*pathX[c]+pathX[d];
    const gy=pathY[a]-4*pathY[b]+6*pathY[i]-4*pathY[c]+pathY[d];
    const newN=clamp(offset[i]-.11*(gx*nx[i]+gy*ny[i]),lo[i],hi[i]);
    offset[i]=newN;pathX[i]=samples[i].x+newN*nx[i];pathY[i]=samples[i].y+newN*ny[i];
   }
  }
 }
 curv=new Float64Array(N);
 const raw=new Float64Array(N),h=Math.max(1,Math.round(4/ds));
 for(let i=0;i<N;i++){
  const a=(i-h+N)%N,b=(i+h)%N;
  const ux=pathX[i]-pathX[a],uy=pathY[i]-pathY[a],vx=pathX[b]-pathX[i],vy=pathY[b]-pathY[i];
  raw[i]=2*(ux*vy-uy*vx)/(Math.hypot(ux,uy)*Math.hypot(vx,vy)*Math.hypot(pathX[b]-pathX[a],pathY[b]-pathY[a])+1e-9);
 }
 vLimit=new Float64Array(N);
 for(let i=0;i<N;i++){
  let k=0;
  for(let d=-2;d<=2;d++)k=Math.max(k,Math.abs(raw[(i+d+N)%N]));
  curv[i]=raw[i];
  vLimit[i]=Math.min(94,Math.sqrt(14.0/Math.max(.0005,k-.0032)));
 }
 for(let pass=0;pass<3;pass++){
  for(let i=N-1;i>=0;i--){const j=(i+1)%N,v=vLimit[j];
   const seg=Math.hypot(pathX[j]-pathX[i],pathY[j]-pathY[i]);
   const total=18.5+.003*v*v, lat=v*v*Math.max(Math.abs(curv[i]),Math.abs(curv[j]));
   const a=.8*Math.sqrt(Math.max(16,total*total-lat*lat))+.0006*v*v;
   vLimit[i]=Math.min(vLimit[i],Math.sqrt(v*v+2*a*seg));
  }
 }
}
function interp(arr,s){let f=((s/ds)%N+N)%N;const i=Math.floor(f);f-=i;return arr[i]*(1-f)+arr[(i+1)%N]*f;}
export function step(t){
 const speed=t.speed;
 const look=6+.28*speed;
 const px=interp(pathX,t.s+look),py=interp(pathY,t.s+look);
 const dx=px-t.x,dy=py-t.y,alpha=wrap(Math.atan2(dy,dx)-t.yaw);
 const ang=Math.atan2(2*wb*Math.sin(alpha),Math.hypot(dx,dy));
 const steer=clamp(ang/ms,-1,1);
 const vTarget=interp(vLimit,t.s+speed*.18);
 const err=vTarget-speed;
 const lat=Math.abs(t.ay),maxLat=16+.004*speed*speed;
 const grip=Math.sqrt(Math.max(.08,1-(lat/maxLat)**2));
 const throttleCap=Math.min(1,.45+speed/100)*grip;
 const throttle=err>0?Math.min(throttleCap,.15+err*.45):0;
 const brake=err<-.25?Math.min(.7,-err*.22):0;
 return {throttle,brake,steer};
}
