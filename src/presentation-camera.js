import * as THREE from 'three';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t)};

/** Read-only camera direction; returns false for existing diagnostic modes. */
export function updatePresentationCamera(view,sim,dt){
  const mode=view.cameraMode;
  if(!['opening','follow','hero','coupled_proof','garden_payoff'].includes(mode))return false;
  const p=sim.player,position=new THREE.Vector3(),target=new THREE.Vector3();let fov=45;
  if(mode==='opening'){
    position.set(-1.8,3.6,7.4);target.set(-4.85,1.95,.9);fov=44;
  }else if(mode==='hero'){
    position.set(3.8,2.8,7.0);target.set(-1.6,6.3,.45);fov=58;
  }else if(mode==='coupled_proof'){
    const lift=sim.drawers.drawer_s2_lift,counter=sim.drawers.drawer_s2_counter;
    const lo=Math.min(lift.y-.4,counter.y-.4),hi=Math.max(p.y+1.9,lift.y+.8,counter.y+.7);
    const mid=(lo+hi)/2,zDistance=Math.max(6.5,(hi-lo)*.5/Math.tan(THREE.MathUtils.degToRad(44/2))+.8);
    target.set((lift.x+counter.x)*.5,mid,.95);
    position.set(target.x+2.3,mid+1.2,1.2+zDistance);fov=44;
  }else if(mode==='garden_payoff'&&sim.completed){
    if(view._gardenCameraStart===undefined)view._gardenCameraStart=sim.time;
    const progress=smooth((sim.time-view._gardenCameraStart)/8);
    // Remain in front of the opening: both the archivist and doorframe establish
    // that this is the earned destination, rather than a separate garden scene.
    position.set(2.15-1.45*progress,16.15-.05*progress,6.7-1.6*progress);
    target.set(.05,15.55-.15*progress,-2.7-1.2*progress);fov=48-4*progress;
  }else{
    const lead=sim.stage>=3?-.65:.75;
    target.set(p.x+lead,Math.max(1.95,p.y+1.05),.9);
    position.set(target.x+1.65,target.y+1.25,8.25);fov=44;
  }
  let state=view._presentationCamera;
  const rewind=state&&sim.time<state.time-1e-6;
  if(!state||rewind){state=view._presentationCamera={position:position.clone(),target:target.clone(),fov,mode,time:sim.time};view._gardenCameraStart=mode==='garden_payoff'&&sim.completed?sim.time:undefined;}
  const cut=state.mode!==mode;
  const alpha=cut||dt<=0?1:1-Math.exp(-Math.min(dt,.12)*5.5);
  state.position.lerp(position,alpha);state.target.lerp(target,alpha);state.fov+=(fov-state.fov)*alpha;
  state.mode=mode;state.time=sim.time;
  view.camera.position.copy(state.position);view.cameraTarget.copy(state.target);view.camera.fov=state.fov;
  view.camera.updateProjectionMatrix();view.camera.lookAt(view.cameraTarget);return true;
}

export const showcaseCameraTimeline=[
  {t:0,mode:'opening'},
  {t:2.8,mode:'follow'},
  {t:18.6,mode:'coupled_proof',minStage:2},
  {t:25.8,mode:'follow',minStage:2},
  {t:51.0,mode:'garden_payoff',minStage:3,requiresCompleted:true}
];
