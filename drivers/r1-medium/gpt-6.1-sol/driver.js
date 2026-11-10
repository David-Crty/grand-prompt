let samples, N, ds, length, wb, ms;
let px,py,curve,limit;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function init(track,car){
 samples=track.samples;N=samples.length;ds=track.sampleSpacing;length=track.length;wb=car.wheelbase;ms=car.maxSteer;
 px=new Float64Array(N);py=new Float64Array(N);let nx=new Float64Array(N),ny=new Float64Array(N),offset=new Float64Array(N);
 for(let i=0;i<N;i++){px[i]=samples[i].x;py[i]=samples[i].y;nx[i]=-Math.sin(samples[i].heading);ny[i]=Math.cos(samples[i].heading);}
 let passes=Math.min(3100,Math.floor(12000000/N));
 for(let pass=0;pass<passes;pass++){
  let phase=pass/passes;let stride=phase<200/3100?8:phase<500/3100?4:phase<1100/3100?2:1;
  for(let j=0;j<N;j++){
   let i=pass%2?N-1-j:j,a=(i+N-2*stride)%N,b=(i+N-stride)%N,c=(i+stride)%N,d=(i+2*stride)%N;
   let gx=px[a]-4*px[b]+6*px[i]-4*px[c]+px[d],gy=py[a]-4*py[b]+6*py[i]-4*py[c]+py[d];
   let v=clamp(offset[i]-.8*(gx*nx[i]+gy*ny[i])/6,-samples[i].widthRight+1.25,samples[i].widthLeft-1.25);
   offset[i]=v;px[i]=samples[i].x+nx[i]*v;py[i]=samples[i].y+ny[i]*v;
  }
 }
 curve=new Float64Array(N);limit=new Float64Array(N);
 for(let i=0;i<N;i++){
  let a=(i+N-1)%N,b=(i+1)%N,ux=px[i]-px[a],uy=py[i]-py[a],vx=px[b]-px[i],vy=py[b]-py[i];
  curve[i]=2*(ux*vy-uy*vx)/(Math.hypot(ux,uy)*Math.hypot(vx,vy)*Math.hypot(ux+vx,uy+vy));
 }
 for(let i=0;i<N;i++){
  let k=0;for(let j=-3;j<=3;j++)k=Math.max(k,Math.abs(curve[(i+j+N)%N]));
  limit[i]=Math.min(95,Math.sqrt(17.5/Math.max(.001,k-.0022)));
 }
 for(let pass=0;pass<3;pass++)for(let i=N-1;i>=0;i--){let j=(i+1)%N,v=limit[j],d=Math.hypot(px[j]-px[i],py[j]-py[i]);let ay=v*v*Math.max(Math.abs(curve[i]),Math.abs(curve[j]));let utilization=ay/(17+.0028*v*v);let decel=.0008*v*v+11*Math.sqrt(Math.max(.10,1-utilization*utilization));limit[i]=Math.min(limit[i],Math.sqrt(v*v+2*decel*d));}
}
function at(arr,s){let f=((s%length)+length)%length/ds,i=Math.floor(f)%N;return arr[i]+(arr[(i+1)%N]-arr[i])*(f-Math.floor(f));}
export function step(t){
 let look=5+.30*t.speed,targetS=t.s+look,dx=at(px,targetS)-t.x,dy=at(py,targetS)-t.y;
 let beta=Math.atan2(t.vy,Math.max(3,t.vx)),alpha=Math.atan2(dy,dx)-t.yaw-.65*beta;
 let angle=Math.atan2(2*wb*Math.sin(alpha),Math.hypot(dx,dy));
 let steer=clamp(angle/ms,-1,1);
 let target=at(limit,t.s+t.speed*.18),err=target-t.speed;
 let cap=Math.min(1,Math.max(.22,t.speed/48))*(1-.42*Math.min(1,Math.abs(t.ay)/(15+.0025*t.speed*t.speed)));
 let throttle=err>0?Math.min(cap,.12+err*.45):0;
 let grip=17+.0028*t.speed*t.speed, utilization=Math.abs(t.ay)/grip;
 let brakeCap=(.32+.000035*t.speed*t.speed)*Math.sqrt(Math.max(.08,1-utilization*utilization));
 let rearSlip=Math.abs(Math.atan2(1.62*t.yawRate-t.vy,Math.max(3,t.vx)));
 if(rearSlip>.065)brakeCap*=clamp(1-(rearSlip-.065)*16,0,1);
 if(rearSlip>.055)throttle*=clamp(1-(rearSlip-.055)*20,0,1);
 let brake=err<-.25?Math.min(brakeCap,-err*.22):0;
 return {throttle,brake,steer};
}
