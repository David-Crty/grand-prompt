// Adaptive centerline driver with a smoothed curvature envelope and conservative grip margin.
let samples=[], N=0, ds=2, wheelbase=3.6, maxSteer=.35, vLimit=[];
const LAT=13.5, BRAKE=17, MAX_SPEED=85;
export function init(track,car){
 samples=track.samples; N=samples.length; ds=track.sampleSpacing; wheelbase=car.wheelbase; maxSteer=car.maxSteer;
 const vc=new Array(N), w=Math.max(1,Math.round(8/ds));
 for(let i=0;i<N;i++){
  let k=0;
  for(let d=-w;d<=w;d++) k=Math.max(k,Math.abs(samples[(i+d+N)%N].curvature));
  vc[i]=Math.min(MAX_SPEED,Math.sqrt(LAT/Math.max(k,1e-6)));
 }
 vLimit=vc.slice();
 for(let pass=0;pass<3;pass++) for(let i=N-1;i>=0;i--){const j=(i+1)%N;vLimit[i]=Math.min(vLimit[i],Math.sqrt(vLimit[j]*vLimit[j]+2*BRAKE*ds));}
}
export function step(t){
 const i=Math.floor(t.s/ds)%N;
 const look=Math.min(40,8+.35*t.speed);
 const target=samples[(i+Math.round(look/ds))%N];
 const dx=target.x-t.x,dy=target.y-t.y,alpha=Math.atan2(dy,dx)-t.yaw;
 const angle=Math.atan2(2*wheelbase*Math.sin(alpha),Math.hypot(dx,dy));
 let steer=Math.max(-1,Math.min(1,angle/maxSteer));
 const vi=(i+Math.round((t.speed*.42+4)/ds))%N;
 const vt=vLimit[vi], err=vt-t.speed;
 const throttleCap=Math.min(1,Math.max(.3,t.speed/55))*(1-.5*Math.abs(steer));
 const throttle=err>0?Math.min(throttleCap,.2+err*.4):0;
 const brake=err<-.5?Math.min(1,-err*.25):0;
 return {throttle,brake,steer};
}
