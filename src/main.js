import { FIXED_DT, ArchiveSimulation } from './physics.js';
import { PhysicsRuntimeAdapter } from './physics_adapter.js';
import { ArchiveAudioEngine } from './audio.js';
import { ArchiveSceneView } from './scene.js';

const STAGES = {
  1: ['01 / Find a way up', 'Catch the opening drawer. Move the trunk and lock three drawers into a staircase.'],
  2: ['02 / Balance the lift', 'Keep the return ledge clear. Open the cargo hatch, transfer a load, then ride the lift.'],
  3: ['03 / Reach the garden', 'Send the remaining loads through the chutes. Climb into the final drawer and release its shutter.']
};
const NAMES = {
  drawer_burst_01: 'Opening drawer · #101', receiving_tray_01: 'Receiving tray', drawer_catch_02: 'Catch drawer · #102',
  drawer_s1_a: 'Lower stair · #104', drawer_s1_b: 'Middle stair · #108', drawer_s1_c: 'Upper stair · #112',
  drawer_s2_ledge: 'Return ledge · #202', drawer_s2_counter: 'Counterweight · #204', drawer_s2_lift: 'Lift · #201',
  cage_s3_west: 'West load cage', cage_s3_east: 'East load cage', drawer_s3_a: 'West upper drawer · #302',
  drawer_s3_b: 'East upper drawer · #305', drawer_s3_garden: 'Garden drawer · #309',
  chute_upper_west: 'West transfer chute', chute_upper_east: 'East transfer chute'
};
const ACTIONS = new Set(['jump','toggle_latch','toggle_hatch','interact_payload','open_garden','restore_checkpoint','focus_next','focus_target','focus_payload']);
const el = (id) => document.getElementById(id);
const nameOf = (id) => NAMES[id] || 'Linked mechanism';

