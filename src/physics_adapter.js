/**
 * Physics Action & Observation Adapter (`src/physics_adapter.js`)
 *
 * Bridges `src/main.js` (browser UI, keyboard controls, camera, HUD, and capture harness)
 * to `src/physics.js`.
 *
 * Enforces the supervisor's runtime rules:
 * 1. Bounded ordinary player actions ONLY:
 *    - Grounded jump (`jump`) — never `jumpToDrawer` or airborne velocity injection
 *    - Continuous movement (`moveX`, `moveZ`) and nearby rail push/pull (`railPull`)
 *    - Local reach-checked notch latch/release (`toggle_latch`)
 *    - Local reach-checked cargo hatch toggle (`toggle_hatch`)
 *    - Local two-step payload pickup (`pickup`) and local transfer/chute dispatch (`transfer` / `interact_payload`)
 *    - Local interior garden shutter release (`open_garden`) requiring player inside `#309`
 *    - Full-state checkpoint restore (`restore_checkpoint`) clearing `completed`, `gardenLightFactor`,
 *      transient inputs, stale drawer velocities, and audio throttle schedules.
 * 2. Forward-compatible with the staged `.run/physics-repair/src/physics.js` handoff:
 *    if the repaired `ArchiveSimulation` exposes native local methods (`dispatchAction`,
 *    `pickupNearbyPayload`, `placeOrDispatchCarriedPayload`, `getObservation`), the adapter
 *    delegates to them while preserving a uniform API for `src/main.js`.
 */

import { FIXED_DT } from './physics.js';

export const INTERACT_REACH_M = 2.45;
export const CHUTE_REACH_M = 2.45;

export class PhysicsRuntimeAdapter {
  constructor(sim, audio = null) {
    this.sim = sim;
    this.audio = audio;
    this.actionLog = [];
  }

  setContinuousInput({ moveX = 0, moveZ = 0, railPull = 0 }) {
    this.sim.input.moveX = Math.max(-1, Math.min(1, Number(moveX) || 0));
    this.sim.input.moveZ = Math.max(-1, Math.min(1, Number(moveZ) || 0));
    this.sim.input.railPull = Math.max(-1, Math.min(1, Number(railPull) || 0));
  }

  /**
   * Step fixed simulation while guarding against stale rail velocity when input stops.
   */
  stepFixed(dt = FIXED_DT) {
    const prevZMap = {};
    const prevYMap = {};
    for (const [id, d] of Object.entries(this.sim.drawers)) {
      prevZMap[id] = d.zExt;
      prevYMap[id] = d.y;
    }

    const restoresBefore = this.sim.stats.checkpointsRestored;

    this.sim.stepFixed(dt);

    if (this.sim.stats.checkpointsRestored !== restoresBefore) {
      for (const d of Object.values(this.sim.drawers)) {
        d.vz = 0.0;
        d.vy = 0.0;
      }
      return;
    }

    // Ensure drawer velocities reflect actual frame displacement (fixes stale rail velocity watchpoint)
    let railMotion = null;
    for (const [id, d] of Object.entries(this.sim.drawers)) {
      const motionSpeed = Math.hypot(d.zExt - prevZMap[id], d.y - prevYMap[id]) / dt;
      if (motionSpeed > 0.06 && (!railMotion || motionSpeed > railMotion.speed)) {
        railMotion = { speed: motionSpeed, x: d.x, drawer: d.number };
      }
      if (typeof d.zExt === 'number' && typeof prevZMap[id] === 'number') {
        const actualVz = (d.zExt - prevZMap[id]) / dt;
        if (Math.abs(this.sim.input.railPull) < 0.01 && Math.abs(actualVz) < 1e-4) {
          d.vz = 0.0;
        } else {
          d.vz = actualVz;
        }
      }
      if (typeof d.y === 'number' && typeof prevYMap[id] === 'number') {
        const actualVy = (d.y - prevYMap[id]) / dt;
        if (Math.abs(actualVy) < 1e-4) {
          d.vy = 0.0;
        }
      }
    }
    // Emit from fixed-step displacement, including gravity-driven motion. The
    // shared synth throttles this bed to one short friction event per 0.18 s.
    if (this.audio && railMotion) this.audio.trigger(this.sim.time, 'rail_slide', railMotion);
  }

