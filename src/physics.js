import {supportTop, surfaceAt, supportSurfaces, localPlayerPoint, payloadRestPose, payloadChutePose} from './support.js';
import {applyRuntimeLayout, stepMechanisms, stepGravityChute} from './mechanisms.js';
/**
 * Authoritative Fixed-Timestep Physics, Coupled Counterweights, Rail Constraints,
 * Payloads, Checkpoints, Automated Self-Tests, and Valid Input Replay Controller
 * for The Vertical Lost & Found.
 */

export const FIXED_DT = 1 / 120; // 0.008333333333333333 s
export const GRAVITY = 9.81;
export const PLAYER_MASS_KG = 65.0;
export const NOTCH_TOLERANCE_M = 0.10;

export class ArchiveSimulation {
  constructor(contract, world, audio = null) {
    this.contract = contract;
    this.world = world;
    this.audio = audio;
    this.resetFull();
  }

  resetFull() {
    this.time = 0.0;
    this.accumulator = 0.0;
    this.stage = 1;
    this.completed = false;
    this.gardenLightFactor = 0.0;
    this.banner = { text: '', kind: 'info', timer: 0 };

    this.stats = {
      notchRejections: 0,
      impossibleTransfers: 0,
      overloadWarnings: 0,
      cargoJamsCleared: 0,
      checkpointsRestored: 0,
      chutesDispatched: 0
    };

    // Build authoritative drawers & cages map
    this.drawers = {
      drawer_burst_01: {
        id: 'drawer_burst_01',
        number: '#101',
        stage: 1,
        x: -5.2,
        y: 1.2,
        baseY: 1.2,
        zExt: 0.85,
        vz: 0.0,
        vy: 0.0,
        minZ: 0.0,
        maxZ: 2.2,
        notches: [0.60, 1.30, 1.85],
        latched: false,
        latchedNotchIndex: -1,
        baseMassKg: 45.0,
        maxLoadKg: 120.0,
        width: 1.55,
        height: 0.62,
        depth: 2.10,
        coupledTo: 'receiving_tray_01',
        burstTriggered: false,
        rejectFlashTimer: 0,
        jammed: false
      },
      receiving_tray_01: {
        id: 'receiving_tray_01',
        number: 'TRAY-T1',
        stage: 1,
        x: -3.8,
        y: 0.95,
        baseY: 0.95,
        zExt: 1.45,
        vz: 0.0,
        vy: 0.0,
        tiltRad: 0.0,
        minY: 0.35,
        maxY: 0.95,
        notches: [],
        latched: false,
        baseMassKg: 20.0,
        maxLoadKg: 90.0,
        width: 1.35,
        height: 0.25,
        depth: 1.35,
        coupledTo: 'drawer_catch_02',
        tipped: false
      },
      drawer_catch_02: {
        id: 'drawer_catch_02',
        number: '#102',
        stage: 1,
        x: -3.4,
        y: 1.35,
        baseY: 1.35,
        zExt: 0.15,
        vz: 0.0,
        vy: 0.0,
        minZ: 0.0,
        maxZ: 2.1,
        notches: [0.60, 1.30, 1.85],
        latched: false,
        latchedNotchIndex: -1,
        baseMassKg: 45.0,
        maxLoadKg: 120.0,
        width: 1.55,
        height: 0.62,
        depth: 2.10,
        coupledTo: 'receiving_tray_01',
        rejectFlashTimer: 0,
        jammed: false
      },
      drawer_s1_a: {
        id: 'drawer_s1_a',
        number: '#104',
        stage: 1,
        x: -1.6,
        y: 1.95,
        baseY: 1.95,
        zExt: 0.60,
        vz: 0.0,
        vy: 0.0,
        minZ: 0.0,
        maxZ: 2.2,
        notches: [0.60, 1.30, 1.95],
        latched: true,
        latchedNotchIndex: 0,
        baseMassKg: 50.0,
        maxLoadKg: 130.0,
        width: 1.55,
        height: 0.62,
        depth: 2.10,
        coupledTo: 'drawer_s1_c',
        rejectFlashTimer: 0,
        jammed: false
      },
      drawer_s1_b: {
        id: 'drawer_s1_b',
        number: '#108',
        stage: 1,
        x: 0.2,
        y: 2.75,
        baseY: 2.75,
        zExt: 0.72,
        vz: 0.0,
        vy: 0.0,
        minZ: 0.0,
        maxZ: 2.2,
        notches: [0.60, 1.30, 1.95],
        latched: false,
        latchedNotchIndex: -1,
        baseMassKg: 50.0,
        maxLoadKg: 130.0,
        width: 1.55,
        height: 0.62,
        depth: 2.10,
        coupledTo: null,
        rejectFlashTimer: 0,
        jammed: false
      },
      drawer_s1_c: {
        id: 'drawer_s1_c',
        number: '#112',
        stage: 1,
        x: 2.0,
        y: 3.55,
        baseY: 3.55,
        zExt: 0.35,
        vz: 0.0,
        vy: 0.0,
        minZ: 0.0,
        maxZ: 2.2,
        notches: [0.60, 1.30, 1.95],
        latched: false,
        latchedNotchIndex: -1,
        baseMassKg: 50.0,
        maxLoadKg: 130.0,
        width: 1.55,
        height: 0.62,
        depth: 2.10,
        coupledTo: 'drawer_s1_a',
        rejectFlashTimer: 0,
        jammed: false
      },
      drawer_s2_ledge: {
        id: 'drawer_s2_ledge',
        number: '#202',
        stage: 2,
        x: 3.6,
        y: 4.35,
        baseY: 4.35,
        zExt: 1.30,
        vz: 0.0,
        vy: 0.0,
        minZ: 0.0,
        maxZ: 2.2,
        notches: [0.60, 1.30, 1.95],
        latched: true,
        latchedNotchIndex: 1,
        baseMassKg: 52.0,
        maxLoadKg: 140.0,
        width: 1.55,
        height: 0.62,
        depth: 2.10,
        coupledTo: null,
        rejectFlashTimer: 0,
        jammed: false
      },
      drawer_s2_counter: {
        id: 'drawer_s2_counter',
        number: '#204',
        stage: 2,
        x: 1.7,
        y: 5.25,
        baseY: 5.25,
        minY: 3.45,
        maxY: 5.65,
        zExt: 1.45,
        vz: 0.0,
        vy: 0.0,
        minZ: 1.45,
        maxZ: 1.45,
        notches: [1.45],
        latched: false,
        baseMassKg: 40.0,
        maxLoadKg: 150.0,
        width: 1.45,
        height: 0.35,
        depth: 1.35,
        coupledTo: 'drawer_s2_lift',
        hasCargoHatch: true,
        cargoHatchOpen: false,
        rejectFlashTimer: 0,
        jammed: false
      },
      drawer_s2_lift: {
        id: 'drawer_s2_lift',
        number: '#201',
        stage: 2,
        x: -0.6,
        y: 4.45,
        baseY: 4.45,
        minY: 4.15,
        maxY: 7.85,
        zExt: 1.65,
        vz: 0.0,
        vy: 0.0,
        minZ: 0.0,
        maxZ: 2.2,
        notches: [0.60, 1.30, 1.65, 1.95],
        latched: true,
        latchedNotchIndex: 2,
        baseMassKg: 55.0,
        maxLoadKg: 165.0,
        width: 1.55,
        height: 0.62,
        depth: 2.10,
        coupledTo: 'drawer_s2_counter',
        rejectFlashTimer: 0,
        jammed: false
      },
      cage_s3_west: {
        id: 'cage_s3_west',
        number: 'CAGE-W3',
        stage: 3,
        x: -4.2,
        y: 8.6,
        baseY: 8.6,
        minY: 6.6,
        maxY: 8.6,
        zExt: 1.35,
        vz: 0.0,
        vy: 0.0,
        notches: [],
        latched: false,
        baseMassKg: 30.0,
        maxLoadKg: 140.0,
        width: 1.35,
        height: 0.35,
        depth: 1.35,
        coupledTo: 'drawer_s3_a'
      },
      drawer_s3_a: {
        id: 'drawer_s3_a',
        number: '#302',
        stage: 3,
        x: -2.2,
        y: 8.75,
        baseY: 8.75,
        zExt: 0.35,
        vz: 0.0,
        vy: 0.0,
        minZ: 0.0,
        maxZ: 2.2,
        notches: [0.60, 1.30, 1.95],
        latched: false,
        latchedNotchIndex: -1,
        baseMassKg: 50.0,
        maxLoadKg: 150.0,
        width: 1.55,
        height: 0.62,
        depth: 2.10,
        coupledTo: 'cage_s3_west',
        rejectFlashTimer: 0,
        jammed: false
      },
      cage_s3_east: {
        id: 'cage_s3_east',
        number: 'CAGE-E3',
        stage: 3,
        x: 3.8,
        y: 10.4,
        baseY: 10.4,
        minY: 8.2,
        maxY: 10.4,
        zExt: 1.35,
        vz: 0.0,
        vy: 0.0,
        notches: [],
        latched: false,
        baseMassKg: 35.0,
        maxLoadKg: 160.0,
        width: 1.35,
        height: 0.35,
        depth: 1.35,
        coupledTo: 'drawer_s3_b'
      },
      drawer_s3_b: {
        id: 'drawer_s3_b',
        number: '#305',
        stage: 3,
        x: 0.2,
        y: 9.65,
        baseY: 9.65,
        minY: 9.65,
        maxY: 11.45,
        zExt: 1.75,
        vz: 0.0,
        vy: 0.0,
        minZ: 0.0,
        maxZ: 2.2,
        notches: [0.60, 1.30, 1.75, 1.95],
        latched: false,
        latchedNotchIndex: -1,
        baseMassKg: 58.0,
        maxLoadKg: 165.0,
        width: 1.55,
        height: 0.62,
        depth: 2.10,
        coupledTo: 'cage_s3_east',
        rejectFlashTimer: 0,
        jammed: false
      },
      drawer_s3_garden: {
        id: 'drawer_s3_garden',
        number: '#309',
        stage: 3,
        x: 0.0,
        y: 13.35,
        baseY: 13.35,
        zExt: 0.45,
        vz: 0.0,
        vy: 0.0,
        minZ: 0.0,
        maxZ: 2.3,
        notches: [0.60, 1.30, 2.05],
        latched: false,
        latchedNotchIndex: -1,
        baseMassKg: 80.0,
        maxLoadKg: 220.0,
        width: 1.95,
        height: 0.72,
        depth: 2.35,
        coupledTo: 'cage_s3_east',
        shutterOpen: 0.0,
        shutterTarget: 0.0,
        rejectFlashTimer: 0,
        jammed: false
      }
    };

    // Rigid Payloads with preserved identity and mass
    this.payloads = {
      rolling_parcel_01: {
        id: 'rolling_parcel_01',
        label: 'Dispatch Brass Parcel',
        massKg: 18.0,
        meshId: 'mesh_ceramic_parcel',
        holderId: 'drawer_burst_01',
        x: -5.2,
        y: 1.55,
        z: 1.2,
        rollAngle: 0.0,
        state: 'resting' // 'resting' | 'rolling_to_tray' | 'in_tray'
      },
      payload_trunk_01: {
        id: 'payload_trunk_01',
        label: 'Steamer Trunk #A-12',
        massKg: 35.0,
        meshId: 'mesh_steamer_trunk',
        holderId: 'drawer_catch_02',
        x: -3.4,
        y: 1.70,
        z: 0.9,
        state: 'resting'
      },
      payload_carpet_02: {
        id: 'payload_carpet_02',
        label: 'Rolled Persian Carpet #B-07',
        massKg: 25.0,
        meshId: 'mesh_rolled_carpet',
        holderId: 'drawer_s2_ledge',
        x: 3.35,
        y: 4.70,
        z: 1.35,
        state: 'resting'
      },
      payload_ceramic_03: {
        id: 'payload_ceramic_03',
        label: 'Crated Ceramic Parcel #C-03',
        massKg: 20.0,
        meshId: 'mesh_ceramic_parcel',
        holderId: 'drawer_s2_ledge',
        x: 3.85,
        y: 4.70,
        z: 1.35,
        state: 'resting'
      },
      payload_umbrella_04: {
        id: 'payload_umbrella_04',
        label: 'Cast-Base Umbrella Case #D-04',
        massKg: 15.0,
        meshId: 'mesh_umbrella_case',
        holderId: 'drawer_s3_a',
        x: -2.2,
        y: 9.10,
        z: 0.8,
        state: 'resting'
      },
      payload_instruments_05: {
        id: 'payload_instruments_05',
        label: 'Boxed Surveying Instruments #E-19',
        massKg: 45.0,
        meshId: 'mesh_boxed_instruments',
        holderId: 'drawer_s2_ledge',
        x: 3.60,
        y: 4.70,
        z: 1.05,
        state: 'resting'
      }
    };

    // Chutes
    this.chutes = {
      chute_upper_west: {
        id: 'chute_upper_west',
        label: 'West Dispatch Chute',
        entryX: -1.1,
        entryY: 8.15,
        entryZ: 1.45,
        exitX: -4.2,
        exitY: 8.6,
        exitZ: 1.35,
        targetHolderId: 'cage_s3_west',
        transitDuration: 1.4
      },
      chute_upper_east: {
        id: 'chute_upper_east',
        label: 'East Dispatch Chute',
        entryX: -1.6,
        entryY: 9.10,
        entryZ: 1.55,
        exitX: 3.8,
        exitY: 10.4,
        exitZ: 1.35,
        targetHolderId: 'cage_s3_east',
        transitDuration: 1.4
      }
    };

    // Player character state (with moving-platform velocity inheritance)
    this.player = {
      x: -5.2,
      y: 1.51,
      z: 1.15,
      vx: 0.0,
      vy: 0.0,
      vz: 0.0,
      relVx: 0.0,
      relVz: 0.0,
      platformVx: 0.0,
      platformVy: 0.0,
      platformVz: 0.0,
      grounded: true,
      supportId: 'drawer_burst_01',
      carriedPayloadId: null,
      facing: 1,
      overloadTimer: 0.0
    };

    this.input = {
      moveX: 0.0,
      moveZ: 0.0,
      railPull: 0.0
    };

    applyRuntimeLayout(this);
    this.checkpoints = {};
    this.activeCheckpointId = 'CP-1 (#101)';
    this.saveCheckpoint('CP-1 (#101)');
  }

