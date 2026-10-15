import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
const base=arg('project-root')?pathToFileURL(path.resolve(arg('project-root'))+path.sep):new URL('./',import.meta.url);
const {ArchiveSimulation,FIXED_DT}=await import(new URL('src/physics.js',base));
const {PhysicsRuntimeAdapter}=await import(new URL('src/physics_adapter.js',base));
const contract=JSON.parse(fs.readFileSync(new URL('contract.json',base))),world=JSON.parse(fs.readFileSync(new URL('world.json',base)));
const outputPrefix=(arg('output-prefix')||'').replace(/[^a-zA-Z0-9_-]/g,'');
const outputBase=arg('output-dir')?new URL(arg('output-dir').replaceAll('\\','/').replace(/\/$/,'')+'/',base):base;
fs.mkdirSync(outputBase,{recursive:true});
const showcase=process.argv.includes('--showcase');
const sourceHashes=Object.fromEntries(['src/physics.js','src/physics_adapter.js','src/mechanisms.js','src/support.js','contract.json','world.json'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(new URL(name,base))).digest('hex')]));
const sim=new ArchiveSimulation(contract,world),adapter=new PhysicsRuntimeAdapter(sim);
const trace=[],events=[];let tick=0,lastInput='',lastActionTick=-36;
const DECISION_TICKS=Math.max(1,Math.round(Number(arg('decision-ms')||100)/(FIXED_DT*1000)));
const obs=()=>adapter.getObservation();
function input(moveX=0,railPull=0,moveZ=0){const value={moveX,moveZ,railPull};if(JSON.stringify(value)!==lastInput){lastInput=JSON.stringify(value);adapter.setContinuousInput(value);trace.push({type:'input',tick,t:tick*FIXED_DT,...value});}}
function action(action,params={}){if(tick-lastActionTick<36)steps(36-(tick-lastActionTick));const result=adapter.dispatchAction(action,params);trace.push({type:'action',tick,t:tick*FIXED_DT,action,params,result});lastActionTick=tick;return result;}
function steps(n){for(let i=0;i<n;i++){adapter.stepFixed(FIXED_DT);tick++;}}
function wait(seconds){input();steps(Math.round(seconds/FIXED_DT));}
function mark(label){events.push({tick,t:tick*FIXED_DT,label,observation:obs()});console.log(label,obs().player.supportId,obs().player.x,obs().player.y,obs().player.carriedPayload?.id||'empty');}
function focus(id){for(let i=0;i<30;i++){if((obs().selectedTarget?.id||null)===id)return;action('focus_next');}throw Error('Cannot focus '+id);}
function target(id){return obs().interactionTargets.find(d=>d.id===id);}
function pullLatch(id,notch=1.3){focus(id);let d=target(id);if(!d)throw Error('unreachable rail '+id);if(d.latched)action('toggle_latch');for(let i=0;i<100;i++){d=target(id);if(!d)throw Error('rail lost reach '+id);if(Math.abs(d.railPosition-notch)<0.09){input();const r=action('toggle_latch');if(!r.ok)throw Error('latch rejected '+JSON.stringify(r));mark('latched '+id);return;}input(0,Math.sign(notch-d.railPosition));steps(DECISION_TICKS);}throw Error('rail timeout '+id);}
function latch(id){focus(id);if(!target(id))throw Error('unreachable latch '+id);if(!target(id).latched){const r=action('toggle_latch');if(!r.ok)throw Error('latch '+JSON.stringify(r));}input();}
function walkX(x){for(let i=0;i<300;i++){const o=obs();if(!o.player.grounded)throw Error('walk lost support');if(Math.abs(o.player.x-x)<0.025){input();return;}input(Math.sign(x-o.player.x));steps(1);}throw Error('walk timeout '+x);}
function jump(id){if(tick-lastActionTick<36){input();steps(36-(tick-lastActionTick));}const d=target(id);if(!d)throw Error('jump target not visibly reachable '+id);const x=d.position.x;input(Math.sign(x-obs().player.x));if(!action('jump').ok)throw Error('jump rejected');for(let i=0;i<60;i++){const p=obs().player;const steering=(8*(x-p.x)-4.5*p.vx)/8.5;input(Math.abs(steering)<.08?0:Math.sign(steering));steps(DECISION_TICKS);if(obs().player.grounded){input();if(obs().player.supportId!==id)throw Error('jump '+id+' landed '+obs().player.supportId);mark('landed '+id);return;}}throw Error('jump timeout '+id);}
function pick(id){if(!obs().visiblePayloads.some(p=>p.id===id))throw Error('payload not visible '+id);for(let i=0;i<15;i++){if(obs().selectedPayload?.id===id)break;action('focus_next',{kind:'payload'});}if(obs().selectedPayload?.id!==id)throw Error('cargo selection failed');const r=action('interact_payload');if(!r.ok||obs().player.carriedPayload?.id!==id)throw Error('pickup failed '+id);mark('picked '+id);}
function place(id){focus(id);const r=action('interact_payload');if(!r.ok)throw Error('place failed '+JSON.stringify(r));steps(1);mark('placed into '+id);}
function dispatch(){focus(null);const chute=obs().reachable.chute;if(!chute)throw Error('no reachable chute');const r=action('interact_payload');if(!r.ok||r.mode!=='chute')throw Error('dispatch failed '+JSON.stringify(r));mark('dispatched '+chute.id);}
function until(predicate,maxSeconds,label){input();for(let i=0;i<maxSeconds/(DECISION_TICKS*FIXED_DT);i++){if(predicate(obs()))return;steps(DECISION_TICKS);}throw Error('timeout '+label);}
let failure=null;
try{
 wait(3);mark('opening');jump('drawer_catch_02');
 focus('drawer_s1_a');input(0,1);steps(24);input();
 if(action('toggle_latch').ok)throw Error('off-notch latch incorrectly accepted');mark('off-notch rejection');
 pullLatch('drawer_s1_a');pick('payload_trunk_01');jump('drawer_s1_a');place('drawer_s1_a');
 pullLatch('drawer_s1_b');jump('drawer_s1_b');
 until(o=>target('drawer_s1_c')?.railPosition>=1.91,15,'case extends #112');latch('drawer_s1_c');
 jump('drawer_s1_a');pick('payload_trunk_01');jump('drawer_s1_b');jump('drawer_s1_c');
 pullLatch('drawer_s2_ledge');jump('drawer_s2_ledge');mark('stage2 checkpoint');
 if(!showcase){
 focus('drawer_s2_ledge');action('toggle_latch');mark('unsecured ledge failure');
 until(o=>o.banner.text.startsWith('CHECKPOINT RESTORED'),12,'fall and retry');mark('checkpoint recovered');
 focus('drawer_s2_lift');action('toggle_latch');wait(2);jump('drawer_s2_lift');wait(1);mark('unloaded counterweight overload');
 jump('drawer_s2_ledge');latch('drawer_s2_lift');mark('returned to preserved ledge');
 }
 place('drawer_s2_ledge');
 action('toggle_hatch');pick('payload_carpet_02');place('drawer_s2_counter');
 pick('payload_instruments_05');place('drawer_s2_counter');
 pick('payload_trunk_01');jump('drawer_s2_lift');focus('drawer_s2_lift');action('toggle_latch');
 until(o=>o.stage===3,45,'loaded lift ascent');mark('stage3 checkpoint');
 until(o=>target('drawer_s2_lift')?.railPosition>=Math.max(...target('drawer_s2_lift').notches)-.04,10,'upper lift notch');latch('drawer_s2_lift');
 dispatch();until(o=>target('drawer_s3_a')?.railPosition>=1.91,20,'west cage extends #302');latch('drawer_s3_a');jump('drawer_s3_a');
 pick('payload_umbrella_04');dispatch();wait(1.5);pick('payload_ceramic_03');dispatch();
 jump('drawer_s3_b');until(o=>target('drawer_s3_b')?.railPosition>=Math.max(...target('drawer_s3_b').notches)-.04,50,'east cage lift');latch('drawer_s3_b');
 latch('drawer_s3_garden');jump('drawer_s3_garden');const r=action('open_garden');if(!r.ok)throw Error('garden '+JSON.stringify(r));wait(2);mark('completed');
}catch(e){failure=String(e);console.log(failure);mark('failure');}
fs.writeFileSync(new URL(outputPrefix+'ordinary-trace.json',outputBase),JSON.stringify(trace,null,2));
fs.writeFileSync(new URL(outputPrefix+'route-result.json',outputBase),JSON.stringify({failure,sourceHashes,mode:showcase?'showcase':'acceptance',controller:{decisionTicks:DECISION_TICKS,decisionSeconds:DECISION_TICKS*FIXED_DT,minimumActionSeconds:0.3},events,final:obs(),assertions:{stage:sim.stage,completed:sim.completed,checkpoints:Object.keys(sim.checkpoints),mass:Object.values(sim.payloads).reduce((n,p)=>n+p.massKg,0)}},null,2));
if(failure)process.exitCode=1;
