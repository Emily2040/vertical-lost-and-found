import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/** Install the actual Blender geometry; do not call the old hall constructor. */
export async function installHall(view, url='/assets/models/railway_hall.glb', options={}) {
  const gltf=await new GLTFLoader().loadAsync(url);
  const old=view.scene.getObjectByName('railway_hall_structure');
  if(old)view.scene.remove(old);
  const hall=gltf.scene;hall.name='railway_hall_structure';
  const roles=[];
  hall.traverse(o=>{
    if(!o.isMesh)return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    const glass=o.name.includes('glass_no_opaque_shadow')||mats.some(m=>m.name.includes('glass_no_opaque_shadow'));
    o.castShadow=!glass;o.receiveShadow=!glass;
    for(const m of mats){
      for(const name of ['map','normalMap','metalnessMap','roughnessMap'])if(m[name])m[name].anisotropy=Math.min(8,view.renderer.capabilities.getMaxAnisotropy());
      // Preserve exported UV transforms and colours. Glass supplies sky illumination,
      // but cannot cast opaque architectural shadows across every drawer.
      if(glass){m.side=THREE.DoubleSide;m.emissiveIntensity=.70;m.transparent=true;m.opacity=.20;m.depthWrite=false;}
    }
    roles.push({name:o.name,glass,castShadow:o.castShadow,material:mats.map(m=>m.name)});
  });
  view.scene.add(hall);view.hallArchitecture=hall;
  configureHallLighting(view,options);
  return {root:hall,roles};
}

/** Call after _setupLighting. Compatible with the existing garden-light animation. */
export function configureHallLighting(view,{skyEnvironment=false}={}){
  view.scene.background=new THREE.Color(0x91b2c6);
  const existingSky=view.scene.getObjectByName('hall_atmosphere');if(existingSky)view.scene.remove(existingSky);
  const atmosphere=new Sky();atmosphere.name='hall_atmosphere';atmosphere.scale.setScalar(900);
  const uniforms=atmosphere.material.uniforms;
  uniforms.turbidity.value=2.3;uniforms.rayleigh.value=1.4;
  uniforms.mieCoefficient.value=.003;uniforms.mieDirectionalG.value=.78;
  uniforms.sunPosition.value.setFromSphericalCoords(1,THREE.MathUtils.degToRad(54),THREE.MathUtils.degToRad(68));
  atmosphere.material.depthWrite=false;view.scene.add(atmosphere);
  view.scene.fog=new THREE.FogExp2(0x7d8b95,.0045);
  view.renderer.toneMappingExposure=1.04;
  view.scene.environmentIntensity=.82;
  if(skyEnvironment){
    const envScene=new THREE.Scene();envScene.add(atmosphere.clone());
    const pmrem=new THREE.PMREMGenerator(view.renderer);
    view.hallReflectionTarget=pmrem.fromScene(envScene,.08);
    view.scene.environment=view.hallReflectionTarget.texture;
    view.scene.environmentIntensity=.12;pmrem.dispose();
  }
  const lights=[];view.scene.traverse(o=>{if(o.isLight)lights.push(o);});
  for(const l of lights){
    if(l===view.keyLight||l===view.gardenLight)continue;
    l.parent?.remove(l);
  }
  view.keyLight.position.set(8,24,10);
  view.keyLight.target.position.set(-3,5,-1);
  view.keyLight.color.setHex(0xffedd1);view.keyLight.intensity=1.85;
  view.keyLight.shadow.mapSize.set(2048,2048);
  Object.assign(view.keyLight.shadow.camera,{left:-17,right:17,top:20,bottom:-15,near:1,far:55});
  view.keyLight.shadow.camera.updateProjectionMatrix();
  view.keyLight.shadow.normalBias=.016;view.keyLight.shadow.bias=-.00008;
  const sky=new THREE.HemisphereLight(0xc9dbe8,0x554535,1.20);sky.name='hall_ambient_sky';view.scene.add(sky);
  const bounce=new THREE.DirectionalLight(0xb9cfe2,1.0);bounce.name='hall_bounce';bounce.position.set(-8,11,10);bounce.target.position.set(0,9,0);
  view.scene.add(bounce,bounce.target);
  // No volumetric meshes or warm point-light wash; the archive keeps readable recesses.
}

/** Optional fixed inspection view. Gameplay/follow camera remains unchanged. */
export function setHallHeroCamera(view){
  view.camera.position.set(9.8,2.7,6.8);
  view.cameraTarget.set(-1.5,10.5,-.7);
  view.camera.fov=65;view.camera.updateProjectionMatrix();view.camera.lookAt(view.cameraTarget);
}