  showBanner(text, kind = 'info', duration = 3.2) {
    this.banner = { text, kind, timer: duration };
  }

  getSupportTop(drawer,x,z) { return supportTop(typeof drawer==='string'?this.drawers[drawer]:drawer,x,z); }

  getPayloadRestPose(payload,drawer) { return payloadRestPose(this,payload,drawer); }

  getDrawerPayloadMass(drawerId) {
    let sum = 0.0;
    for (const p of Object.values(this.payloads)) {
      if (p.holderId === drawerId && p.state === 'resting') {
        sum += p.massKg;
      }
    }
    return sum;
  }

  getDrawerEffectiveMass(drawerId) {
    const d = this.drawers[drawerId];
    if (!d) return 0.0;
    let total = d.baseMassKg + this.getDrawerPayloadMass(drawerId);
    if (this.player.grounded && this.player.supportId === drawerId) {
      total += this.contract.simulation.player_mass_kg;
      if (this.player.carriedPayloadId) {
        total += this.payloads[this.player.carriedPayloadId].massKg;
      }
    }
    return total;
  }

  getFocusedDrawer() {
    const selected=this.drawers[this.interactionTargetId];
    if(selected && this._interactionDistanceToDrawer(selected)<=2.45) return selected;
    let best = null;
    let bestDist = Infinity;
    for (const d of Object.values(this.drawers)) {
      const dx = d.x - this.player.x;
      const dy = supportTop(d) - this.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best || this.drawers.drawer_burst_01;
  }

  /**
   * Attempt to lock or release a drawer at its nearest physical rail notch.
   * Rejects latching visibly and audibly if |zExt - notch| > NOTCH_TOLERANCE_M (0.10m).
   */
  toggleDrawerLatch(drawerId = null) {
    const d = drawerId ? this.drawers[drawerId] : this.getFocusedDrawer();
    if (!d || !d.notches || d.notches.length === 0) return { ok: false, reason: 'no_notches' };

    if(d.id==='drawer_s1_c'&&!d.latched&&!this.drawers.drawer_s1_a.panReleaseEngaged){
      this.showBanner('LATCH BLOCKED: keep the rear weighing pan pressed while inserting the #112 pawl.','reject',3);
      return {ok:false,reason:'pan_pressure_required_for_latch'};
    }
    const railValue=d.verticalNotches ? d.y : d.zExt;
    const railNotches=d.verticalNotches || d.notches;
    if (d.latched) {
      d.latched = false;
      d.latchedNotchIndex = -1;
      if (this.audio) this.audio.trigger(this.time, 'notch_release', { drawer: d.number });
      this.showBanner(`UNLATCHED ${d.number}: Rail unlocked (${railValue.toFixed(2)}m)`, 'info', 2.2);
      return { ok: true, latched: false, drawer: d.id };
    }

    let bestIdx = -1;
    let bestDiff = Infinity;
    railNotches.forEach((nVal, idx) => {
      const diff = Math.abs(railValue - nVal);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = idx;
      }
    });

    const nearestNotch = railNotches[bestIdx];
    if (bestDiff > NOTCH_TOLERANCE_M) {
      d.rejectFlashTimer = 1.2;
      this.stats.notchRejections += 1;
      if (this.audio) this.audio.trigger(this.time, 'latch_reject', { drawer: d.number, zExt: railValue });
      const msg = `LATCH REJECTED on ${d.number}: Rail at ${railValue.toFixed(2)}m misses notch ${nearestNotch.toFixed(2)}m (±${NOTCH_TOLERANCE_M.toFixed(2)}m)`;
      this.showBanner(msg, 'reject', 3.4);
      return { ok: false, reason: 'missed_notch', diff: bestDiff, nearestNotch, message: msg };
    }

    if(d.verticalNotches) d.y=nearestNotch; else d.zExt=nearestNotch;
    d.vz = 0.0;
    d.vy = 0.0;
    d.latched = true;
    d.latchedNotchIndex = bestIdx;
    if (this.audio) this.audio.trigger(this.time, 'notch_lock', { drawer: d.number, notch: nearestNotch });
    this.showBanner(`LOCKED ${d.number} AT NOTCH ${['I', 'II', 'III', 'IV'][bestIdx] || (bestIdx + 1)} (${nearestNotch.toFixed(2)}m)`, 'success', 2.4);
    return { ok: true, latched: true, notch: nearestNotch, drawer: d.id };
  }

