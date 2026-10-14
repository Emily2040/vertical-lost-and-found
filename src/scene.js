import { installMaterialFinish } from './material-finish.js';
import {updatePresentationCamera} from './presentation-camera.js';
import {buildRooftopGarden,syncRooftopGarden} from './rooftop-garden.js';
/**
 * Three.js Architectural Scene, Blender GLB Loader, Fixed-vs-Moving Latch Rigging,
 * Dynamic Tensioned Steel Cables, Object-Specific Deterministic Plaques, and
 * Rooftop Conservatory Garden Reveal for The Vertical Lost & Found (`src/scene.js`).
 */

import * as THREE from 'three';
import { installHall } from './hall.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Runtime material surfaces share the exported metric UV convention; labels use their own planes.
function metricBox(...dimensions) {
  const geo = new THREE.BoxGeometry(...dimensions), p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i=0; i<p.count; i++) {
    const ax=Math.abs(n.getX(i)), ay=Math.abs(n.getY(i)), az=Math.abs(n.getZ(i));
    if (ax>=ay && ax>=az) uv.setXY(i,-p.getZ(i),p.getY(i));
    else if (ay>=ax && ay>=az) uv.setXY(i,p.getX(i),-p.getZ(i));
    else uv.setXY(i,p.getX(i),p.getY(i));
  }
  return geo;
}

export class ArchiveSceneView {
  constructor(canvas, contract, world, provenance) {
    this.canvas = canvas;
    this.contract = contract;
    this.world = world;
    this.provenance = provenance;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x182431);
    this.scene.fog = new THREE.FogExp2(0x243342, 0.010);

    this.camera = new THREE.PerspectiveCamera(
      48,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.1,
      120
    );
    this.camera.position.set(0.0, 6.8, 15.5);
    this.cameraTarget = new THREE.Vector3(0.0, 5.8, 1.2);
    this.camera.lookAt(this.cameraTarget);