async function boot() {
  const [contract,world,provenance] = await Promise.all(['/contract.json','/world.json','/assets/textures/provenance.json'].map(async url => {
    const response=await fetch(url); if(!response.ok)throw new Error(`Cannot load ${url}`);return response.json();
  }));
  const params=new URLSearchParams(location.search);
  const capture=params.has('capture');
  document.body.classList.toggle('capture-clean',capture);
  const audio=new ArchiveAudioEngine();audio.captureMode=capture;
  const sim=new ArchiveSimulation(contract,world,audio);
  const adapter=new PhysicsRuntimeAdapter(sim,audio);
  const view=new ArchiveSceneView(el('viewport'),contract,world,provenance);
  await view.init(sim);
  // Inspection views never unlock or move game entities.
  const requestedView=params.get('view');
  if(requestedView && ['opening','follow','hero','closeup','clay_wireframe','material_isolation','coupled_proof'].includes(requestedView))view.setInspectionMode(requestedView);

  const keys=new Set();
  let replay=[],cursor=0,lastRenderedTime=0,cameraTimeline=[],cameraCursor=0;
  const cameraLog=[];
  const inputTrace=[];
  function input(values,record=true){adapter.setContinuousInput(values);if(record)inputTrace.push({type:'input',t:sim.time,...values});}
  function action(actionName,actionParams={},record=true){
    if(!ACTIONS.has(actionName))throw new Error(`Unsupported ordinary action: ${actionName}`);
    const result=adapter.dispatchAction(actionName,actionParams);
    if(record)inputTrace.push({type:'action',t:sim.time,action:actionName,params:actionParams,result});
    return result;
  }
  function syncKeys(){input({moveX:(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0),moveZ:(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0),railPull:(keys.has('KeyE')?1:0)-(keys.has('KeyQ')?1:0)});}
  const keyActions={Space:'jump',Tab:'focus_next',KeyL:'toggle_latch',KeyH:'toggle_hatch',KeyF:'interact_payload',KeyG:'open_garden',Enter:'open_garden',KeyR:'restore_checkpoint'};
  window.addEventListener('keydown',e=>{
    if(e.target instanceof HTMLButtonElement && e.code!=='Tab')return;
    if(keyActions[e.code]||['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
    if(e.repeat)return;
    audio.resume();keys.add(e.code);syncKeys();
    if(keyActions[e.code])action(keyActions[e.code],e.code==='Tab'&&e.shiftKey?{kind:'payload'}:{});
  });
  window.addEventListener('keyup',e=>{keys.delete(e.code);syncKeys();});
  window.addEventListener('blur',()=>{keys.clear();input({moveX:0,moveZ:0,railPull:0});});
  window.addEventListener('resize',()=>{view.resize(innerWidth,innerHeight);view.render();});
  el('btn-retry').addEventListener('click',e=>{action('restore_checkpoint');e.currentTarget.blur();updateHUD();});
  el('btn-audio').addEventListener('click',e=>{
    if(!audio.enabled){audio.enabled=true;audio.resume();}
    else if(audio.getStatus()==='locked')audio.resume();
    else audio.enabled=false;
    e.currentTarget.blur();
    updateHUD();
  });
  el('hud-targets').addEventListener('click',e=>{
    const button=e.target.closest('button[data-target]');if(!button)return;
    action('focus_target',{drawerId:button.dataset.target});button.blur();updateHUD();
  });
  el('hud-payloads').addEventListener('click',e=>{
    const button=e.target.closest('button[data-payload]');if(!button)return;
    action('focus_payload',{payloadId:button.dataset.payload});button.blur();updateHUD();
  });
  let targetsSignature='';
  let payloadsSignature='';
  function updateHUD(){
    const obs=adapter.getObservation();const stage=STAGES[obs.stage]||STAGES[1];
    el('hud-stage-title').textContent=obs.completed?'The garden is open':stage[0];
    el('hud-objective').textContent=obs.completed?'The archive has a way out.':stage[1];
    el('hud-alt').textContent=`${obs.player.y.toFixed(1)} m · ${obs.player.grounded?'on a ledge':'in the air'}`;
    el('hud-checkpoint').textContent=String(obs.checkpoint||'Start').replace(/^CP-\d[A-Z]?\s*/,'').replace(/[()]/g,'');
    el('hud-carried').textContent=obs.player.carriedPayload?`${obs.player.carriedPayload.label} · ${obs.player.carriedPayload.massKg} kg`:'Hands free';
    const banner=obs.banner;
    el('hud-banner').hidden=!(banner?.timer>0&&banner.text);
    el('hud-banner').textContent=banner?.text||'';el('hud-banner').dataset.kind=banner?.kind||'info';
    const fd=obs.focusedDrawer, selected=obs.selectedTarget;
    el('hud-mech-id').textContent=selected?(NAMES[selected.id]||selected.label):(fd?nameOf(fd.id):'No mechanism in reach');
    el('hud-mech-ext').textContent=fd?`Rail ${fd.zExt.toFixed(2)} m · height ${fd.y.toFixed(1)} m`:'';
    el('hud-mech-notch').textContent=fd?(fd.hasCargoHatch?`Cargo hatch ${fd.cargoHatchOpen?'open':'closed'}`:(fd.latched?'Latch locked':'Latch released')):'';
    el('hud-mech-load').textContent=fd?`${fd.payloadMassKg} kg cargo · ${fd.effectiveMassKg} kg total${fd.coupledTo?` → ${nameOf(fd.coupledTo)}`:''}`:'';
    const targets=obs.interactionTargets||[];
    const signature=JSON.stringify(targets.map(t=>[t.id,t.label,t.selected]));
    if(signature!==targetsSignature){
      el('hud-targets').replaceChildren(...targets.map(t=>{const b=document.createElement('button');b.type='button';b.dataset.target=t.id;b.textContent=NAMES[t.id]||t.label||'Nearby mechanism';b.setAttribute('aria-pressed',String(Boolean(t.selected)));return b;}));targetsSignature=signature;
    }
    const payloads=obs.visiblePayloads||[];const payloadSignature=JSON.stringify([payloads.map(p=>[p.id,p.label,p.massKg]),obs.selectedPayload?.id]);
    if(payloadSignature!==payloadsSignature){
      el('hud-payloads').replaceChildren(...payloads.map(p=>{const b=document.createElement('button');b.type='button';b.dataset.payload=p.id;b.textContent=`${p.label} · ${p.massKg} kg`;b.setAttribute('aria-pressed',String(obs.selectedPayload?.id===p.id));return b;}));payloadsSignature=payloadSignature;
    }
    el('hud-select-hint').textContent=targets.length?(selected?'Tab · choose a nearby mechanism':'Nearest target · Tab to select'):'Move closer to a mechanism';
    el('hud-cargo-selection').textContent=obs.selectedPayload?`Cargo selected: ${obs.selectedPayload.label}`:payloads.length?'Shift + Tab · choose nearby cargo':'';
    const status=audio.getStatus();el('btn-audio').textContent=status==='running'?'Sound on':status==='muted'?'Sound off':'Enable sound';
    el('btn-audio').setAttribute('aria-pressed',String(status==='running'));
  }
  function normalizeTimeline(timeline){
    if(!Array.isArray(timeline))throw new Error('Replay must be an array');
    return timeline.map(ev=>{
      const t=Number.isFinite(ev.t)?ev.t:Number(ev.tick)*FIXED_DT;
      if(!Number.isFinite(t)||t<0||!['input','action'].includes(ev.type))throw new Error('Invalid replay event');
      if(ev.type==='action'&&!ACTIONS.has(ev.action))throw new Error(`Replay contains nonordinary action ${ev.action}`);
      return {...ev,t};
    }).sort((a,b)=>a.t-b.t);
  }
  function renderAt(targetSeconds){
    const target=Number(targetSeconds);if(!Number.isFinite(target)||target<0)throw new Error('Invalid capture time');
    if(target<sim.time-1e-6){audio.resetSchedule(true);sim.resetFull();cursor=0;cameraCursor=0;cameraLog.length=0;inputTrace.length=0;lastRenderedTime=0;}
    while(sim.time+FIXED_DT*.5<=target){
      while(cursor<replay.length&&replay[cursor].t<=sim.time+1e-6){const ev=replay[cursor++];if(ev.type==='input')input(ev);else action(ev.action,ev.params||{});}
      adapter.stepFixed(FIXED_DT);
    }
    while(cameraCursor<cameraTimeline.length&&cameraTimeline[cameraCursor].t<=sim.time+1e-6){
      const cue=cameraTimeline[cameraCursor++];const permitted=sim.stage>=(cue.minStage||1)&&(!cue.requiresCompleted||sim.completed);
      if(permitted)view.setInspectionMode(cue.mode);
      cameraLog.push({...cue,applied:permitted,observedStage:sim.stage,observedCompleted:sim.completed});
    }
    view.syncFromSimulation(sim,Math.max(0,target-lastRenderedTime));lastRenderedTime=target;updateHUD();view.render();return adapter.getObservation();
  }
  window.renderAt=renderAt;window.gameState=sim;
  window.gameController={sim,adapter,audio,view,dispatchAction:action,setContinuousInput:input,getObservation:()=>adapter.getObservation(),
    loadOrdinaryReplayTimeline:timeline=>{replay=normalizeTimeline(timeline);cursor=0;},
    loadCaptureCameraTimeline:timeline=>{cameraTimeline=timeline.map(c=>{if(!Number.isFinite(c.t)||c.t<0||!['opening','follow','hero','coupled_proof','garden_payoff'].includes(c.mode))throw new Error('Invalid camera cue');return {...c,requiresCompleted:c.mode==='garden_payoff'||Boolean(c.requiresCompleted)};}).sort((a,b)=>a.t-b.t);cameraCursor=0;},
    getCaptureEvidence:()=>({inputTrace:structuredClone(inputTrace),actionLog:structuredClone(adapter.actionLog),audioEvents:structuredClone(audio.eventLog),cameraLog:structuredClone(cameraLog),replayCursor:cursor}),renderAt};
  window.ready=true;
  let previous=performance.now();
  function animate(now){requestAnimationFrame(animate);if(capture)return;const dt=(now-previous)/1000;previous=now;adapter.update(dt);view.syncFromSimulation(sim,dt);updateHUD();view.render();}
  updateHUD();view.syncFromSimulation(sim,0);view.render();requestAnimationFrame(animate);
}
boot().catch(error=>{window.bootError=String(error.stack||error);console.error(error);});