  toggleCargoHatch(drawerId = 'drawer_s2_counter') {
    const d = this.drawers[drawerId];
    if (!d || !d.hasCargoHatch) return { ok: false, reason: 'no_hatch' };
    d.cargoHatchOpen = !d.cargoHatchOpen;
    if (this.audio) this.audio.trigger(this.time, 'hatch_toggle', { open: d.cargoHatchOpen });
    this.showBanner(
      `${d.number} CARGO HATCH ${d.cargoHatchOpen ? 'OPENED — Ready for load transfer' : 'CLOSED & SECURED'}`,
      d.cargoHatchOpen ? 'success' : 'info',
      2.5
    );
    return { ok: true, open: d.cargoHatchOpen };
  }

  /**
   * Pick up, transfer to a target drawer/cage, or dispatch down a transfer chute.
   * Enforces cargo hatch state and reach distance; rejects impossible connections visibly.
   */
  _interactionDistanceToDrawer(d) {
    const p = this.player;
    return Math.hypot(
      Math.max(0, Math.abs(p.x - d.x) - d.width / 2),
      p.y - supportTop(d),
      Math.max(0, Math.abs(p.z - d.zExt) - d.depth / 2)
    );
  }

  transferPayload(payloadId, targetId) {
    const p = this.payloads[payloadId];
    if (!p) return { ok: false, reason: 'missing_payload' };
    // Payload ownership and reach are invariants, including non-UI callers.
    if (this.player.carriedPayloadId !== payloadId || p.state !== 'carried' || p.holderId !== null) {
      return { ok: false, reason: 'payload_not_carried' };
    }
    const destination = this.chutes[targetId] || this.drawers[targetId];
    if (!destination) return { ok: false, reason: 'invalid_target' };
    const reach = this.chutes[targetId]
      ? Math.hypot(this.player.x-destination.entryX, this.player.y-destination.entryY, this.player.z-destination.entryZ)
      : this._interactionDistanceToDrawer(destination);
    if (reach > 2.45) {
      this.stats.impossibleTransfers += 1;
      this.showBanner('TRANSFER REJECTED: Destination is out of reach.', 'reject', 3);
      return { ok: false, reason: 'target_out_of_reach', distance: reach };
    }

    // Check if target is a chute
    if (this.chutes[targetId]) {
      const chute = this.chutes[targetId];
      p.holderId = null;
      p.rollAngle=0; // Constrained cargo slide; no arbitrary tumbling of crates/cases.
      Object.assign(p,payloadChutePose(p,chute,0));
      p.state = 'chute_transit';
      p.chuteId = chute.id;
      p.transitElapsed = 0.0;
      p.transitDuration = 0; p.chuteDistance=0; p.chuteSpeed=0; p.fallVy=0;
      if (this.player.carriedPayloadId === payloadId) {
        this.player.carriedPayloadId = null;
      }
      this.stats.chutesDispatched += 1;
      if (this.audio) this.audio.trigger(this.time, 'chute_dispatch', { payload: p.id, chute: chute.id });
      this.showBanner(`DISPATCHED ${p.label} (${p.massKg} kg) DOWN ${chute.label.toUpperCase()}`, 'success', 2.8);
      return { ok: true, mode: 'chute', chute: chute.id };
    }

    const targetDrawer = this.drawers[targetId];
    if (!targetDrawer) {
      this.stats.impossibleTransfers += 1;
      this.showBanner(`TRANSFER REJECTED: Unknown destination ${targetId}`, 'reject', 3.0);
      return { ok: false, reason: 'invalid_target' };
    }

    // Reject transfer into closed cargo hatch cage
    if (targetDrawer.hasCargoHatch && !targetDrawer.cargoHatchOpen) {
      targetDrawer.rejectFlashTimer = 1.2;
      this.stats.impossibleTransfers += 1;
      if (this.audio) this.audio.trigger(this.time, 'latch_reject', { drawer: targetDrawer.number });
      const msg = `TRANSFER REJECTED: ${targetDrawer.number} Cargo Hatch is CLOSED! Press [H] to open hatch first.`;
      this.showBanner(msg, 'reject', 3.5);
      return { ok: false, reason: 'hatch_closed', message: msg };
    }

    // Reject transfer if target drawer is retracted inside the wall (< 0.40m)
    if (targetDrawer.zExt < 0.40) {
      targetDrawer.rejectFlashTimer = 1.2;
      this.stats.impossibleTransfers += 1;
      if (this.audio) this.audio.trigger(this.time, 'latch_reject', { drawer: targetDrawer.number });
      const msg = `TRANSFER REJECTED: ${targetDrawer.number} is retracted (${targetDrawer.zExt.toFixed(2)}m) — pull rail outward first!`;
      this.showBanner(msg, 'reject', 3.5);
      return { ok: false, reason: 'drawer_retracted', message: msg };
    }

    p.holderId = targetDrawer.id;
    p.state = 'resting';
    if (this.player.carriedPayloadId === payloadId) {
      this.player.carriedPayloadId = null;
    }
    if (this.audio) this.audio.trigger(this.time, 'payload_transfer', { payload: p.id, mass: p.massKg, target: targetDrawer.number });
    this.showBanner(
      `TRANSFERRED ${p.label} (${p.massKg} kg) → ${targetDrawer.number} (Total Payload: ${this.getDrawerPayloadMass(targetDrawer.id)} kg)`,
      'success',
      2.8
    );
    return { ok: true, holderId: targetDrawer.id, massKg: p.massKg };
  }

