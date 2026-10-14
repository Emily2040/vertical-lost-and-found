import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const rootArg=process.argv.find(a=>a.startsWith('--project-root='))?.slice('--project-root='.length);
const base=rootArg?pathToFileURL(path.resolve(rootArg)+path.sep):new URL('./',import.meta.url);
const {ArchiveSimulation,FIXED_DT}=await import(new URL('src/physics.js',base));
const {PhysicsRuntimeAdapter}=await import(new URL('src/physics_adapter.js',base));
const evidenceArg=process.argv.find(a=>a.startsWith('--evidence-dir='))?.slice('--evidence-dir='.length)?.replaceAll('\\','/').replace(/\/$/,'');
const evidenceBase=evidenceArg?new URL(evidenceArg+'/',base):base;
const read=name=>JSON.parse(fs.readFileSync(new URL(name,evidenceBase)));
const contract=JSON.parse(fs.readFileSync(new URL('contract.json',base))),world=JSON.parse(fs.readFileSync(new URL('world.json',base))),trace=read('ordinary-trace.json'),route=read('route-result.json');
const checks=[];const add=(id,passed,expected,measured)=>checks.push({id,passed,expected,measured});
const sourceFiles=['src/physics.js','src/physics_adapter.js','src/mechanisms.js','src/support.js','contract.json','world.json',(evidenceArg?evidenceArg+'/':'')+'ordinary-trace.json',fs.existsSync(new URL('scripts/route.mjs',base))?'scripts/route.mjs':'route.mjs',fs.existsSync(new URL('scripts/qualify.mjs',base))?'scripts/qualify.mjs':'qualify.mjs'];
const hashes=Object.fromEntries(sourceFiles.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(new URL(name,base))).digest('hex')]));
const endTick=Math.round(route.final.time/FIXED_DT);
const ordinaryActions=new Set(['jump','focus_next','focus_target','focus_payload','toggle_latch','toggle_hatch','interact_payload','open_garden','restore_checkpoint']);
add('ordinary_input_surface',trace.every(e=>e.type==='input'?[-1,0,1].includes(e.moveX)&&[-1,0,1].includes(e.moveZ)&&[-1,0,1].includes(e.railPull):ordinaryActions.has(e.action)), 'Keyboard-equivalent continuous inputs and public actions only',{actions:[...new Set(trace.filter(e=>e.type==='action').map(e=>e.action))],events:trace.length});
const actions=trace.filter(e=>e.type==='action');
const minimumActionGap=Math.min(...actions.slice(1).map((e,i)=>(e.tick-actions[i].tick)*FIXED_DT));
add('human_action_spacing',minimumActionGap>=0.3-1e-10,'At least300ms between discrete actions',minimumActionGap);
add('coarse_decision_rate',route.controller.decisionSeconds>=0.1,'Steering/rail decisions no faster than10Hz',route.controller);
add('route_source_binding',Object.entries(route.sourceHashes||{}).length===6&&Object.entries(route.sourceHashes||{}).every(([name,hash])=>hashes[name]===hash),'Route generation matches all6delivered source/config hashes',route.sourceHashes);
for(const prefix of ['sensitivity-80-','sensitivity-120-']){
 const r=read(prefix+'route-result.json');
 add('coarse_sensitivity_'+prefix,r.failure===null&&r.final.completed&&Object.entries(r.sourceHashes||{}).length===6&&Object.entries(r.sourceHashes||{}).every(([name,hash])=>hashes[name]===hash),'Complete with nearby coarse decision interval on identical sources',{failure:r.failure,completed:r.final.completed,time:r.final.time,controller:r.controller});
}
const margins=route.events.filter(e=>e.label.startsWith('landed')).map(e=>{const p=e.observation.player,d=world.runtime.drawers[p.supportId];return {label:e.label,horizontalMarginM:(d.surfaceGeometry?.floorWidth??d.width)/2-Math.abs(p.x-d.x)};});
add('jump_landing_margin',margins.every(m=>m.horizontalMarginM>0.1),'Player centre lands at least0.10m inside nominal body side edges',margins);
function replay(hz,filter=()=>true,options={}){
 const replayTrace=options.trace||trace,lastTick=options.endTick||endTick;
 const s=new ArchiveSimulation(contract,world),a=new PhysicsRuntimeAdapter(s);let tick=0,index=0,acc=0;
 const mass=Object.values(s.payloads).reduce((n,p)=>n+p.massKg,0);let massError=0,ownershipErrors=0,chuteUphillSteps=0,maxRopeError=0;const transition=[{stage:1,t:0}];let lastStage=1;
 const phases=[];
 while(tick<lastTick){acc+=1/hz;while(acc>=FIXED_DT-1e-10&&tick<lastTick){
   while(index<replayTrace.length&&replayTrace[index].tick<=tick){const e=replayTrace[index++];if(!filter(e))continue;if(e.type==='input')a.setContinuousInput(e);else a.dispatchAction(e.action,e.params);}
   const previous=Object.fromEntries(Object.values(s.payloads).filter(p=>p.state==='chute_transit'||p.state==='chute_fall').map(p=>[p.id,{y:p.y,state:p.state}]));
   a.stepFixed();tick++;acc-=FIXED_DT;
   massError=Math.max(massError,Math.abs(Object.values(s.payloads).reduce((n,p)=>n+p.massKg,0)-mass));
   for(const p of Object.values(s.payloads)){if(p.state==='carried'&&(s.player.carriedPayloadId!==p.id||p.holderId!==null))ownershipErrors++;if(p.state==='resting'&&!s.drawers[p.holderId])ownershipErrors++;if(previous[p.id]&&(p.state==='chute_transit'||p.state==='chute_fall')&&p.y>previous[p.id].y+1e-8){chuteUphillSteps++;phases.push({tick,id:p.id,previous:previous[p.id],nowY:p.y,state:p.state});}}
   for(const config of Object.values(world.runtime.mechanisms)){const l=s.drawers[config.lift],c=s.drawers[config.counter];maxRopeError=Math.max(maxRopeError,Math.abs(c.y-(c.maxY-config.ratio*(l.y-l.minY))));}
   if(s.stage!==lastStage){transition.push({stage:s.stage,t:tick*FIXED_DT});lastStage=s.stage;}
 }
 }
 return {hz,final:a.getObservation(),stats:s.stats,transition,massError,ownershipErrors,chuteUphillSteps,maxRopeError,phases,shutter:s.drawers.drawer_s3_garden.shutterOpen,checkpoints:Object.keys(s.checkpoints)};
}
const replays=[30,60,120].map(h=>replay(h));
for(const r of replays){add('complete_route_'+r.hz,r.final.completed&&r.final.stage===3&&r.shutter>0.99&&r.final.player.supportId==='drawer_s3_garden','All stages, final drawer interior, full shutter', {stage:r.final.stage,completed:r.final.completed,support:r.final.player.supportId,shutter:r.shutter,time:r.final.time});add('mass_ownership_'+r.hz,r.massError===0&&r.ownershipErrors===0,'Zero mass drift and unambiguous ownership',{massError:r.massError,ownershipErrors:r.ownershipErrors});add('downhill_chute_'+r.hz,r.chuteUphillSteps===0,'No upward step while gravity transport is active',r.chuteUphillSteps);}
add('render_rate_identity',replays.every(r=>JSON.stringify(r.final.player)===JSON.stringify(replays[0].final.player)), 'Identical final player state at30/60/120Hz',replays.map(r=>({hz:r.hz,player:r.final.player})));
add('ordered_stages',JSON.stringify(replays[0].transition.map(x=>x.stage))==='[1,2,3]','Stages1→2→3 reached by ordinary route',replays[0].transition);
add('failure_and_retry',replays[0].stats.checkpointsRestored>=1&&replays[0].stats.notchRejections>=1&&replays[0].stats.overloadWarnings>=1,'A genuine fall restores checkpoint; missed notch and underloaded lift reject',replays[0].stats);
const noRail=replay(60,e=>e.type!=='input'||e.railPull===0),noCargo=replay(60,e=>e.action!=='interact_payload'),noLatch=replay(60,e=>e.action!=='toggle_latch');
for(const [id,r] of [['no_rail',noRail],['no_cargo',noCargo],['no_latch',noLatch]])add('counterexample_'+id,!r.final.completed,'Removing required interaction class from route cannot complete',{stage:r.final.stage,completed:r.final.completed,support:r.final.player.supportId});
const apex=contract.simulation.player_jump_speed_mps**2/(2*contract.simulation.gravity_mps2),d=world.runtime.drawers;
const entities=new Map(world.entities.map(e=>[e.id,e]));
const brokenRefs=world.entities.flatMap(e=>['coupled_to','target_cage','parent'].filter(k=>e[k]&&e[k]!=='root'&&!entities.has(e[k])).map(k=>({entity:e.id,key:k,target:e[k]})));
add('world_entity_references',brokenRefs.length===0,'Every declared coupled mechanism, chute target and parent resolves to a world entity',brokenRefs);
const cageMetadata=['cage_s3_west','cage_s3_east'].map(id=>{const e=entities.get(id),r=d[id];return {id,exists:!!e,mesh:e?.mesh_id,stage:e?.stage,position:e?.transform.position,expectedPosition:[r.x,r.y,r.zExt],rail:e?.vertical_rail,expectedRail:{min_y:r.minY,max_y:r.maxY,initial_y:r.y,base_mass_kg:r.baseMassKg}};});
add('cage_metadata_runtime_alignment',cageMetadata.every(c=>c.exists&&c.mesh==='mesh_load_cage'&&c.stage===3&&JSON.stringify(c.position)===JSON.stringify(c.expectedPosition)&&Object.entries(c.expectedRail).every(([k,v])=>c.rail[k]===v)),'Both visible load cages have runtime-derived world transforms, stage, mesh and rail records',cageMetadata);
const chuteMetadata=Object.values(world.runtime.chutes).map(c=>({id:c.id,entry:entities.get(c.id)?.entry_position,exit:entities.get(c.id)?.exit_position,expectedEntry:[c.entryX,c.entryY,c.entryZ],expectedExit:[c.exitX,c.exitY,c.exitZ]}));
add('chute_metadata_runtime_alignment',chuteMetadata.every(c=>JSON.stringify(c.entry)===JSON.stringify(c.expectedEntry)&&JSON.stringify(c.exit)===JSON.stringify(c.expectedExit)),'World chute endpoints match gravity transport endpoints',chuteMetadata);
const catchTop=d.drawer_catch_02.y+d.drawer_catch_02.surfaceGeometry.floorY,bTop=d.drawer_s1_b.y+d.drawer_s1_b.surfaceGeometry.floorY;
add('jump_only_barrier',d.drawer_s1_a.zExt<0.38&&bTop-catchTop>apex,'First onward drawer is retracted; next reachable-height candidate exceeds jump apex',{firstDrawerExtension:d.drawer_s1_a.zExt,nextRise:bTop-catchTop,maximumStationaryJumpRise:apex});
add('no_climbable_counterweight_bridge',['drawer_s2_counter','cage_s3_west','cage_s3_east','receiving_tray_01'].every(id=>d[id].climbable===false),'Cargo receivers are not foothold surfaces',Object.fromEntries(['drawer_s2_counter','cage_s3_west','cage_s3_east'].map(id=>[id,d[id].climbable])));
add('gravity_chute_geometry',Object.values(world.runtime.chutes).every(c=>c.entryY>c.exitY),'Every gravity chute descends',Object.values(world.runtime.chutes).map(c=>({id:c.id,drop:c.entryY-c.exitY})));
add('rope_geometry',replays.every(r=>r.maxRopeError<0.001),'Rope length constraint error<1mm',replays.map(r=>({hz:r.hz,maxError:r.maxRopeError})));
add('contract_motion',contract.simulation.player_jump_speed_mps===6.6&&contract.simulation.player_walk_speed_mps===4.4&&contract.simulation.fixed_dt_s===FIXED_DT,'Runtime consumes contract motion values',{jump:contract.simulation.player_jump_speed_mps,walk:contract.simulation.player_walk_speed_mps,dt:FIXED_DT});
const lateRise=d.drawer_s3_b.maxY+d.drawer_s3_b.surfaceGeometry.floorY-(d.drawer_s3_a.y+d.drawer_s3_a.surfaceGeometry.floorY);
add('late_boarding_envelope',lateRise>apex,'Fully risen upper lift exceeds jump apex from loading platform; board during ascent',{lateRise,maximumJumpRise:apex});
const showcaseTrace=read('showcase-ordinary-trace.json'),showcaseResult=read('showcase-route-result.json');
const showcaseReplay=replay(60,()=>true,{trace:showcaseTrace,endTick:Math.round(showcaseResult.final.time/FIXED_DT)});
const showcaseActions=showcaseTrace.filter(e=>e.type==='action'),showcaseGap=Math.min(...showcaseActions.slice(1).map((e,i)=>(e.tick-showcaseActions[i].tick)*FIXED_DT));
add('showcase_valid_ordinary_route',showcaseReplay.final.completed&&showcaseReplay.massError===0&&showcaseReplay.ownershipErrors===0&&showcaseReplay.chuteUphillSteps===0&&showcaseGap>=0.3-1e-10&&Object.entries(showcaseResult.sourceHashes).every(([name,hash])=>hashes[name]===hash),'Independent replay reaches earned garden with readable ordinary action spacing',{completed:showcaseReplay.final.completed,time:showcaseReplay.final.time,minimumActionGap:showcaseGap,stats:showcaseReplay.stats});
const report={scope:'Pure fixed-step simulation qualification. Full route uses only public observations and ordinary keyboard-equivalent controls. Hidden state is inspected only by these post-action assertions. Does not qualify rendered contacts, full-body collision, visual fidelity, audio or video.',hashes,allPassed:checks.every(c=>c.passed),checks,replays};
fs.writeFileSync(new URL('mechanics-evidence.json',evidenceBase),JSON.stringify(report,null,2));console.log(JSON.stringify({allPassed:report.allPassed,checks:checks.map(c=>({id:c.id,passed:c.passed,...(!c.passed?{measured:c.measured}:{})}))},null,2));
if(!report.allPassed)process.exitCode=1;