  update(frameDeltaSeconds) {
    const clamped = Math.min(Math.max(frameDeltaSeconds, 0.0), 0.25);
    this.sim.accumulator = (this.sim.accumulator || 0.0) + clamped;
    let steps = 0;
    while (this.sim.accumulator >= FIXED_DT - 1e-9) {
      this.stepFixed(FIXED_DT);
      this.sim.accumulator -= FIXED_DT;
      steps += 1;
    }
    return steps;
  }

  _distToDrawer(d) {
    const p = this.sim.player;
    const dx = Math.max(0, Math.abs(p.x - d.x) - (d.width || 1.5) * 0.5);
    const topY = this.sim.getSupportTop(d);
    const dy = Math.abs(p.y - topY);
    const dz = Math.max(0, Math.abs(p.z - (d.zExt || 1.0)) - (d.depth || 2.0) * 0.5);
    return Math.hypot(dx, dy, dz);
  }

  _distToPoint(x, y, z) {
    const p = this.sim.player;
    return Math.hypot(p.x - x, p.y - y, (p.z || 1.15) - (z || 1.15));
  }

  getNearestReachableDrawer(maxReach = INTERACT_REACH_M) {
    let best = null;
    let bestDist = Infinity;
    for (const d of Object.values(this.sim.drawers)) {
      const dist = this._distToDrawer(d);
      if (dist <= maxReach && dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return { drawer: best, distance: bestDist };
  }

  getNearestReachablePayload(maxReach = INTERACT_REACH_M) {
    const selected=this.sim.payloads[this.sim.selectedPayloadId];
    if(selected?.state==='resting' && this.getVisiblePayloads().some(p=>p.id===selected.id)) return {payload:selected,distance:this._distToPoint(selected.x,selected.y,selected.z)};
    let best = null;
    let bestDist = Infinity;
    for (const item of Object.values(this.sim.payloads)) {
      if (item.state !== 'resting') continue;
      if (item.id === 'rolling_parcel_01' && item.holderId === 'receiving_tray_01') continue;
      const dist = this._distToPoint(item.x, item.y, item.z);
      if (dist <= maxReach && dist < bestDist) {
        bestDist = dist;
        best = item;
      }
    }
    return { payload: best, distance: bestDist };
  }

  getNearestReachableChute(maxReach = CHUTE_REACH_M) {
    let best = null;
    let bestDist = Infinity;
    for (const c of Object.values(this.sim.chutes || {})) {
      const dist = this._distToPoint(c.entryX, c.entryY, c.entryZ);
      if (dist <= maxReach && dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    return { chute: best, distance: bestDist };
  }

  /**
   * Dispatch a discrete, bounded player action through validated physical rules.
   */
  dispatchAction(actionType, params = {}) {
    const sim = this.sim;
    const t = Number(sim.time.toFixed(4));
    let result = { ok: false, action: actionType };

    // If repaired physics provides native dispatchAction, use it for supported actions
    if (typeof sim.dispatchAction === 'function') {
      result = sim.dispatchAction(actionType, params);
      this.actionLog.push({ t, action: actionType, params, result });
      return result;
    }

    switch (actionType) {
      case 'focus_next': {
        if(params.kind==='payload'){
          const items=this.getVisiblePayloads(),i=items.findIndex(p=>p.id===sim.selectedPayloadId);
          sim.selectedPayloadId=items.length&&i<items.length-1?items[i+1].id:null;
          result={ok:true,payloadId:sim.selectedPayloadId};break;
        }
        const targets=this.getInteractionTargets();
        const index=targets.findIndex(d=>d.id===sim.interactionTargetId);
        sim.interactionTargetId=targets.length && index<targets.length-1 ? targets[index+1].id : null;
        result={ok:!!sim.interactionTargetId,drawerId:sim.interactionTargetId}; break;
      }
      case 'focus_target': {
        const target=this.getInteractionTargets().find(d=>d.id===params.drawerId);
        if(target)sim.interactionTargetId=target.id;
        result={ok:!!target,drawerId:target?.id,reason:target?undefined:'out_of_reach'}; break;
      }
      case 'focus_payload': {
        const item=this.getVisiblePayloads().find(p=>p.id===params.payloadId);
        if(item)sim.selectedPayloadId=item.id;
        result={ok:!!item,payloadId:item?.id,reason:item?undefined:'out_of_reach'};break;
      }
      case 'jump': {
        if (!sim.player.grounded) {
          sim.showBanner('JUMP REJECTED: Character must have grounded foothold support to jump.', 'reject', 2.0);
          result = { ok: false, reason: 'airborne' };
          break;
        }
        const jumped = sim.jump();
        result = { ok: Boolean(jumped), vx: sim.player.vx, vy: sim.player.vy };
        break;
      }

      case 'toggle_latch': {
        const targetId = params.drawerId || null;
        const candidate = targetId ? sim.drawers[targetId] : sim.getFocusedDrawer();
        if (!candidate) {
          if (this.audio) this.audio.trigger(sim.time, 'latch_reject', {});
          sim.showBanner('LATCH REJECTED: No drawer rail within reach (< 2.45m).', 'reject', 2.6);
          result = { ok: false, reason: 'out_of_reach' };
          break;
        }
        const dist = this._distToDrawer(candidate);
        if (dist > INTERACT_REACH_M) {
          if (this.audio) this.audio.trigger(sim.time, 'latch_reject', { drawer: candidate.number });
          sim.showBanner(
            `LATCH OUT OF REACH: ${candidate.number} is ${dist.toFixed(2)}m away (max reach ${INTERACT_REACH_M}m).`,
            'reject',
            2.8
          );
          result = { ok: false, reason: 'out_of_reach', distance: dist };
          break;
        }
        result = sim.toggleDrawerLatch(candidate.id);
        break;
      }

      case 'toggle_hatch': {
        const hatchDrawer = sim.drawers.drawer_s2_counter;
        const dist = hatchDrawer ? this._distToDrawer(hatchDrawer) : Infinity;
        if (!hatchDrawer || dist > INTERACT_REACH_M) {
          if (this.audio) this.audio.trigger(sim.time, 'latch_reject', { drawer: '#204' });
          sim.showBanner(
            `HATCH OUT OF REACH: Move closer to Counterweight Cage #204 (${Number.isFinite(dist) ? dist.toFixed(2) : '?'}m > ${INTERACT_REACH_M}m).`,
            'reject',
            2.8
          );
          result = { ok: false, reason: 'out_of_reach', distance: dist };
          break;
        }
        result = sim.toggleCargoHatch('drawer_s2_counter');
        break;
      }

      case 'interact_payload': {
        // Two-stage local interaction:
        // 1) If empty-handed, pick up nearest reachable payload within 2.45m.
        // 2) If carrying a payload, dispatch into a reachable chute OR place into a reachable drawer/cage.
        if (!sim.player.carriedPayloadId) {
          const { payload, distance } = this.getNearestReachablePayload();
          if (!payload) {
            if (this.audio) this.audio.trigger(sim.time, 'latch_reject', {});
            sim.showBanner('NO PAYLOAD IN REACH: Move within 2.45m of a trunk, carpet, parcel, or case.', 'reject', 2.6);
            result = { ok: false, reason: 'no_reachable_payload' };
            break;
          }
          const holder = payload.holderId ? sim.drawers[payload.holderId] : null;
          if(holder && holder.zExt<0.4) { result={ok:false,reason:'source_retracted'}; break; }
          if (holder && holder.hasCargoHatch && !holder.cargoHatchOpen) {
            if (this.audio) this.audio.trigger(sim.time, 'latch_reject', { drawer: holder.number });
            sim.showBanner(`PICKUP REJECTED: ${holder.number} Cargo Hatch is CLOSED! Press [H] first.`, 'reject', 3.0);
            result = { ok: false, reason: 'hatch_closed' };
            break;
          }
          sim.player.carriedPayloadId = payload.id;
          payload.holderId = null;
          payload.state = 'carried';
          if(holder?.jammed){
            holder.jamPayloadIds=(holder.jamPayloadIds||[]).filter(id=>id!==payload.id);
            if(holder.jamPayloadIds.length===0)sim.triggerCargoJam(holder.id,false);
          }
          if (this.audio) this.audio.trigger(sim.time, 'payload_transfer', { payload: payload.id, mass: payload.massKg });
          sim.showBanner(`PICKED UP ${payload.label} (${payload.massKg} kg) — Carry to target tray or chute and press [F]`, 'info', 3.0);
          result = { ok: true, mode: 'pickup', payloadId: payload.id, massKg: payload.massKg, distance };
        } else {
          const carriedId = sim.player.carriedPayloadId;
          const carried = sim.payloads[carriedId];

          const selectedTarget = sim.interactionTargetId ? sim.drawers[sim.interactionTargetId] : null;
          if (!params.targetId && selectedTarget && this._distToDrawer(selectedTarget) <= INTERACT_REACH_M) {
            params = { ...params, targetId: selectedTarget.id };
          }
          // Priority 1: Explicit targetId if passed and within reach
          if (params.targetId) {
            if (sim.chutes[params.targetId]) {
              const c = sim.chutes[params.targetId];
              const dChute = this._distToPoint(c.entryX, c.entryY, c.entryZ);
              if (dChute > CHUTE_REACH_M) {
                sim.stats.impossibleTransfers += 1;
                sim.showBanner(`CHUTE OUT OF REACH: ${c.label} is ${dChute.toFixed(2)}m away.`, 'reject', 3.0);
                result = { ok: false, reason: 'chute_out_of_reach', distance: dChute };
                break;
              }
              result = sim.transferPayload(carriedId, c.id);
              break;
            }
            const td = sim.drawers[params.targetId];
            if (td) {
              const dTray = this._distToDrawer(td);
              if (dTray > INTERACT_REACH_M) {
                sim.stats.impossibleTransfers += 1;
                sim.showBanner(`TRANSFER REJECTED: ${td.number} is ${dTray.toFixed(2)}m away (max ${INTERACT_REACH_M}m).`, 'reject', 3.0);
                result = { ok: false, reason: 'tray_out_of_reach', distance: dTray };
                break;
              }
              result = sim.transferPayload(carriedId, td.id);
              break;
            }
          }

          if (params.targetId) {
            result = { ok: false, reason: 'invalid_target' };
            break;
          }

          // Priority 2: Nearest reachable chute entry
          const { chute } = this.getNearestReachableChute();
          if (chute) {
            result = sim.transferPayload(carriedId, chute.id);
            break;
          }

          // Priority 3: Nearest reachable drawer/cage (preferring a different tray than current support if adjacent)
          let targetDrawer = null;
          let bestScore = Infinity;
          for (const d of Object.values(sim.drawers)) {
            const dist = this._distToDrawer(d);
            if (dist <= INTERACT_REACH_M) {
              const score = d.id === sim.player.supportId ? dist + 0.65 : dist;
              if (score < bestScore) {
                bestScore = score;
                targetDrawer = d;
              }
            }
          }
          if (!targetDrawer) {
            sim.showBanner(`CANNOT PLACE ${carried.label}: No reachable tray or chute within ${INTERACT_REACH_M}m.`, 'reject', 2.8);
            result = { ok: false, reason: 'no_reachable_target' };
            break;
          }
          result = sim.transferPayload(carriedId, targetDrawer.id);
        }
        break;
      }

      case 'open_garden': {
        const d309 = sim.drawers.drawer_s3_garden;
        const onGardenDrawer = sim.player.grounded && sim.player.supportId === 'drawer_s3_garden';
        const dist = d309 ? this._distToDrawer(d309) : Infinity;
        if (!onGardenDrawer || dist > 1.25) {
          if (this.audio) this.audio.trigger(sim.time, 'latch_reject', { drawer: '#309' });
          sim.showBanner('GARDEN SHUTTER LOCKED: Climb inside top Drawer #309 before pulling the interior release!', 'reject', 3.4);
          result = { ok: false, reason: 'not_inside_garden_drawer' };
          break;
        }
        result = sim.openGardenShutter();
        break;
      }

      case 'restore_checkpoint': {
        const ok = sim.restoreCheckpoint(params.checkpointId || null, params.reason || '');
        const d309 = sim.drawers.drawer_s3_garden;
        // Completion is restored by the authoritative simulation checkpoint.
        sim.gardenLightFactor = d309 ? (d309.shutterOpen || 0.0) : 0.0;
        sim.input.moveX = 0.0;
        sim.input.moveZ = 0.0;
        sim.input.railPull = 0.0;
        if (this.audio) this.audio.resetSchedule(false);
        result = { ok, checkpoint: sim.activeCheckpointId, stage: sim.stage, completed: sim.completed };
        break;
      }

      default:
        result = { ok: false, reason: `unknown_action:${actionType}` };
        break;
    }

    this.actionLog.push({ t, action: actionType, params, result });
    return result;
  }

  /**
   * Player-visible observation object for HUD and legitimate automated play.
   */
  getVisiblePayloads() {
    return Object.values(this.sim.payloads).filter(p=>p.state==='resting' && p.id!=='rolling_parcel_01' && this._distToPoint(p.x,p.y,p.z)<=INTERACT_REACH_M && (!p.holderId || this.sim.drawers[p.holderId]?.zExt>=0.4)).map(p=>({id:p.id,label:p.label,massKg:p.massKg,position:{x:p.x,y:p.y,z:p.z}}));
  }

  getInteractionTargets() {
    return Object.values(this.sim.drawers).filter(d=>this._distToDrawer(d)<=INTERACT_REACH_M && d.notches?.length).map(d=>({id:d.id,label:d.number,number:d.number,distance:this._distToDrawer(d),selected:d.id===this.sim.interactionTargetId,position:{x:d.x,y:this.sim.getSupportTop(d),z:d.zExt},latched:d.latched,railPosition:d.verticalNotches?d.y:d.zExt,notches:d.verticalNotches||d.notches,vertical:!!d.verticalNotches,manualRail:d.manualRail}));
  }

  getObservation() {
    const sim = this.sim;
    const focused = sim.getFocusedDrawer();
    const { drawer: reachableDrawer, distance: drawerDist } = this.getNearestReachableDrawer();
    const { payload: reachablePayload, distance: payloadDist } = this.getNearestReachablePayload();
    const { chute: reachableChute, distance: chuteDist } = this.getNearestReachableChute();
    const carried = sim.player.carriedPayloadId ? sim.payloads[sim.player.carriedPayloadId] : null;

    return {
      visiblePayloads:this.getVisiblePayloads(),
      selectedPayload:this.getVisiblePayloads().find(p=>p.id===sim.selectedPayloadId)||null,
      interactionTargets:this.getInteractionTargets(),
      selectedTarget:sim.interactionTargetId ? {id:sim.interactionTargetId,label:sim.drawers[sim.interactionTargetId]?.number,number:sim.drawers[sim.interactionTargetId]?.number} : null,
      time: Number(sim.time.toFixed(3)),
      stage: sim.stage,
      completed: sim.completed,
      checkpoint: sim.activeCheckpointId,
      banner: { ...sim.banner },
      player: {
        x: Number(sim.player.x.toFixed(3)),
        y: Number(sim.player.y.toFixed(3)),
        z: Number(sim.player.z.toFixed(3)),
        vx: Number(sim.player.vx.toFixed(3)),
        vy: Number(sim.player.vy.toFixed(3)),
        vz: Number(sim.player.vz.toFixed(3)),
        grounded: sim.player.grounded,
        supportId: sim.player.supportId,
        carriedPayload: carried ? { id: carried.id, label: carried.label, massKg: carried.massKg } : null
      },
      focusedDrawer: focused ? {
        id: focused.id,
        number: focused.number,
        zExt: Number((focused.zExt || 0).toFixed(3)),
        y: Number(focused.y.toFixed(3)),
        latched: Boolean(focused.latched),
        notches: focused.notches || [],
        payloadMassKg: sim.getDrawerPayloadMass(focused.id),
        effectiveMassKg: sim.getDrawerEffectiveMass(focused.id),
        hasCargoHatch: Boolean(focused.hasCargoHatch),
        cargoHatchOpen: Boolean(focused.cargoHatchOpen),
        coupledTo: focused.coupledTo || null
      } : null,
      reachable: {
        drawer: reachableDrawer ? { id: reachableDrawer.id, number: reachableDrawer.number, distance: Number(drawerDist.toFixed(2)) } : null,
        payload: reachablePayload ? { id: reachablePayload.id, label: reachablePayload.label, massKg: reachablePayload.massKg, distance: Number(payloadDist.toFixed(2)) } : null,
        chute: reachableChute ? { id: reachableChute.id, label: reachableChute.label, distance: Number(chuteDist.toFixed(2)) } : null
      }
    };
  }
}