  triggerCargoJam(drawerId, jammed = true) {
    const d = this.drawers[drawerId];
    if (!d) return;
    d.jammed = jammed;
    d.jamPayloadIds=jammed ? Object.values(this.payloads).filter(p=>p.holderId===drawerId&&p.state==='resting').map(p=>p.id) : [];
    if (jammed) {
      d.vz = 0;
      d.vy = 0;
      if (this.audio) this.audio.trigger(this.time, 'latch_reject', { drawer: d.number });
      this.showBanner(`CARGO JAM ON ${d.number}: Obstructed rail! Clear payload [F] to restore movement.`, 'reject', 3.4);
    } else {
      this.stats.cargoJamsCleared += 1;
      this.showBanner(`CARGO JAM CLEARED ON ${d.number}: Rail movement restored.`, 'success', 2.4);
    }
  }

  openGardenShutter() {
    const g = this.drawers.drawer_s3_garden;
    const inside = this.player.grounded && this.player.supportId === g.id &&
      Math.abs(this.player.x-g.x) <= g.width/2 && Math.abs(this.player.z-g.zExt) <= g.depth/2;
    if (!inside) return { ok: false, reason: 'not_inside_garden_drawer' };
    if (this.stage !== 3 || !this.checkpoints['CP-3 (#201 Upper Gallery)'] ||
        this.getDrawerPayloadMass('cage_s3_west') < 30 || this.getDrawerPayloadMass('cage_s3_east') < 30) {
      return { ok: false, reason: 'progression_incomplete' };
    }
    if (g.zExt < 1.50) {
      this.showBanner('CANNOT OPEN GARDEN SHUTTER: Extend Drawer #309 outward first!', 'reject', 3.0);
      return { ok: false, reason: 'not_extended' };
    }
    g.shutterTarget = 1.0;
    this.completed = true;
    if (this.audio) this.audio.trigger(this.time, 'garden_open', {});
    this.showBanner('DRAWER #309 OPENED FROM INSIDE — DAYLIGHT REVEALS THE ROOFTOP GARDEN!', 'success', 6.0);
    return { ok: true };
  }

