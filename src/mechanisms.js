import {playerPanLoad,payloadRestPose,payloadChutePose} from './support.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function applyRuntimeLayout(sim){
 const r=sim.world.runtime;if(!r)throw Error('world.runtime is required');
 sim.drawers=structuredClone(r.drawers);sim.payloads=structuredClone(r.payloads);sim.chutes=structuredClone(r.chutes);
 Object.assign(sim.player,r.playerStart);sim.interactionTargetId=null;
 for(const p of Object.values(sim.payloads)){const catalog=sim.contract.payload_catalog.find(c=>c.id===p.id);if(catalog){p.massKg=catalog.mass_kg;p.meshId=catalog.mesh_id;}}
}

function ropeLift(sim,setup,dt){
 const lift=sim.drawers[setup.lift],counter=sim.drawers[setup.counter];
 if(lift.latched||counter.latched||lift.jammed||counter.jammed){lift.vy=0;counter.vy=0;counter.y=counter.maxY-setup.ratio*(lift.y-lift.minY);return;}
 const a=sim.getDrawerEffectiveMass(lift.id),b=sim.getDrawerEffectiveMass(counter.id),r=setup.ratio;
 const drive=sim.contract.simulation.gravity_mps2*(r*b-a);
 let force=drive;
 if(Math.abs(lift.vy)<0.005 && Math.abs(force)<=setup.frictionN)force=0;
 else force-=Math.sign(Math.abs(lift.vy)>0.005?lift.vy:force)*setup.frictionN;
 lift.vy=clamp((lift.vy+force/(a+r*r*b)*dt)*Math.exp(-setup.damping*dt),-setup.maxSpeed,setup.maxSpeed);
 const next=clamp(lift.y+lift.vy*dt,lift.minY,lift.maxY);
 lift.vy=(next-lift.y)/dt;lift.y=next;
 counter.y=counter.maxY-r*(lift.y-lift.minY);
 if(sim.player.supportId===lift.id&&drive<0&&sim.stats.overloadWarnings===0){sim.stats.overloadWarnings++;sim.showBanner(`LIFT ${lift.number} DESCENDS: rider and cargo exceed counterweight. Return to the latched ledge.`, 'reject',4);}
}

export function stepMechanisms(sim,dt){
 const gravity=sim.contract.simulation.gravity_mps2;
 const focused=sim.getFocusedDrawer();
 for(const d of Object.values(sim.drawers)){
  if(d.latched||d.jammed||!d.returnSpringMps)continue;
  if(focused?.id===d.id&&Math.abs(sim.input.railPull)>0.01){
    const previous=d.zExt;d.zExt=clamp(d.zExt+sim.input.railPull*1.45*dt,d.minZ,d.maxZ);
    if(d.id==='drawer_s1_a')d.woundEnergyJ=Math.min(180,(d.woundEnergyJ||0)+Math.max(0,d.zExt-previous)*140);
  }
  else d.zExt=Math.max(0.15,d.zExt-d.returnSpringMps*dt);
 }
 const c=sim.drawers.drawer_s1_c,pan=sim.drawers.drawer_s1_a;
 pan.panPlayerLoadKg=playerPanLoad(sim,pan);
 pan.panLoadKg=sim.getDrawerPayloadMass(pan.id)+pan.panPlayerLoadKg;
 pan.panDisplacementM=Math.min(0.09,pan.panLoadKg*gravity/4000);
 pan.panReleaseEngaged=pan.panLoadKg>=25;
 if(!c.latched&&!c.jammed){
  const mass=sim.getDrawerEffectiveMass(c.id);
  const springForce=pan.panReleaseEngaged&&pan.woundEnergyJ>0 ? 65 : 0;
  const drive=springForce-20,friction=4+0.03*mass*gravity;
  const force=Math.abs(c.driveVz||0)<0.005&&Math.abs(drive)<=friction ? 0 : drive-Math.sign(Math.abs(c.driveVz||0)>0.005?c.driveVz:drive)*friction;
  c.driveVz=clamp(((c.driveVz||0)+force/mass*dt)*Math.exp(-0.5*dt),-0.8,0.8);
  const previous=c.zExt;c.zExt=clamp(c.zExt+c.driveVz*dt,0.15,1.95);
  pan.woundEnergyJ=Math.max(0,(pan.woundEnergyJ||0)-springForce*Math.max(0,c.zExt-previous));
 }else c.driveVz=0;
 ropeLift(sim,sim.world.runtime.mechanisms.stage2,dt);
 const west=sim.drawers.cage_s3_west,a=sim.drawers.drawer_s3_a;
 const westLoad=sim.getDrawerPayloadMass(west.id);
 if(!a.latched&&!a.jammed){
  const rider=sim.player.supportId===a.id&&sim.player.grounded?sim.contract.simulation.player_mass_kg:0;
  const force=gravity*(westLoad-25-rider);
  west.driveVy=clamp(((west.driveVy||0)-force/(west.baseMassKg+westLoad+a.baseMassKg+rider)*dt)*Math.exp(-0.8*dt),-0.65,0.65);
  west.y=clamp(west.y+west.driveVy*dt,west.minY,west.maxY);
  a.zExt=0.15+(west.maxY-west.y);
 }
 ropeLift(sim,sim.world.runtime.mechanisms.stage3,dt);
 const b=sim.drawers.drawer_s3_b,g=sim.drawers.drawer_s3_garden;
 if(!g.latched&&!g.jammed)g.zExt=0.15+1.9*(b.y-b.minY)/(b.maxY-b.minY);
}

export function stepGravityChute(sim,p,dt){
 const c=sim.chutes[p.chuteId],receiver=sim.drawers[c.targetHolderId];
 const g=sim.contract.simulation.gravity_mps2;
 if(p.state==='chute_transit'){
  const dx=c.exitX-c.entryX,dy=c.exitY-c.entryY,dz=c.exitZ-c.entryZ;
  const length=Math.hypot(dx,dy,dz),horizontal=Math.hypot(dx,dz);
  if(dy>=0)throw Error('Gravity chute must descend');
  const acceleration=g*(-dy/length-c.kineticFriction*horizontal/length);
  p.chuteSpeed=Math.max(0,p.chuteSpeed+acceleration*dt);
  p.chuteDistance=Math.min(length,p.chuteDistance+p.chuteSpeed*dt);
  const u=p.chuteDistance/length;
  Object.assign(p,payloadChutePose(p,c,u));
  if(u===1){p.state='chute_fall';p.fallVy=p.chuteSpeed*dy/length;}
 }else{
  p.fallVy-=g*dt;p.y+=p.fallVy*dt;
  const rest=payloadRestPose(sim,p,receiver),top=rest.y;
  if(p.y<=top){Object.assign(p,rest);p.state='resting';p.holderId=receiver.id;sim.audio?.trigger(sim.time,'payload_transfer',{payload:p.id,mass:p.massKg});}
 }
}
