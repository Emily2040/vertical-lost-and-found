import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
const arg=n=>process.argv.find(a=>a.startsWith('--'+n+'='))?.slice(n.length+3);
const base=arg('project-root')?pathToFileURL(path.resolve(arg('project-root'))+path.sep):new URL('./',import.meta.url);
const out=arg('output-dir')?new URL(arg('output-dir').replaceAll('\\','/')+'/',base):base;
const read=n=>JSON.parse(fs.readFileSync(new URL(n,base)));
const {ArchiveSimulation,FIXED_DT}=await import(new URL('src/physics.js',base));
const {PhysicsRuntimeAdapter}=await import(new URL('src/physics_adapter.js',base));
const w=read('world.json'),c=read('contract.json'),trace=JSON.parse(fs.readFileSync(new URL('showcase-ordinary-trace.json',out)));
const s=new ArchiveSimulation(c,w),a=new PhysicsRuntimeAdapter(s);let index=0,maxRestError=0,maxTransitError=0,maxArrivalHorizontalSnap=0,restSamples=0,transitSamples=0,rollingCargoSamples=0;
const arrivals=[],perPayload={};let finitePlaneViolations=0,laneViolations=0,minFiniteMargin=Infinity,minLaneMargin=Infinity;
function minimumWorldProjection(p,n){let m=Infinity;const angle=-(p.rollAngle||0),co=Math.cos(angle),si=Math.sin(angle);for(const v of p.supportHull){const x=co*v[0]-si*v[1],y=si*v[0]+co*v[1];m=Math.min(m,(p.x+x)*n[0]+(p.y+y)*n[1]+(p.z-.35+v[2])*n[2]);}return m;}
for(let tick=0;tick<Math.ceil(53/FIXED_DT);tick++){
 while(index<trace.length&&trace[index].tick<=tick){const e=trace[index++];if(e.type==='input')a.setContinuousInput(e);else a.dispatchAction(e.action,e.params);}
 const before=Object.fromEntries(Object.values(s.payloads).map(p=>[p.id,{state:p.state,x:p.x,z:p.z}]));a.stepFixed();
 for(const p of Object.values(s.payloads)){
  if(p.state==='resting'){
   const d=s.drawers[p.holderId],tilt=d.tiltRad||0,n=[0,Math.cos(tilt),Math.sin(tilt)],pan=d.surfaceGeometry.pan;
   const floor=pan?pan.topY-(d.panDisplacementM||0):d.surfaceGeometry.floorY;
   const plane=d.y*n[1]+(d.zExt-.55)*n[2]+floor;
   const error=Math.abs(minimumWorldProjection(p,n)-plane);maxRestError=Math.max(maxRestError,error);restSamples++;
   perPayload[p.id]=Math.max(perPayload[p.id]||0,error);
   if(before[p.id].state==='chute_fall'){const horizontalSnap=Math.hypot(p.x-before[p.id].x,p.z-before[p.id].z);maxArrivalHorizontalSnap=Math.max(maxArrivalHorizontalSnap,horizontalSnap);arrivals.push({id:p.id,t:s.time,holder:p.holderId,horizontalSnapM:horizontalSnap});}
  }
  if(p.state==='chute_transit'){
   const q=s.chutes[p.chuteId],dx=q.exitX-q.entryX,dy=q.exitY-q.entryY,dz=q.exitZ-q.entryZ,L=Math.hypot(dx,dy,dz),H=Math.hypot(dx,dz),n=[-dy*dx/(L*H),H/L,-dy*dz/(L*H)];
   const plane=q.entryX*n[0]+q.entryY*n[1]+(q.entryZ-.35)*n[2],error=Math.abs(minimumWorldProjection(p,n)-plane);
   maxTransitError=Math.max(maxTransitError,error);transitSamples++;if(p.rollAngle)rollingCargoSamples++;
   for(const v of p.supportHull){
    const x=p.x+v[0]-q.entryX,y=p.y+v[1]-q.entryY,z=p.z+v[2]-q.entryZ;
    const side=(-dz*x+dx*z)/H,sideMargin=q.widthM/2-.05-Math.abs(side);
    minLaneMargin=Math.min(minLaneMargin,sideMargin);if(sideMargin<0)laneViolations++;
    if(Math.abs(x*n[0]+y*n[1]+z*n[2])<1e-6){const along=(dx*x+dy*y+dz*z)/L,margin=Math.min(along+(q.entryApronM||0),L-along);minFiniteMargin=Math.min(minFiniteMargin,margin);if(margin<0)finitePlaneViolations++;}
   }
  }
 }
}
const checks=[
 {id:'rotated_payload_rest_contact',passed:maxRestError<1e-6,expected:'Actual mesh support hull lies on holder/pan plane within1µm',measured:{maxRestError,restSamples,perPayload}},
 {id:'gravity_chute_actual_geometry_contact',passed:transitSamples>0&&maxTransitError<1e-6,expected:'Upright mesh support hull contacts roller-top plane within1µm',measured:{maxTransitError,transitSamples}},
 {id:'no_generic_cargo_tumble',passed:rollingCargoSamples===0,expected:0,measured:rollingCargoSamples},
 {id:'receiver_lane_continuity',passed:arrivals.length===3&&maxArrivalHorizontalSnap<1e-6,expected:'Three gravity arrivals with no horizontal teleport',measured:{arrivals,maxArrivalHorizontalSnap}},
 {id:'finite_roller_bed_support',passed:finitePlaneViolations===0&&minFiniteMargin>0,expected:'Actual contact vertex remains within the finite bed including visible entry apron',measured:{finitePlaneViolations,minFiniteMarginM:minFiniteMargin}},
 {id:'finite_chute_lane_clearance',passed:laneViolations===0&&minLaneMargin>0,expected:'Whole cargo hull stays inside both flanges',measured:{laneViolations,minLaneMarginM:minLaneMargin}},
 {id:'ordinary_route_after_contact_fix',passed:s.completed,expected:true,measured:s.completed}
];
const names=['src/physics.js','src/physics_adapter.js','src/mechanisms.js','src/support.js','world.json','contract.json'];const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={allPassed:checks.every(x=>x.passed),method:'Saved ordinary adapter controls; after-action diagnostics transform independently extracted GLB convex hull vertices. No simulation state writes. This is contact-plane proof for a constrained cargo slide, not a free angular rigid-body solver.',sourceHashes:Object.fromEntries(names.map(n=>[n,hash(fs.readFileSync(new URL(n,base)))])),runnerSha256:hash(fs.readFileSync(new URL(import.meta.url))),checks};
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(new URL('contact-geometry-evidence.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.allPassed)process.exitCode=1;