  saveCheckpoint(label) {
    this.activeCheckpointId = label;
    this.checkpoints[label] = JSON.stringify({
      stage: this.stage,
      completed: this.completed,
      gardenLightFactor: this.gardenLightFactor,
      drawers: this.drawers,
      payloads: this.payloads,
      player: {
        ...this.player,
        vx: 0,
        vy: 0,
        vz: 0,
        relVx: 0,
        relVz: 0
      }
    });
  }

  restoreCheckpoint(label = null, reason = '') {
    const key = label || this.activeCheckpointId;
    const snap = this.checkpoints[key];
    if (!snap) return false;
    const parsed = JSON.parse(snap);
    this.stage = parsed.stage;
    this.drawers = parsed.drawers;
    this.payloads = parsed.payloads;
    this.player = parsed.player;
    this.activeCheckpointId = key;
    this.completed = Boolean(parsed.completed);
    this.gardenLightFactor = parsed.gardenLightFactor || 0;
    this.input = { moveX: 0, moveZ: 0, railPull: 0 };
    this.player.platformVx = this.player.platformVy = this.player.platformVz = 0;
    for (const d of Object.values(this.drawers)) { d.vz = 0; d.vy = 0; }
    if (this.audio && typeof this.audio.resetSchedule === 'function') this.audio.resetSchedule(false);
    // Keep the simulation clock monotonic for live audio and capture timelines.
    this.stats.checkpointsRestored += 1;
    const msg = reason
      ? `CHECKPOINT RESTORED (${key}): ${reason}`
      : `RESTORED CHECKPOINT ${key} — All moving trays and payloads reset cleanly.`;
    this.showBanner(msg, reason ? 'reject' : 'info', 3.6);
    return true;
  }