    this.cameraMode = 'follow'; // 'follow' | 'hero' | 'closeup' | 'clay_wireframe' | 'material_isolation' | 'coupled_proof' | 'garden_payoff'
    this.drawerViews = {};
    this.payloadViews = {};
    this.chuteViews = {};
    this.cableViews = [];
    this.pulleyWheels = [];
    this.sunShafts = [];
    this.materials = {};
    this.loadedTemplates = {};
  }

  async init(sim) {
    await this._loadPBRMaterials();
    await this._loadBlenderKit();
    this._setupLighting();
    await installHall(this);
    buildRooftopGarden(this);
    this._buildMechanismEntities(sim);
    this._buildCoupledCableRigs(sim);
    this._buildPlayerCharacter();
    this.syncFromSimulation(sim, 0);
    this.materialFinish = installMaterialFinish(this);
    this.materialFinish.set({metal: true, ao: true});
  }

  async _loadPBRMaterials() {
    const texLoader = new THREE.TextureLoader();
    const loadTex = (url, isSrgb = false, repeatX = 1, repeatY = 1, offsetX = 0, offsetY = 0) =>
      new Promise((resolve, reject) => {
        texLoader.load(
          url,
          (t) => {
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(repeatX, repeatY);
            t.offset.set(offsetX, offsetY);
            t.colorSpace = isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
            t.flipY = false; // GLB UV convention; deterministic exported labels retain their own maps.
            t.needsUpdate = true;
            resolve(t);
          },
          undefined,
          reject
        );
      });

    // 1. Handled Archival Lacquer (Nano Banana source; prepared 2048px maps and independently authored PBR channels)
    const [lacBc, lacR, lacM, lacN] = await Promise.all([
      loadTex('/assets/textures/pbr/handled_lacquer_basecolor.png', true, 2, 2),
      loadTex('/assets/textures/pbr/handled_lacquer_roughness.png', false, 2, 2),
      loadTex('/assets/textures/pbr/handled_lacquer_metalness.png', false, 2, 2),
      loadTex('/assets/textures/pbr/handled_lacquer_normal.png', false, 2, 2)
    ]);
    this.materials.lacquer = new THREE.MeshPhysicalMaterial({
      name: 'mat_handled_lacquer',
      map: lacBc,
      color: new THREE.Color(0xffffff),
      roughnessMap: lacR,
      metalnessMap: lacM,
      normalMap: lacN,
      normalScale: new THREE.Vector2(1, 1),
      clearcoat: 0.0,
      clearcoatRoughness: 0.34
    });

    // 2. Labelled Luggage Canvas (Nano Banana source; prepared 2048px maps and independently authored PBR channels — mapped to clean text-free woven region on base bodies)
    const [canBc, canR, canM, canN] = await Promise.all([
      loadTex('/assets/textures/pbr/luggage_canvas_basecolor.png', true, 10, 10),
      loadTex('/assets/textures/pbr/luggage_canvas_roughness.png', false, 10, 10),
      loadTex('/assets/textures/pbr/luggage_canvas_metalness.png', false, 10, 10),
      loadTex('/assets/textures/pbr/luggage_canvas_normal.png', false, 10, 10)
    ]);
    this.materials.canvas = new THREE.MeshStandardMaterial({
      name: 'mat_luggage_canvas',
      map: canBc,
      color: new THREE.Color(0xffffff),
      roughnessMap: canR,
      metalnessMap: canM,
      normalMap: canN,
      normalScale: new THREE.Vector2(1.0, 1.0)
    });

    // 3. Worn Interior Baize Lining (Nano Banana source; prepared 2048px maps and independently authored PBR channels — deep burgundy-crimson wool baize)
    const [linBc, linR, linM, linN] = await Promise.all([
      loadTex('/assets/textures/pbr/worn_lining_basecolor.png', true, 4, 4),
      loadTex('/assets/textures/pbr/worn_lining_roughness.png', false, 4, 4),
      loadTex('/assets/textures/pbr/worn_lining_metalness.png', false, 4, 4),
      loadTex('/assets/textures/pbr/worn_lining_normal.png', false, 4, 4)
    ]);
    this.materials.lining = new THREE.MeshPhysicalMaterial({
      name: 'mat_worn_lining',
      map: linBc,
      color: new THREE.Color(0xffffff),
      roughnessMap: linR,
      metalnessMap: linM,
      normalMap: linN,
      normalScale: new THREE.Vector2(1, 1),
      sheen: 0.0,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color(0xc9656d)
    });

    // 4. Complementary Architectural & Hardware Materials
    this.materials.brass = new THREE.MeshStandardMaterial({
      name: 'mat_brass_hardware',
      color: new THREE.Color(0xb9a276),
      metalness: 0.86,
      roughness: 0.27
    });
    this.materials.brassFixed = new THREE.MeshStandardMaterial({
      name: 'mat_brass_fixed_guide',
      color: new THREE.Color(0x867656),
      metalness: 0.84,
      roughness: 0.36
    });
    this.materials.latchLocked = new THREE.MeshStandardMaterial({
      name: 'mat_latch_locked',
      color: new THREE.Color(0x6ad67c),
      emissive: new THREE.Color(0x1d5e28),
      metalness: 0.65,
      roughness: 0.3
    });
    this.materials.latchRejected = new THREE.MeshStandardMaterial({
      name: 'mat_latch_rejected',
      color: new THREE.Color(0xff5942),
      emissive: new THREE.Color(0x88180c),
      metalness: 0.5,
      roughness: 0.35
    });
    this.materials.iron = new THREE.MeshStandardMaterial({
      name: 'mat_iron_structure',
      color: new THREE.Color(0x384551),
      metalness: 0.78,
      roughness: 0.44
    });
    this.materials.steelCable = new THREE.MeshStandardMaterial({
      name: 'mat_steel_cable',
      color: new THREE.Color(0xa8b4c4),
      metalness: 0.85,
      roughness: 0.32
    });
    this.materials.clay = new THREE.MeshStandardMaterial({
      name: 'mat_clay_inspection',
      color: new THREE.Color(0xc4beb4),
      metalness: 0.05,
      roughness: 0.48,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
  }

  async _loadBlenderKit() {
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.load('/assets/models/vertical_lost_and_found_kit.glb', resolve, undefined, reject);
    });

    const root = gltf.scene;
    root.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        // Preserve Blender's approved material, UV transform and image orientation.
        // Runtime materials below are for runtime architecture/hardware only.
        const mats=Array.isArray(child.material)?child.material:[child.material];
        for(const material of mats)if(material)for(const key of ['map','normalMap','roughnessMap','metalnessMap']) {
          const texture=material[key];if(texture)texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
        }
      }
    });

    const templateNames = [
      'mesh_hero_drawer',
      'mesh_load_cage',
      'mesh_transfer_chute',
      'mesh_steamer_trunk',
      'mesh_rolled_carpet',
      'mesh_ceramic_parcel',
      'mesh_rolling_parcel',
      'mesh_umbrella_case',
      'mesh_boxed_instruments'
    ];
    for (const name of templateNames) {
      const found = root.getObjectByName(name);
      if (found) {
        found.position.set(0, 0, 0);
        this.loadedTemplates[name] = found;
      }
    }
  }

  _makeDeterministicPlaqueTexture(title, subtitle, accentColor = '#8a261c', darkBg = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = darkBg ? '#1c1814' : '#e6d6b5';
    ctx.fillRect(0, 0, 512, 256);

    ctx.strokeStyle = darkBg ? '#d4a656' : '#3a2b1e';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, 496, 240);

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 4;
    ctx.strokeRect(22, 22, 468, 212);

    ctx.fillStyle = darkBg ? '#f7ead0' : '#261b12';
    ctx.font = 'bold 54px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 256, 98);

    ctx.fillStyle = darkBg ? '#e2b86b' : accentColor;
    ctx.font = 'bold 34px Consolas, monospace';
    ctx.fillText(subtitle, 256, 174);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  _setupLighting() {
    // A small procedural reflection room provides window-shaped specular response.
    // It is reflection illumination only; the visible hall remains actual geometry.
    const reflectionRoom = new THREE.Scene();
    reflectionRoom.background = new THREE.Color(0x7a899a);
    const room = new THREE.Mesh(metricBox(34, 26, 32),
      new THREE.MeshBasicMaterial({ color: 0x303d4a, side: THREE.BackSide }));
    reflectionRoom.add(room);
    const panel = (w,h,x,y,z,color,intensity,rx=0,ry=0) => {
      const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      m.color.multiplyScalar(intensity);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w,h), m);
      p.position.set(x,y,z);p.rotation.set(rx,ry,0);reflectionRoom.add(p);
    };
    panel(9,18,-15,1,0,0xdcecff,2.0,0,Math.PI/2);
    panel(22,9,0,12,0,0xf6ead3,2.2,Math.PI/2);
    panel(5,12,14,0,-8,0xb7c9e0,0.65,0,-Math.PI/2);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.reflectionTarget = pmrem.fromScene(reflectionRoom, 0.12);
    this.scene.environment = this.reflectionTarget.texture;
    this.scene.environmentIntensity = 0.65;
    pmrem.dispose();
    reflectionRoom.traverse(o => { o.geometry?.dispose(); if(o.material)o.material.dispose(); });

    this.scene.add(new THREE.HemisphereLight(0xb7d1ed, 0x44382e, 0.68));
    this.keyLight = new THREE.DirectionalLight(0xffedcf, 3.1);
    this.keyLight.position.set(-8.0, 20.0, 12.0);
    this.keyLight.target.position.set(0, 6, 0);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    Object.assign(this.keyLight.shadow.camera, {left:-15,right:15,top:16,bottom:-14,near:1,far:48});
    this.keyLight.shadow.bias = -0.00025;
    this.keyLight.shadow.normalBias = 0.025;
    this.keyLight.shadow.radius = 2;
    this.scene.add(this.keyLight, this.keyLight.target);
    const skyFill = new THREE.DirectionalLight(0xd4e4f2, 1.05);
    skyFill.position.set(-5,10,9);skyFill.target.position.set(0,7,0);this.scene.add(skyFill,skyFill.target);
    for (const [x,y,z] of [[7.5,6.5,8.5],[-6.5,3.2,6.5]]) {
      const lantern = new THREE.PointLight(0xffc482, 8.0, 22.0, 1.7);
      lantern.position.set(x,y,z);this.scene.add(lantern);
    }
    this.gardenLight = new THREE.SpotLight(0xfff1c4, 1.2, 32, Math.PI*0.34, 0.45, 1.2);
    this.gardenLight.position.set(0,16.2,-3.6);
    this.gardenLight.target.position.set(0,9.5,4.5);
    this.scene.add(this.gardenLight,this.gardenLight.target);
  }

  _buildRailwayHallArchitecture() {
    const hall = new THREE.Group();
    hall.name = 'railway_hall_structure';

    // 1. Stone Railway Concourse Floor at y = 0
    const floorGeo = new THREE.PlaneGeometry(36, 28);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x605d55,
      roughness: 0.88,
      metalness: 0.02
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI * 0.5;
    floor.receiveShadow = true;
    hall.add(floor);

    // Brass railway floor inlay tracks
    for (const zTrack of [3.5, 5.2]) {
      const rail = new THREE.Mesh(metricBox(32, 0.04, 0.08), this.materials.brassFixed);
      rail.position.set(0, 0.02, zTrack);
      hall.add(rail);
    }

    // 2. Monumental Archival Wall Backing (x = -11..+11, y = 0..18, z = -1.25)
    // Leaves a clear architectural gateway cutout at (x = -1.2..+1.2, y = 12.8..14.8) for Drawer #309 & the Rooftop Garden!
    const wallMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x394752),
      roughness: 0.52,
      metalness: 0.12
    });

    const lowerWall = new THREE.Mesh(metricBox(22.0, 12.8, 0.45), wallMat);
    lowerWall.position.set(0, 6.4, -1.25);
    lowerWall.receiveShadow = true;
    hall.add(lowerWall);

    const leftUpperWall = new THREE.Mesh(metricBox(9.6, 5.2, 0.45), wallMat);
    leftUpperWall.position.set(-6.2, 15.4, -1.25);
    hall.add(leftUpperWall);

    const rightUpperWall = new THREE.Mesh(metricBox(9.6, 5.2, 0.45), wallMat);
    rightUpperWall.position.set(6.2, 15.4, -1.25);
    hall.add(rightUpperWall);

    const topLintelWall = new THREE.Mesh(metricBox(2.8, 2.8, 0.45), wallMat);
    topLintelWall.position.set(0, 16.6, -1.25);
    hall.add(topLintelWall);

    // 3. Structural Vertical Brass Stanchions & Cast-Iron Columns across 9 Vertical Bays
    const bayXCoords = [-7.2, -5.2, -3.4, -1.6, 0.2, 2.0, 3.8, 5.6, 7.4];
    for (const bx of bayXCoords) {
      const stanchion = new THREE.Mesh(metricBox(0.11, 17.5, 0.28), this.materials.brassFixed);
      stanchion.position.set(bx - 0.84, 8.75, -0.95);
      stanchion.castShadow = true;
      hall.add(stanchion);

      const stanchionR = new THREE.Mesh(metricBox(0.11, 17.5, 0.28), this.materials.brassFixed);
      stanchionR.position.set(bx + 0.84, 8.75, -0.95);
      stanchionR.castShadow = true;
      hall.add(stanchionR);
    }

    // Heavy Cast-Iron Hall Columns & Vaulted Roof Arches (matching target_hero_reference.jpg)
    for (const cx of [-9.2, -4.6, 0.0, 4.6, 9.2]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 19.0, 16), this.materials.iron);
      col.position.set(cx, 9.5, -1.05);
      hall.add(col);

      // Vaulted roof arch ribcurving out over the railway hall (+Z)
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(cx, 17.5, -1.0),
        new THREE.Vector3(cx, 21.8, 6.0),
        new THREE.Vector3(cx, 16.5, 14.0)
      );
      const archGeo = new THREE.TubeGeometry(curve, 24, 0.16, 8, false);
      const archMesh = new THREE.Mesh(archGeo, this.materials.iron);
      hall.add(archMesh);
    }

    // Recessed archive fronts continue to the cornice. Instancing bounds draw cost.
    const faceTransforms = [];
    for (const bx of bayXCoords) for (let by=0.8; by<17.5; by+=0.85) {
      if (Math.abs(bx)<1.5 && by>12.2 && by<15.5) continue;
      faceTransforms.push([bx,by,-0.98]);
    }
    const bgMat = this.materials.lacquer.clone();
    bgMat.color.multiplyScalar(0.96);
    const instanced = (geo,mat,poses,name) => {
      const mesh = new THREE.InstancedMesh(geo,mat,poses.length);
      const t = new THREE.Object3D();
      poses.forEach((p,i)=>{t.position.set(...p);t.updateMatrix();mesh.setMatrixAt(i,t.matrix);});
      mesh.name=name;mesh.receiveShadow=true;hall.add(mesh);return mesh;
    };
    instanced(metricBox(1.48,0.77,0.20),bgMat,faceTransforms,'archive_recessed_faces');
    instanced(metricBox(0.32,0.04,0.06),this.materials.brassFixed,
      faceTransforms.map(([x,y,z])=>[x,y-0.06,z+0.08]),'archive_recessed_handles');
    const rails = faceTransforms.flatMap(([x,y,z])=>[[x,y-0.355,z+0.13],[x,y+0.355,z+0.13]]);
    instanced(metricBox(1.49,0.028,0.055),bgMat,rails,'archive_face_mouldings');
    const frameSides=faceTransforms.flatMap(([x,y,z])=>[[x-0.70,y,z+0.13],[x+0.70,y,z+0.13]]);
    instanced(metricBox(0.028,0.70,0.055),bgMat,frameSides,'archive_panel_stiles');
    const innerRails=faceTransforms.flatMap(([x,y,z])=>[[x,y-0.27,z+0.118],[x,y+0.27,z+0.118]]);
    instanced(metricBox(1.30,0.015,0.035),this.materials.brassFixed,innerRails,'archive_narrow_inlay');
    const panelInsetMat=bgMat.clone();panelInsetMat.color.multiplyScalar(0.82);
    instanced(metricBox(1.28,0.51,0.012),panelInsetMat,
      faceTransforms.map(([x,y,z])=>[x,y,z+0.112]),'archive_recessed_panel_insets');

    this._addHallEnclosure(hall);
    this.scene.add(hall);
  }

  _addHallEnclosure(hall) {
    // Physical side walls, clerestory and stone joints, behind the existing playable envelope.
    const stone = new THREE.MeshStandardMaterial({color:0x69716e,roughness:0.88});
    const trim = new THREE.MeshStandardMaterial({color:0x3e4d57,metalness:0.55,roughness:0.5});
    const glass = new THREE.MeshStandardMaterial({name:'mat_architectural_glass',color:0xc2ced0,emissive:0xc7d6df,emissiveIntensity:0.65,
      metalness:0.12,roughness:0.38,side:THREE.DoubleSide});
    const addBox=(w,h,d,x,y,z,mat=trim)=>{const m=new THREE.Mesh(metricBox(w,h,d),mat);
      m.position.set(x,y,z);m.receiveShadow=mat!==glass;m.castShadow=false;hall.add(m);return m;};
    for(const side of [-1,1]) {
      addBox(0.45,18.5,16,side*11.3,9.25,6.6,stone);
      for(const z of [-0.7,3.4,7.5,11.6,14.4]) {
        addBox(0.5,18.8,0.55,side*11.0,9.4,z);
        addBox(0.85,0.5,0.85,side*10.95,0.3,z);
        addBox(0.82,0.45,0.8,side*10.95,15.3,z);
      }
      for(const z of [1.4,5.5,9.6,13.0]) {
        addBox(0.035,5.2,2.65,side*11.04,11.9,z,glass);
        for(const dy of [-2.6,0,2.6])addBox(0.12,0.075,2.8,side*10.99,11.9+dy,z);
        addBox(0.14,5.25,0.075,side*10.98,11.9,z);
      }
    }
    for(const y of [0.15,17.6,18.05])addBox(22.5,0.18,0.5,0,y,-0.7);
    // Layered cast-iron bases/capitals and arcade ribs give the enclosure real relief.
    // All of this sits behind the authored playable volume.
    const columnXs=[-9.2,-4.6,0,4.6,9.2];
    const baseProfile=[[0.40,0],[0.40,0.12],[0.34,0.16],[0.34,0.29],
      [0.29,0.34],[0.29,0.55],[0.25,0.64],[0.25,0.76]].map(p=>new THREE.Vector2(...p));
    const capProfile=[[0.24,0],[0.27,0.10],[0.27,0.18],[0.31,0.21],
      [0.36,0.38],[0.40,0.42],[0.40,0.54]].map(p=>new THREE.Vector2(...p));
    const instances=(geo,positions,name)=>{
      const m=new THREE.InstancedMesh(geo,trim,positions.length),d=new THREE.Object3D();
      positions.forEach((p,i)=>{d.position.set(...p);d.updateMatrix();m.setMatrixAt(i,d.matrix);});
      m.name=name;m.castShadow=true;m.receiveShadow=true;hall.add(m);return m;
    };
    instances(new THREE.LatheGeometry(baseProfile,20),columnXs.map(x=>[x,0,-1.05]),'column_layered_bases');
    instances(new THREE.LatheGeometry(capProfile,20),columnXs.flatMap(x=>[[x,9.0,-1.05],[x,16.9,-1.05]]),'column_layered_capitals');
    const collarPos=columnXs.flatMap(x=>[0.9,4.5,8.9,12.5,16.8].map(y=>[x,y,-1.05]));
    instances(new THREE.CylinderGeometry(0.285,0.285,0.065,20),collarPos,'column_collar_castings');
    const arch=(point,radius=0.09)=>{
      const pts=[];for(let i=0;i<=24;i++)pts.push(point(i/24));
      const m=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),24,radius,8,false),trim);
      m.castShadow=true;m.receiveShadow=true;hall.add(m);
    };
    for(let i=0;i<columnXs.length-1;i++) {
      const centre=(columnXs[i]+columnXs[i+1])/2;
      for(const r of [2.3,2.12])arch(t=>new THREE.Vector3(centre+Math.cos(Math.PI*t)*r,15.2+Math.sin(Math.PI*t)*r,-0.61),r===2.3?0.115:0.052);
      for(const dx of [-1.9,0,1.9])addBox(0.09,0.65,0.17,centre+dx,17.25,-0.55);
    }
    for(const side of [-1,1])for(const z of [1.35,5.45,9.55,13.0]) {
      for(const r of [1.9,1.75])arch(t=>new THREE.Vector3(side*10.91,8.0+Math.sin(Math.PI*t)*r,z+Math.cos(Math.PI*t)*r),r===1.9?0.12:0.05);
      for(const dz of [-1.92,1.92]) {
        addBox(0.72,0.14,0.75,side*10.92,0.55,z+dz);
        addBox(0.64,0.12,0.70,side*10.92,0.78,z+dz);
        addBox(0.71,0.15,0.72,side*10.92,7.95,z+dz);
        addBox(0.80,0.13,0.81,side*10.92,8.12,z+dz);
      }
      for(const dz of [-0.87,0.87])addBox(0.10,5.2,0.045,side*10.95,11.9,z+dz);
      for(const y of [10.6,13.2])addBox(0.10,0.05,2.8,side*10.95,y,z);
    }
    // Glazed roof follows the same curve as the existing iron ribs.
    const roofPoint=(x,t)=>new THREE.Vector3(x,(1-t)*(1-t)*17.5+2*(1-t)*t*21.8+t*t*16.5,
      (1-t)*(1-t)*(-1)+2*(1-t)*t*6+t*t*14);
    const pos=[],idx=[];
    for(let j=0;j<12;j++)for(let i=0;i<8;i++) {
      const n=pos.length/3;
      for(const [x,t] of [[-9.2+i*2.3,j/12],[-9.2+(i+1)*2.3,j/12],
        [-9.2+(i+1)*2.3,(j+1)/12],[-9.2+i*2.3,(j+1)/12]])pos.push(...roofPoint(x,t).toArray());
      idx.push(n,n+1,n+2,n,n+2,n+3);
    }
    const roofGeo=new THREE.BufferGeometry();roofGeo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    roofGeo.setIndex(idx);roofGeo.computeVertexNormals();
    const roofGlass=new THREE.Mesh(roofGeo,glass);roofGlass.name='roof_glass_no_opaque_shadow';
    roofGlass.castShadow=false;roofGlass.receiveShadow=false;hall.add(roofGlass);
    for(let j=0;j<=12;j++){const p=roofPoint(0,j/12);addBox(18.6,0.065,0.075,0,p.y-0.03,p.z);}
    for(let i=0;i<=8;i++) {
      const curve=new THREE.QuadraticBezierCurve3(roofPoint(-9.2+i*2.3,0),
        new THREE.Vector3(-9.2+i*2.3,21.8,6),roofPoint(-9.2+i*2.3,1));
      hall.add(new THREE.Mesh(new THREE.TubeGeometry(curve,20,0.035,6,false),trim));
    }
    const seamMat=new THREE.MeshStandardMaterial({color:0x252d31,roughness:0.95});
    for(let x=-15;x<=15;x+=3)addBox(0.018,0.008,26,x,0.006,0,seamMat);
    for(let z=-12;z<=12;z+=3)addBox(34,0.008,0.018,0,0.006,z,seamMat);
  }

  _buildRooftopGarden() {
    this.gardenGroup = new THREE.Group();
    this.gardenGroup.name = 'garden_terrace_01';
    this.gardenGroup.position.set(0.0, 13.0, -3.2);

    // Sunlit Sky Backdrop & Conservatory Glass Dome behind #309
    const skyGeo = new THREE.PlaneGeometry(14.0, 9.0);
    this.gardenSkyMat = new THREE.MeshBasicMaterial({
      color: 0xffeab3
    });
    const skyBackdrop = new THREE.Mesh(skyGeo, this.gardenSkyMat);
    skyBackdrop.position.set(0, 2.2, -3.5);
    this.gardenGroup.add(skyBackdrop);

    // Terrace stone floor
    const terraceFloor = new THREE.Mesh(
      metricBox(8.5, 0.3, 5.5),
      new THREE.MeshStandardMaterial({ color: 0x9b8e78, roughness: 0.75 })
    );
    terraceFloor.position.set(0, -0.15, -0.6);
    this.gardenGroup.add(terraceFloor);

    // Raised Terracotta Planters & Lush Foliage Canopies (visible through open #309)
    const foliageMat1 = new THREE.MeshStandardMaterial({ color: 0x3b6e32, roughness: 0.65 });
    const foliageMat2 = new THREE.MeshStandardMaterial({ color: 0x568f3c, roughness: 0.60 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x543b28, roughness: 0.80 });

    const treePositions = [
      [-1.4, 0.0, -1.2, 1.2],
      [1.35, 0.0, -1.1, 1.15],
      [0.0, 0.0, -2.1, 1.45],
      [-0.65, 0.0, -0.4, 0.85],
      [0.75, 0.0, -0.35, 0.90]
    ];
    for (const [tx, ty, tz, sc] of treePositions) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * sc, 0.12 * sc, 1.4 * sc, 10), trunkMat);
      stem.position.set(tx, ty + 0.7 * sc, tz);
      this.gardenGroup.add(stem);

      const crown1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.68 * sc, 1), foliageMat1);
      crown1.position.set(tx, ty + 1.45 * sc, tz);
      this.gardenGroup.add(crown1);

      const crown2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.52 * sc, 1), foliageMat2);
      crown2.position.set(tx + 0.22, ty + 1.85 * sc, tz + 0.18);
      this.gardenGroup.add(crown2);
    }

    // Hanging conservatory ivy vines framing the top opening of #309
    for (let i = -3; i <= 3; i++) {
      const vine = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.09, 1.1 + (Math.abs(i) % 2) * 0.4, 8),
        foliageMat2
      );
      vine.position.set(i * 0.34, 2.05, 1.65);
      this.gardenGroup.add(vine);
    }

    // Volumetric Golden Sunbeam Shafts pouring out of #309 when opened
    const shaftGeo = new THREE.ConeGeometry(2.2, 11.0, 24, 1, true);
    this.sunShaftMat = new THREE.MeshBasicMaterial({
      color: 0xffe49e,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const shaftMesh = new THREE.Mesh(shaftGeo, this.sunShaftMat);
    shaftMesh.position.set(0.0, 11.2, 2.2);
    shaftMesh.rotation.x = Math.PI * 0.32;
    this.scene.add(shaftMesh);
    this.sunShafts.push(shaftMesh);

    this.scene.add(this.gardenGroup);
  }

  _buildMechanismEntities(sim) {
    // 1. Instantiate all Drawers & Counterweight Load Cages
    for (const [id, d] of Object.entries(sim.drawers)) {
      const isCage = id.includes('tray') || id.includes('cage') || id === 'drawer_s2_counter';
      const templateName = isCage ? 'mesh_load_cage' : 'mesh_hero_drawer';
      const template = this.loadedTemplates[templateName];

      // Stationary wall-mounted guide & fixed latch assembly (stays at wall Z, tracks vertical Y if lift)
      const fixedGuideGroup = new THREE.Group();
      fixedGuideGroup.name = `fixed_guide_${id}`;
      fixedGuideGroup.position.set(d.x, d.y, 0.0);
      this.scene.add(fixedGuideGroup);

      // Moving drawer/cage group
      const movingGroup = new THREE.Group();
      movingGroup.name = `entity_${id}`;

      const meshInstance = template ? template.clone(true) : new THREE.Group();
      if (id === 'drawer_s3_garden' && !meshInstance.getObjectByName('mesh_hero_drawer_role_fixed')) {
        meshInstance.scale.set(1.22, 1.15, 1.12);
      }

      // Exported roles retain the Blender basis, exact PBR material objects and authored details.
      const fixedRole = meshInstance.getObjectByName('mesh_hero_drawer_role_fixed');
      const carrierRole = meshInstance.getObjectByName('mesh_hero_drawer_role_carrier');
      const detailedLatch = meshInstance.getObjectByName('mesh_hero_drawer_role_latch_pivot');
      const notchRack = meshInstance.getObjectByName('mesh_hero_drawer_role_notches');
      const weighingPan = meshInstance.getObjectByName('mesh_hero_drawer_role_weighing_pan');
      const springHousing = meshInstance.getObjectByName('mesh_hero_drawer_role_spring_housing');
      const outputSpool = meshInstance.getObjectByName('mesh_hero_drawer_role_output_spool');
      const windingRatchet = meshInstance.getObjectByName('mesh_hero_drawer_role_winding_ratchet');
      const springRelease = meshInstance.getObjectByName('mesh_hero_drawer_role_spring_release');
      if (springHousing) springHousing.visible = id === 'drawer_s1_a';
      const panGuides = meshInstance.getObjectByName('mesh_hero_drawer_role_pan_guides');
      if (panGuides) panGuides.visible = id === 'drawer_s1_a';
      const rearBulkhead = meshInstance.getObjectByName('mesh_hero_drawer_role_rear_bulkhead');
      if (rearBulkhead) rearBulkhead.visible = id !== 'drawer_s3_garden';
      const rollerRoles = [];
      meshInstance.traverse(o => { if (o.userData.motion_role === 'carrier_roller') rollerRoles.push(o); });
      let fixedLatchPawl = null;
      if (fixedRole && carrierRole) {
        meshInstance.updateMatrix();
        for (const role of [fixedRole, carrierRole]) {
          meshInstance.remove(role);
          role.applyMatrix4(meshInstance.matrix);
          fixedGuideGroup.add(role);
        }
        // Every drawer uses its actual authoritative stop list, including the 1.65/1.75/2.05 variants.
        const notchTemplate = notchRack.getObjectByName('mesh_hero_drawer_notch_unit');
        notchRack.clear();
        for (const side of [-1, 1]) for (const stop of d.notches || []) {
          const unit = notchTemplate.clone(true);
          unit.name = `mesh_hero_drawer_notch_${side}_${stop}`;
          unit.position.set(side * .807, 0, 1.10 - stop);
          unit.userData.stop_extension_m = stop;
          unit.userData.side = side;
          notchRack.add(unit);
        }
        if (weighingPan) weighingPan.visible = id === 'drawer_s1_a';
      } else if (!isCage && d.notches?.length) {
        // Legacy asset fallback only. Revision2 uses its complete exported stationary mechanism.
        const hw = (d.width || 1.55) * .5 + .07;
        fixedLatchPawl = new THREE.Mesh(new THREE.BoxGeometry(.08,.16,.12), this.materials.brass);
        fixedLatchPawl.position.set(hw+.02,.12,.24);
        fixedGuideGroup.add(fixedLatchPawl);
      }

      // Add high-contrast top foothold trim strip along drawer front lip for unmistakable platform readability
      if (!isCage) {
        const footholdStrip = new THREE.Mesh(
          metricBox((d.width || 1.55) + 0.06, 0.026, 0.11),
          this.materials.brass
        );
        footholdStrip.position.set(0, (d.height || 0.62) * 0.5 + 0.02, (d.depth || 2.1) * 0.5);
        movingGroup.add(footholdStrip);
      }

      // Add deterministic object-specific Drawer Number & Mass Limit Plaque on Front Plate
      const plaqueTex = this._makeDeterministicPlaqueTexture(
        d.number,
        `MAX ${d.maxLoadKg || 120} KG`,
        '#8a261c',
        true
      );
      const plaqueMat = new THREE.MeshBasicMaterial({ map: plaqueTex });
      const plaqueMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.22), plaqueMat);
      const frontZ = isCage ? (d.depth || 1.35) * 0.5 + 0.05 : (d.depth || 2.10) * 0.5 + 0.06;
      plaqueMesh.position.set(0, isCage ? 0.52 : 0.14, frontZ);
      movingGroup.add(plaqueMesh);

      // For #309 Garden Drawer: add openable rear/interior conservatory shutter doors and interior brass lever
      let shutterLeft = null;
      let shutterRight = null;
      if (id === 'drawer_s3_garden') {
        const sGeo = metricBox(0.88, 2.30, 0.06);
        shutterLeft = new THREE.Mesh(sGeo, this.materials.lacquer);
        shutterLeft.position.set(-0.45, .933, -0.95);
        movingGroup.add(shutterLeft);

        shutterRight = new THREE.Mesh(sGeo, this.materials.lacquer);
        shutterRight.position.set(0.45, .933, -0.95);
        movingGroup.add(shutterRight);

        const interiorLever = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.03, 0.55, 12),
          this.materials.brass
        );
        interiorLever.position.set(0.0, 0.35, -0.45);
        movingGroup.add(interiorLever);
      }

      // Find cargo hatch gate if present on load cage
      let hatchGate = null;
      meshInstance.traverse((ch) => {
        if (ch.isMesh && ch.name.includes('cargo_hatch_gate')) {
          hatchGate = ch;
        }
      });

      movingGroup.add(meshInstance);
      this.scene.add(movingGroup);

      this.drawerViews[id] = {
        id,
        movingGroup,
        fixedGuideGroup,
        fixedLatchPawl,
        detailedLatch, carrierRole, rollerRoles, notchRack, weighingPan,
        springHousing, outputSpool, windingRatchet, springRelease,
        hatchGate,
        shutterLeft,
        shutterRight,
        plaqueMesh
      };
    }

    // 2. Instantiate Transfer Chutes
    for (const [cid, chute] of Object.entries(sim.chutes)) {
      const tpl = this.loadedTemplates.mesh_transfer_chute;
      const chuteGroup = tpl ? tpl.clone(true) : new THREE.Group();
      // Contract: entry/exit trace the roller-top support surface, in simulation coordinates.
      const entry = new THREE.Vector3(chute.entryX, chute.entryY, chute.entryZ - .35);
      const exit = new THREE.Vector3(chute.exitX, chute.exitY, chute.exitZ - .35);
      const tangent = exit.clone().sub(entry), length = tangent.length();
      if (length < .01) throw new Error(`Degenerate chute path: ${cid}`);
      tangent.normalize();
      const normal = new THREE.Vector3(0, 1, 0).addScaledVector(tangent, -tangent.y).normalize();
      const side = new THREE.Vector3().crossVectors(tangent, normal).normalize();
      const width = chute.widthM ?? 1.35, rollerTop = chute.rollerTopLocalY ?? .072;
      const apron = chute.entryApronM ?? (cid === 'chute_upper_west' ? .85 : .40);
      const bedLength = length + apron;
      const lengthScale = bedLength / 2.4, widthScale = width / .78;
      // Resize the retained Blender bed and flanges. Rollers remain circular, with their
      // centres redistributed along the shorter path and their axial length widened.
      chuteGroup.traverse(mesh => {
        if (!mesh.isMesh) return;
        if (mesh.name.includes('_roller_')) {
          mesh.position.x *= lengthScale;
          mesh.scale.y *= (width - .12) / (.78 - .12);
          return;
        }
        mesh.geometry = mesh.geometry.clone();
        const bed = mesh.name.endsWith('_bed');
        mesh.geometry.scale(lengthScale, 1, bed ? widthScale : 1);
        if (mesh.name.includes('_flange_')) mesh.position.z = Math.sign(mesh.position.z) * (width / 2 - .025);
        // The lacquer bed is metre UV mapped. Reproject after changing its dimensions,
        // preserving imported material objects and their 2/10/4 texture transforms.
        if (bed && mesh.geometry.attributes.uv) {
          const p = mesh.geometry.attributes.position, n = mesh.geometry.attributes.normal, uv = mesh.geometry.attributes.uv;
          for (let i=0; i<p.count; i++) {
            const ax=Math.abs(n.getX(i)), ay=Math.abs(n.getY(i)), az=Math.abs(n.getZ(i));
            if (ax>=ay && ax>=az) uv.setXY(i,-p.getZ(i),p.getY(i));
            else if (ay>=az) uv.setXY(i,p.getX(i),p.getZ(i));
            else uv.setXY(i,p.getX(i),p.getY(i));
          }
          uv.needsUpdate = true;
        }
      });
      chuteGroup.position.copy(entry).add(exit).multiplyScalar(.5).addScaledVector(tangent, -apron / 2).addScaledVector(normal, -rollerTop);
      chuteGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, normal, side));
      chuteGroup.userData.supportPath = { entry:entry.toArray(), exit:exit.toArray(), lengthM:length, bedLengthM:bedLength, entryApronM:apron, localEntryX:-(length-apron)/2, localExitX:bedLength/2, widthM:width, rollerTopLocalY:rollerTop };
      this.scene.add(chuteGroup);
      this.chuteViews[cid] = chuteGroup;
    }

    // 3. Instantiate all 6 Identifiable Possession Payloads with exact, non-conflicting deterministic plaques
    const payloadTagCodes = {
      rolling_parcel_01: ['PARCEL #P-01', '18 KG DISPATCH'],
      payload_trunk_01: ['TRUNK #A-12', 'MASS 35 KG'],
      payload_carpet_02: ['CARPET #B-07', 'MASS 25 KG'],
      payload_ceramic_03: ['CERAMIC #C-03', 'MASS 20 KG'],
      payload_umbrella_04: ['UMBRELLA #D-04', 'MASS 15 KG'],
      payload_instruments_05: ['SURVEY #E-19', 'MASS 45 KG']
    };

    for (const [pid, p] of Object.entries(sim.payloads)) {
      const assetSpec = this.contract.payload_catalog.find((entry) => entry.id === pid);
      const meshId = assetSpec?.mesh_id || p.meshId;
      const tpl = this.loadedTemplates[meshId];
      if (!tpl) throw new Error(`Missing contracted payload asset: ${pid} -> ${meshId}`);
      const pGroup = new THREE.Group();
      pGroup.name = `payload_${pid}`;

      const model = tpl.clone(true);
      model.userData.contractMeshId = meshId;
      model.userData.contractMassKg = assetSpec?.mass_kg ?? p.massKg;
      pGroup.add(model);

      // The integrated Blender payloads carry unique deterministic labels already.
      // Keep those maps and their orientation; no floating duplicate obscures the object.
      let hasExportedLabel = false;
      model.traverse((child) => {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        if (mats.some((m) => m?.name?.startsWith('mat_label_'))) hasExportedLabel = true;
      });
      let tagPlane = null;
      if (!hasExportedLabel) {
        const label = assetSpec?.label || pid;
        const tex = this._makeDeterministicPlaqueTexture(label, `${assetSpec?.mass_kg ?? p.massKg} KG`);
        tagPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.21), new THREE.MeshBasicMaterial({ map: tex }));
        tagPlane.position.set(0, 0.34, 0.29);
        pGroup.add(tagPlane);
      }
      this.scene.add(pGroup);
      this.payloadViews[pid] = { group: pGroup, model, tagPlane };
    }
  }

  _buildCoupledCableRigs(sim) {
    // Define overhead pulley pairs for every coupled mechanism in the puzzle
    const definitions = [
      { idA: 'receiving_tray_01', idB: 'drawer_catch_02', pulleyY: 2.85 },
      { idA: 'drawer_s1_a', idB: 'drawer_s1_c', pulleyY: 5.15 },
      { idA: 'drawer_s2_counter', idB: 'drawer_s2_lift', pulleyY: 8.65 },
      { idA: 'cage_s3_west', idB: 'drawer_s3_a', pulleyY: 10.65 },
      { idA: 'cage_s3_east', idB: 'drawer_s3_b', pulleyY: 12.85 },
      { idA: 'cage_s3_east', idB: 'drawer_s3_garden', pulleyY: 14.95 }
    ];

    const sheaveGeo = new THREE.CylinderGeometry(0.205, 0.205, 0.075, 32);
    const rimGeo = new THREE.TorusGeometry(0.221, 0.024, 8, 32);
    const hubGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.145, 24);
    const bracketGeo = metricBox(0.12, 0.42, 0.35);

    definitions.forEach((def) => {
      const dA = sim.drawers[def.idA];
      const dB = sim.drawers[def.idB];
      if (!dA || !dB) return;

      // The sheaves remain above either attachment at its maximum valid travel.
      const maxAttachmentY = d => Math.max(d.y, Number.isFinite(d.maxY) ? d.maxY : d.y) + (this.drawerViews[d.id].detailedLatch ? .396 : 1.43);
      const maximumAttachmentY = Math.max(maxAttachmentY(dA), maxAttachmentY(dB));
      const pulleyY = Math.max(def.pulleyY, maximumAttachmentY + .55);
      const pA = new THREE.Vector3(dA.x, pulleyY, 0.85);
      const pB = new THREE.Vector3(dB.x, pulleyY, 0.85);

      if (def.idA === 'drawer_s1_a' && this.drawerViews[def.idA].springHousing) {
        // #104 is a spring release pan. Its cable starts at the fixed output drum, not the deck.
        pA.set(dA.x + .995, pulleyY, .73);
        pB.set(dB.x + .807, pulleyY + .8, 3.1);
      }
      const wheels = [];
      [pA, pB].forEach((pos) => {
        const sheave = new THREE.Mesh(sheaveGeo, this.materials.brass);
        sheave.position.copy(pos);
        sheave.rotation.x = Math.PI * 0.5;
        this.scene.add(sheave);
        this.pulleyWheels.push(sheave);
        wheels.push(sheave);
        for(const offset of [-0.047,0.047]) {
          const rim=new THREE.Mesh(rimGeo,this.materials.brassFixed);
          rim.rotation.x=Math.PI/2;rim.position.y=offset;sheave.add(rim);
        }
        const hub=new THREE.Mesh(hubGeo,this.materials.iron);sheave.add(hub);
        const bolt=new THREE.Mesh(new THREE.CylinderGeometry(0.036,0.036,0.16,6),this.materials.brass);
        sheave.add(bolt);

        const bracket = new THREE.Mesh(bracketGeo, this.materials.iron);
        bracket.position.set(pos.x, pos.y + 0.18, pos.z - 0.15);
        this.scene.add(bracket);
      });

      // Create 3 cylindrical cable segments: A -> pA, pA -> pB, pB -> B
      const segs = [0, 1, 2].map(() => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.0, 8), this.materials.steelCable);
        this.scene.add(m);
        return m;
      });

      this.cableViews.push({
        idA: def.idA,
        idB: def.idB,
        pA,
        pB,
        maximumAttachmentY,
        wheels,
        segs
      });
    });
  }

  _updateSpringControl(sim) {
    const d=sim.drawers.drawer_s1_a, output=sim.drawers.drawer_s1_c;
    const rig=this.drawerViews.drawer_s1_a;
    if (!rig?.springHousing?.visible || !output) return;
    // The mechanics exposes rail travel and energy, not spring stiffness: no invented energy-to-angle curve.
    rig.outputSpool.rotation.x = -(output.zExt-.15)/.11;
    rig.windingRatchet.rotation.x = -(d.zExt-.60)/.055;
    rig.springRelease.rotation.x = d.panReleaseEngaged ? .38 : 0;
    this.scene.updateMatrixWorld(true);
    const panAnchor=rig.weighingPan.localToWorld(new THREE.Vector3(.52, -.03, .40));
    const releaseAnchor=rig.springRelease.localToWorld(new THREE.Vector3(0,0,0));
    // Flexible release wire follows the inner pan with a service loop below the right rim.
    const points=[panAnchor,
      new THREE.Vector3(d.x+.73,d.y-.04,panAnchor.z),
      new THREE.Vector3(d.x+.90,d.y-.25,panAnchor.z-.10),
      new THREE.Vector3(d.x+1.12,d.y-.30,.88),releaseAnchor];
    if (!rig.releaseWire) {
      rig.releaseWire=new THREE.Mesh(new THREE.BufferGeometry(),this.materials.steelCable);
      rig.releaseWire.name='mesh_hero_drawer_pan_release_wire';this.scene.add(rig.releaseWire);
    }
    const signature=points.map(p=>p.toArray().map(n=>n.toFixed(4)).join(',')).join('|');
    if (signature!==rig.releaseWireSignature) {
      rig.releaseWire.geometry.dispose();
      rig.releaseWire.geometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),24,.0025,6,false);
      rig.releaseWireSignature=signature;
    }
  }

  _drawerCableAttachment(id) {
    const rig = this.drawerViews[id];
    if (!rig.cableAnchorLocal) {
      if (rig.detailedLatch) {
        // Transfer the rope load into the exported side coping through a seated clevis.
        const base = new THREE.Mesh(metricBox(.05, .028, .10), this.materials.brassFixed);
        base.name = `cable_anchor_base_${id}`;
        base.position.set(.7425, .326, .20); // Bottom .312 matches the actual coping top.
        const eye = new THREE.Mesh(new THREE.TorusGeometry(.022, .006, 6, 16), this.materials.brassFixed);
        eye.name = `cable_anchor_eye_${id}`;
        eye.position.set(.7425, .368, .20);
        rig.movingGroup.add(base, eye);
        rig.cableAnchorLocal = new THREE.Vector3(.7425, .396, .20);
      } else {
        // The retained cage suspension clevis centre is Y1.29, with .14m radius.
        rig.cableAnchorLocal = new THREE.Vector3(0, 1.43, 0);
      }
    }
    rig.movingGroup.updateWorldMatrix(true, false);
    return rig.movingGroup.localToWorld(rig.cableAnchorLocal.clone());
  }

  _updateCableSegment(mesh, startVec, endVec) {
    const dir = new THREE.Vector3().subVectors(endVec, startVec);
    const len = Math.max(0.01, dir.length());
    mesh.position.copy(startVec).addScaledVector(dir, 0.5);
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }

  _buildPlayerCharacter() {
    // Camera-scale clothed silhouette. Rendering only: the physics body is unchanged.
    this.playerGroup = new THREE.Group();
    this.playerGroup.name = 'player_character';
    const coat = new THREE.MeshStandardMaterial({color:0x344759,roughness:0.92});
    const trousers = new THREE.MeshStandardMaterial({color:0x343433,roughness:0.95});
    const leather = new THREE.MeshStandardMaterial({color:0x372b23,roughness:0.69});
    const skin = new THREE.MeshStandardMaterial({color:0xbc8b69,roughness:0.88});
    const shirt = new THREE.MeshStandardMaterial({color:0xbcb4a0,roughness:0.96});
    const ellipsoid=(parent,rx,ry,rz,x,y,z,mat,name)=>{
      const m=new THREE.Mesh(new THREE.SphereGeometry(1,12,10),mat);
      m.scale.set(rx,ry,rz);m.position.set(x,y,z);m.name=name;
      m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
    };
    const part=(parent,geo,mat,x,y,z,name)=>{
      const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.name=name;
      m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
    };
    // Shaped jacket has shoulders, waist and hem instead of a single capsule.
    const jacketProfile=[new THREE.Vector2(0.17,0.82),new THREE.Vector2(0.18,0.87),
      new THREE.Vector2(0.155,1.0),new THREE.Vector2(0.19,1.19),
      new THREE.Vector2(0.225,1.29),new THREE.Vector2(0.16,1.34),new THREE.Vector2(0.08,1.36)];
    const jacket=part(this.playerGroup,new THREE.LatheGeometry(jacketProfile,16),coat,0,0,0,'archivist_jacket');
    jacket.scale.z=0.68;
    part(this.playerGroup,new THREE.CylinderGeometry(0.062,0.075,0.10,12),skin,0,1.39,0,'archivist_neck');
    ellipsoid(this.playerGroup,0.113,0.142,0.102,0,1.54,0,skin,'archivist_head');
    ellipsoid(this.playerGroup,0.026,0.033,0.037,0,1.54,0.093,skin,'archivist_nose');
    for(const sign of [-1,1]) {
      ellipsoid(this.playerGroup,0.018,0.035,0.022,sign*0.107,1.54,0,skin,'archivist_ear');
      const collar=part(this.playerGroup,metricBox(0.078,0.13,0.014),shirt,sign*0.048,1.28,0.128,'archivist_collar');
      collar.rotation.z=sign*0.29;
      const lapel=part(this.playerGroup,metricBox(0.055,0.20,0.014),coat,sign*0.065,1.19,0.135,'archivist_lapel');
      lapel.rotation.z=-sign*0.19;
    }
    for(const y of [0.93,1.04,1.15])part(this.playerGroup,new THREE.SphereGeometry(0.009,6,4),this.materials.brass,0.025,y,0.137,'archivist_button');
    const cap=part(this.playerGroup,new THREE.SphereGeometry(1,14,8),coat,0,1.655,-0.012,'archivist_cap');
    cap.scale.set(0.125,0.060,0.111);
    const brim=part(this.playerGroup,new THREE.SphereGeometry(1,12,6),leather,0,1.64,0.084,'archivist_cap_brim');
    brim.scale.set(0.115,0.012,0.09);
    this.archivistRig={arms:[],legs:[]};
    for(const sign of [-1,1]) {
      const arm=new THREE.Group();arm.position.set(sign*0.217,1.29,0);arm.name='archivist_shoulder';this.playerGroup.add(arm);
      ellipsoid(arm,0.075,0.16,0.077,0,-0.11,0,coat,'archivist_upper_sleeve');
      const forearm=new THREE.Group();forearm.position.y=-0.26;arm.add(forearm);
      ellipsoid(forearm,0.056,0.14,0.062,0,-0.11,0,coat,'archivist_forearm_sleeve');
      ellipsoid(forearm,0.043,0.067,0.036,0,-0.27,0,skin,'archivist_hand');
      this.archivistRig.arms.push({root:arm,elbow:forearm,sign});
      const leg=new THREE.Group();leg.position.set(sign*0.102,0.85,0);leg.name='archivist_hip';this.playerGroup.add(leg);
      ellipsoid(leg,0.083,0.205,0.088,0,-0.18,0,trousers,'archivist_trouser_thigh');
      const knee=new THREE.Group();knee.position.y=-0.38;leg.add(knee);
      ellipsoid(knee,0.066,0.18,0.072,0,-0.17,0,trousers,'archivist_trouser_shin');
      ellipsoid(knee,0.074,0.065,0.145,0,-0.405,0.056,leather,'archivist_boot');
      this.archivistRig.legs.push({root:leg,knee,sign});
    }
    // Small canvas satchel and strap, kept inside the player body's 0.32 m radius.
    const satchel=part(this.playerGroup,metricBox(0.23,0.23,0.09),leather,-0.015,0.99,-0.177,'archivist_satchel');
    satchel.rotation.z=-0.07;
    const strap=part(this.playerGroup,metricBox(0.031,0.53,0.016),leather,-0.032,1.10,0.133,'archivist_satchel_strap');
    strap.rotation.z=-0.48;
    this.playerLantern=new THREE.PointLight(0xffcf87,0.08,2.0,1.7);
    this.playerLantern.position.set(0,0.98,0.21);this.playerGroup.add(this.playerLantern);
    this.scene.add(this.playerGroup);
  }

  _poseArchivist(player,time) {
    // RelVx excludes a platform carrying the player. Only presentation is animated.
    const speed=Math.min(1,Math.hypot(player.relVx||0,player.relVz||0)/4.4);
    const swing=player.grounded?Math.sin(time*10)*0.38*speed:0;
    for(const leg of this.archivistRig.legs) {
      leg.root.rotation.x=player.grounded?swing*leg.sign:-0.22*leg.sign;
      leg.knee.rotation.x=player.grounded?Math.max(0,-swing*leg.sign)*0.65:0.36;
    }
    for(const arm of this.archivistRig.arms) {
      arm.root.rotation.x=player.grounded?-swing*arm.sign*0.72:-0.42;
      arm.root.rotation.z=-arm.sign*(player.grounded?0.025:0.12);
      arm.elbow.rotation.x=player.grounded?-0.12:-0.35;
    }
  }

  setInspectionMode(mode) {
    this.cameraMode = mode;
    document.body.classList.toggle('proof-isolation', mode === 'closeup' || mode === 'clay_wireframe' || mode === 'material_isolation');

    if (mode === 'clay_wireframe') {
      this.scene.traverse((obj) => {
        if (obj.isMesh && obj.name.startsWith('mesh_hero_drawer')) {
          if (!obj.userData.origMat) obj.userData.origMat = obj.material;
          obj.material = this.materials.clay;
          if (!obj.userData.wireHelper) {
            const wireGeo = new THREE.WireframeGeometry(obj.geometry);
            const wireMat = new THREE.LineBasicMaterial({ color: 0x1a222d });
            const wire = new THREE.LineSegments(wireGeo, wireMat);
            obj.add(wire);
            obj.userData.wireHelper = wire;
          }
          obj.userData.wireHelper.visible = true;
        }
      });
    } else {
      this.scene.traverse((obj) => {
        if (obj.isMesh && obj.userData.origMat) {
          obj.material = obj.userData.origMat;
        }
        if (obj.userData && obj.userData.wireHelper) {
          obj.userData.wireHelper.visible = false;
        }
      });
    }
  }

  syncFromSimulation(sim, dt = 0.016) {
    // 1. Update Drawers, Fixed Guides, Stationary Latch Pawls, Cargo Hatches & Garden Shutters
    for (const [id, d] of Object.entries(sim.drawers)) {
      const view = this.drawerViews[id];
      if (!view) continue;

      const zCenter = (d.zExt || 0) - 0.55;
      view.movingGroup.position.set(d.x, d.y, zCenter);
      view.movingGroup.rotation.x = d.tiltRad || 0.0;

      // Fixed guide tracks vertical lift position Y while staying fixed at wall Z = 0
      view.fixedGuideGroup.position.set(d.x, d.y, 0.0);

      if (view.detailedLatch) {
        view.detailedLatch.rotation.x = d.latched ? 0 : .55;
        if (d.rejectFlashTimer > 0) view.detailedLatch.rotation.x = .55 + Math.sin(sim.time * 40) * .06;
        view.carrierRole.position.z = zCenter * .5;
        // Constraint-driven visual roller rotation, not a separate bearing simulation.
        for (const wheel of view.rollerRoles) wheel.rotation.x = (wheel.userData.contact_role === 'moving_runner' ? 1 : -1) * zCenter * .5 / .052;
        if (view.weighingPan?.visible) view.weighingPan.position.y = .20 - Math.max(0, Math.min(.09, d.panDisplacementM || 0));
      }

      if (view.fixedLatchPawl) {
        if (d.rejectFlashTimer > 0) {
          view.fixedLatchPawl.material = this.materials.latchRejected;
          view.fixedLatchPawl.position.y = 0.16 + Math.sin(sim.time * 40.0) * 0.03;
        } else if (d.latched) {
          view.fixedLatchPawl.material = this.materials.latchLocked;
          view.fixedLatchPawl.position.y = 0.05; // Dropped into physical notch tooth
        } else {
          view.fixedLatchPawl.material = this.materials.brass;
          view.fixedLatchPawl.position.y = 0.14; // Raised above rail bar
        }
      }

      if (view.hatchGate && d.hasCargoHatch) {
        view.hatchGate.position.y = d.cargoHatchOpen ? 0.68 : 0.26;
        view.hatchGate.rotation.x = d.cargoHatchOpen ? -Math.PI * 0.42 : 0.0;
      }

      if (id === 'drawer_s3_garden' && view.shutterLeft && view.shutterRight) {
        const openAmt = d.shutterOpen || 0.0;
        view.shutterLeft.position.x = -0.45 - openAmt * 0.72;
        view.shutterRight.position.x = 0.45 + openAmt * 0.72;
      }
    }

    // 2. Update Payloads
    for (const [pid, p] of Object.entries(sim.payloads)) {
      const pv = this.payloadViews[pid];
      if (!pv) continue;
      pv.group.position.set(p.x, p.y, (p.z || 1.15) - 0.35);
      if (p.rollAngle) {
        pv.model.rotation.z = -p.rollAngle;
      } else {
        pv.model.rotation.z = 0.0;
      }
    }

    this._updateSpringControl(sim);

    // 3. Update Dynamic Tensioned Steel Cables & Pulley Sheave Rotation
    for (const cable of this.cableViews) {
      const dA = sim.drawers[cable.idA];
      const dB = sim.drawers[cable.idB];
      if (!dA || !dB) continue;

      const springPair = cable.idA === 'drawer_s1_a' && this.drawerViews[cable.idA].springHousing;
      const attachA = springPair ? new THREE.Vector3() : this._drawerCableAttachment(cable.idA);
      const attachB = springPair ? new THREE.Vector3() : this._drawerCableAttachment(cable.idB);

      if (cable.idA === 'drawer_s1_a' && this.drawerViews[cable.idA].springHousing) {
        const housing=this.drawerViews[cable.idA].springHousing;
        housing.updateWorldMatrix(true,false);
        attachA.copy(housing.localToWorld(new THREE.Vector3(.015,0,.11)));
        // Output attachment is ahead of the sliding rail; tension has the required outward Z component.
        attachB.set(dB.x+.807,dB.y-.064,dB.zExt+.50);
        const incoming=[attachA.clone().sub(cable.pA),cable.pA.clone().sub(cable.pB)];
        const outgoing=[cable.pB.clone().sub(cable.pA),attachB.clone().sub(cable.pB)];
        cable.wheels.forEach((wheel,i)=>{
          const normal=new THREE.Vector3().crossVectors(incoming[i],outgoing[i]).normalize();
          if (normal.lengthSq()>.5) wheel.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),normal);
        });
      }

      this._updateCableSegment(cable.segs[0], attachA, cable.pA);
      this._updateCableSegment(cable.segs[1], cable.pA, cable.pB);
      this._updateCableSegment(cable.segs[2], cable.pB, attachB);
    }

    // 4. Update Rooftop Conservatory Daylight & Volumetric Shafts
    const gFactor = sim.gardenLightFactor || 0.0;
    this.gardenLight.intensity = 1.2 + gFactor * 18.0;
    if (this.sunShaftMat) {
      this.sunShaftMat.opacity = gFactor * 0.28;
    }

    // 5. Update Player Character
    const p = sim.player;
    this.playerGroup.position.set(p.x, p.y, (p.z || 1.15) - 0.25);
    this.playerGroup.rotation.y = p.facing >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    this._poseArchivist(p,sim.time);

    // 6. Update Camera Framing by Mode
    syncRooftopGarden(this,sim);
    this._updateCamera(sim, dt);
  }

  _updateCamera(sim, dt) {
    if (updatePresentationCamera(this,sim,dt)) return;
    if (this.cameraMode === 'hero') {
      this.camera.position.set(-8.2, 3.0, 7.2);
      this.cameraTarget.set(-0.5, 7.0, -0.3);
      this.camera.fov = 58;
    } else if (this.cameraMode === 'closeup' || this.cameraMode === 'clay_wireframe') {
      const d = sim.drawers.drawer_s1_a;
      this.camera.position.set(d.x + 1.45, d.y + 0.85, (d.zExt || 0.6) + 1.85);
      this.cameraTarget.set(d.x, d.y + 0.05, (d.zExt || 0.6) - 0.35);
      this.camera.fov = 38;
    } else if (this.cameraMode === 'material_isolation') {
      const d = sim.drawers.drawer_s1_a;
      this.camera.position.set(d.x + 1.25, d.y + 1.55, (d.zExt || 0.6) + 1.45);
      this.cameraTarget.set(d.x, d.y - 0.05, (d.zExt || 0.6) - 0.45);
      this.camera.fov = 40;
    } else if (this.cameraMode === 'coupled_proof') {
      this.camera.position.set(0.6, 5.4, 8.2);
      this.cameraTarget.set(0.6, 5.0, 0.8);
      this.camera.fov = 46;
    } else if (this.cameraMode === 'garden_payoff' || (sim.completed && sim.gardenLightFactor > 0.35)) {
      this.camera.position.set(0.0, 13.9, 4.4);
      this.cameraTarget.set(0.0, 14.1, -3.2);
      this.camera.fov = 50;
    } else {
      // Dynamic readable gameplay camera tracking player altitude while keeping coupled mechanisms in view
      const px = sim.player.x;
      const py = sim.player.y;
      const targetCamX = px * 0.65;
      const targetCamY = Math.max(3.2, Math.min(14.0, py + 1.65));
      const targetCamZ = 10.2;

      const lerpAlpha = dt > 0 ? Math.min(1.0, dt * 5.0) : 1.0;
      this.camera.position.x += (targetCamX - this.camera.position.x) * lerpAlpha;
      this.camera.position.y += (targetCamY - this.camera.position.y) * lerpAlpha;
      this.camera.position.z += (targetCamZ - this.camera.position.z) * lerpAlpha;

      this.cameraTarget.x += (px * 0.75 - this.cameraTarget.x) * lerpAlpha;
      this.cameraTarget.y += (Math.max(2.2, py + 0.65) - this.cameraTarget.y) * lerpAlpha;
      this.cameraTarget.z = 0.65;
      this.camera.fov = 48;
    }

    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.cameraTarget);
  }

  render() {
    if (this.materialFinish) return this.materialFinish.render();
    this.renderer.render(this.scene, this.camera);
  }

  resize(width, height) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
}
