let samples=[],N=0,ds=2,wheelbase=3.6,maxSteer=0.35,vLimit=[];
const A0=12,C=0.003,BR=14,MAX_SPEED=95;
export function init(track,car){
  samples=track.samples;N=samples.length;ds=track.sampleSpacing;wheelbase=car.wheelbase;maxSteer=car.maxSteer;
  const w=Math.max(1,Math.round(6/ds));
  const vC=new Array(N);
  for(let i=0;i<N;i++){let k=0;for(let d=-w;d<=w;d++)k=Math.max(k,Math.abs(samples[(i+d+N)%N].curvature));
    const den=k-C; vC[i]=den<=1e-9?MAX_SPEED:Math.min(MAX_SPEED,Math.sqrt(A0/den));}
  vLimit=vC.slice();
  for(let p=0;p<2;p++)for(let i=N-1;i>=0;i--){const nx=vLimit[(i+1)%N];
    const dec=BR+0.001*nx*nx;
    vLimit[i]=Math.min(vLimit[i],Math.sqrt(nx*nx+2*dec*ds));}
}
export function step(t){
  const i=Math.floor(t.s/ds)%N;
  const la=Math.min(45,8+0.4*t.speed);
  const tg=samples[(i+Math.round(la/ds))%N];
  const dx=tg.x-t.x,dy=tg.y-t.y;
  const al=Math.atan2(dy,dx)-t.yaw;
  const dist=Math.hypot(dx,dy);
  const sa=Math.atan2(2*wheelbase*Math.sin(al),dist);
  const steer=Math.max(-1,Math.min(1,sa/maxSteer));
  const vT=vLimit[(i+Math.round((t.speed*0.25)/ds))%N];
  const err=vT-t.speed;
  const cap=Math.min(1,Math.max(0.3,t.speed/75))*(1-1.2*Math.abs(steer));
  const throttle=err>0?Math.min(cap,0.2+err*0.3):0;
  const brake=err<-0.5?Math.min(1,-err*0.3):0;
  return{throttle,brake,steer};
}