  /**
   * Advance simulation using fixed timestep accumulator for render-rate independence.
   */
  update(frameDeltaSeconds) {
    const clamped = Math.min(Math.max(frameDeltaSeconds, 0.0), 0.25);
    this.accumulator += clamped;
    let steps = 0;
    while (this.accumulator >= FIXED_DT - 1e-9) {
      this.stepFixed(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    return steps;
  }

  stepFixed(dt = FIXED_DT) {
    const previousTransforms = new Map(Object.values(this.drawers).map(d => [d.id, {y:d.y, z:d.zExt}]));
    for (const d of Object.values(this.drawers)) d.vz = 0;
    this.time += dt;

    if (this.banner.timer > 0) {
      this.banner.timer = Math.max(0, this.banner.timer - dt);
    }

    for (const d of Object.values(this.drawers)) {
      if (d.rejectFlashTimer > 0) d.rejectFlashTimer = Math.max(0, d.rejectFlashTimer - dt);
    }

    // 1. Opening Burst Drawer (#101 -> Rolling Parcel -> Receiving Tray #T1 -> Hauls Catch Drawer #102)
    const dBurst = this.drawers.drawer_burst_01;
    const rParcel = this.payloads.rolling_parcel_01;
    const rTray = this.drawers.receiving_tray_01;
    const dCatch = this.drawers.drawer_catch_02;

    if (this.time >= 0.45 && !dBurst.burstTriggered) {
      dBurst.burstTriggered = true;
      dBurst.burstDriveVz = 2.6;
      rParcel.state = 'rolling_to_tray';
      rParcel.holderId = null;
      if (this.audio) this.audio.trigger(this.time, 'burst_open', { drawer: '#101' });
      this.showBanner('DRAWER #101 BURSTS OPEN! Rolling parcel tips Tray #T1 to haul Drawer #102 outward!', 'info', 3.6);
    }

    if (dBurst.burstTriggered && !dBurst.latched && !dBurst.jammed) {
      dBurst.zExt = Math.min(1.85, dBurst.zExt + (dBurst.burstDriveVz || 0) * dt);
      dBurst.burstDriveVz = (dBurst.burstDriveVz || 0) * 0.96;
    }

    if (rParcel.state === 'rolling_to_tray') {
      const targetX = rTray.x;
      const targetY = rTray.y + 0.22;
      const targetZ = rTray.zExt;
      const dx = targetX - rParcel.x;
      const speed = 1.65;
      const stepX = Math.min(Math.abs(dx), speed * dt) * Math.sign(dx || 1);
      rParcel.x += stepX;
      rParcel.y += (targetY - rParcel.y) * Math.min(1.0, dt * 5.0);
      rParcel.z += (targetZ - rParcel.z) * Math.min(1.0, dt * 5.0);
      rParcel.rollAngle += (stepX / 0.21);

      if (Math.abs(targetX - rParcel.x) < 0.06) {
        rParcel.state = 'resting';
        rParcel.holderId = 'receiving_tray_01';
        rTray.tipped = true;
        if (this.audio) this.audio.trigger(this.time, 'tray_tip', { tray: 'TRAY-T1' });
      }
    }

    // Coupled Receiving Tray -> Catch Drawer #102
    if (rTray.tipped) {
      const trayMass = this.getDrawerPayloadMass('receiving_tray_01'); // 18 kg
      const targetY = trayMass >= 15.0 ? rTray.minY : rTray.maxY;
      const prevY = rTray.y;
      rTray.y += (targetY - rTray.y) * Math.min(1.0, dt * 4.2);
      rTray.vy = (rTray.y - prevY) / dt;
      rTray.tiltRad = -0.30 * ((rTray.maxY - rTray.y) / (rTray.maxY - rTray.minY));

      if (!dCatch.latched && !dCatch.jammed) {
        const dropFraction = (rTray.maxY - rTray.y) / (rTray.maxY - rTray.minY);
        const targetZ = 0.15 + dropFraction * (1.85 - 0.15);
        const prevZ = dCatch.zExt;
        dCatch.zExt = targetZ;
        dCatch.vz = (dCatch.zExt - prevZ) / dt;
      }
    }

    stepMechanisms(this, dt);
    const d309 = this.drawers.drawer_s3_garden;

    // Garden shutter & daylight interpolation
    if (d309.shutterTarget > d309.shutterOpen) {
      d309.shutterOpen = Math.min(1.0, d309.shutterOpen + dt * 0.85);
      this.gardenLightFactor = d309.shutterOpen;
    }

    // 6. Update Payloads (resting on holders, carried by player, or sliding in transfer chutes)
    let holderSlotIndex = {};
    for (const p of Object.values(this.payloads)) {
      if (this.player.carriedPayloadId === p.id) {
        p.x = this.player.x + this.player.facing * 0.35;
        p.y = this.player.y + 0.55;
        p.z = this.player.z + 0.25;
        continue;
      }
      if (p.state === 'chute_transit' || p.state === 'chute_fall') { stepGravityChute(this,p,dt); continue; }
      if (p.state === 'resting' && p.holderId && this.drawers[p.holderId]) {
        const h = this.drawers[p.holderId];
        const idx = holderSlotIndex[h.id] || 0;
        holderSlotIndex[h.id] = idx + 1;
        const offsetX = (idx - 0.5) * 0.42;
        Object.assign(p,payloadRestPose(this,p,h));
      }
    }

    // Derive support velocity before the rider consumes it, including stopped rails.
    for (const d of Object.values(this.drawers)) {
      const previous = previousTransforms.get(d.id);
      d.vz = (d.zExt - previous.z) / dt;
      d.vy = (d.y - previous.y) / dt;
    }
    // 7. Update Player Controller & Moving-Platform Velocity Transfer
    this._stepPlayer(dt, previousTransforms);
  }

  _stepPlayer(dt, previousTransforms = null) {
    const p = this.player;
    const previousFootY = p.y;
    const previousX = p.x;
    const previousZ = p.z;
    const support = p.grounded && p.supportId ? this.drawers[p.supportId] : null;

    if (support) {
      // Inherit exact platform velocity (moving-platform consistency)
      p.platformVx = 0.0;
      p.platformVy = support.vy || 0.0;
      p.platformVz = support.vz || 0.0;

      // Apply platform displacement for this fixed step
      p.y = supportTop(support,p.x,p.z);
      p.z += p.platformVz * dt;

      // Relative walking velocity on platform
      p.relVx = this.input.moveX * this.contract.simulation.player_walk_speed_mps;
      p.relVz = this.input.moveZ * 3.2;
      if (Math.abs(this.input.moveX) > 0.05) {
        p.facing = Math.sign(this.input.moveX);
      }

      p.vx = p.platformVx + p.relVx;
      p.vy = p.platformVy;
      p.vz = p.platformVz + p.relVz;

      const fromX=p.x,fromZ=p.z,fromTop=p.y;
      p.x += p.relVx * dt;p.z += p.relVz * dt;
      // Interior walls and the rear pan lip cannot be walked through from the recessed floor.
      const stepped=surfaceAt(support,p.x,p.z);
      if(stepped&&support.y+stepped.y>fromTop+.18){p.x=fromX;p.z=fromZ;p.relVx=0;p.relVz=0;}
      p.y=supportTop(support,p.x,p.z);

      // Check if player walked off the horizontal bounds of the support drawer
      const halfW = support.width * 0.5 + 0.28;
      if (!surfaceAt(support,p.x,p.z) || support.zExt < 0.25) {
        p.grounded = false;
        p.supportId = null;
      } else {
        this._onLandDrawer(support);
      }
    } else {
      // Airborne trajectory (preserves platform velocity inherited at jump/takeoff)
      const airControlAx = this.input.moveX * 8.5;
      p.vx = Math.max(-5.8, Math.min(5.8, p.vx + airControlAx * dt));
      p.vy -= this.contract.simulation.gravity_mps2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z = Math.max(0.35, Math.min(2.6, p.z + p.vz * dt));

      // Sweep against the actual visible floor, rim and rear weighing-pan surfaces.
      let landed=false;
      for(const d of Object.values(this.drawers)){
        if(d.climbable===false||d.zExt<.38)continue;
        const previous=previousTransforms?.get(d.id);
        for(const surface of supportSurfaces(d)){
          const topY=d.y+surface.y,oldTop=(previous?.y??d.y)+surface.y;
          const before=previousFootY-oldTop,after=p.y-topY;
          if(before < -1e-6 || after>0 || p.vy-(d.vy||0)>0)continue;
          const u=before-after>1e-9?Math.max(0,Math.min(1,before/(before-after))):0;
          const cx=previousX+(p.x-previousX)*u,cz=previousZ+(p.z-previousZ)*u;
          const dz=(previous?.z??d.zExt)+(d.zExt-(previous?.z??d.zExt))*u;
          const local=localPlayerPoint({...d,zExt:dz},cx,cz);
          if(local.x<surface.minX||local.x>surface.maxX||local.z<surface.minZ||local.z>surface.maxZ)continue;
          p.y=topY;p.vy=d.vy||0;p.grounded=true;p.supportId=d.id;
          this.audio?.trigger(this.time,'land',{drawer:d.number});this._onLandDrawer(d);landed=true;break;
        }
        if(landed)break;
      }

      // Recoverable fall check if player misses a support drawer
      if (p.y < -1.5) {
        this.restoreCheckpoint(
          null,
          'Missed foothold support — restored to last safe stage checkpoint!'
        );
      }
    }
  }

  _onLandDrawer(d) {
    if (d.id === 'drawer_catch_02' && this.activeCheckpointId === 'CP-1 (#101)') {
      this.saveCheckpoint('CP-1B (#102 Catch)');
    } else if (d.id === 'drawer_s2_ledge' && this.stage < 2) {
      this.stage = 2;
      this.saveCheckpoint('CP-2 (#202 Stage 2 Ledge)');
      this.showBanner('STAGE 2 REACHED: Open #204 Cargo Hatch [H] and transfer loads to raise Lift #201!', 'success', 4.0);
    } else if (d.id === 'drawer_s2_lift' && d.y >= this.world.runtime.stage3EntryY && this.stage < 3) {
      this.stage = 3;
      this.saveCheckpoint('CP-3 (#201 Upper Gallery)');
      this.showBanner('STAGE 3 REACHED: Dispatch loads through West & East Chutes to extend #302, #305 & #309!', 'success', 4.0);
    }
  }

  jump() {
    const p = this.player;
    if (!p.grounded) return false;
    const support = p.supportId ? this.drawers[p.supportId] : null;
    const platVx = support ? 0.0 : 0.0;
    const platVy = support ? (support.vy || 0.0) : 0.0;
    const platVz = support ? (support.vz || 0.0) : 0.0;

    // Velocity transfer: jump takeoff velocity includes platform velocity!
    p.vx = platVx + this.input.moveX * this.contract.simulation.player_walk_speed_mps;
    p.vy = platVy + this.contract.simulation.player_jump_speed_mps;
    p.vz = platVz;
    p.grounded = false;
    p.supportId = null;
    if (this.audio) this.audio.trigger(this.time, 'jump', {});
    return true;
  }

  jumpToDrawer() { return {ok:false,reason:'use_ordinary_jump_and_movement'}; }

}

/** Deprecated privileged tour. Use the saved ordinary input trace and qualify.mjs. */
export class AutopilotTourController {
  constructor() {}
  reset() {}
  updateAtTime() { return {ok:false,reason:'deprecated_privileged_tour'}; }
}
/** No fabricated pass: full qualification requires the saved input trace and source-bound verifier. */
export function runAutomatedPhysicsChecks() {
  return {all_passed:false,status:'qualification_required',command:'node qualify.mjs',reason:'Run the independent source-bound ordinary replay verifier.'};
}
