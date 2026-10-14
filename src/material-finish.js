import * as THREE from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

// Authored finish approximations. Base colour images/UVs for wood and cloth are untouched.
const noise = `
float finishHash(vec3 p) { p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z); }
float finishNoise(vec3 p) {
  vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(mix(finishHash(i),finishHash(i+vec3(1,0,0)),f.x),mix(finishHash(i+vec3(0,1,0)),finishHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(finishHash(i+vec3(0,0,1)),finishHash(i+vec3(1,0,1)),f.x),mix(finishHash(i+vec3(0,1,1)),finishHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}`;

export function installMaterialFinish(view) {
  const renderer=view.renderer, camera=view.camera, scene=view.scene;
  const resolution=new THREE.Vector2();renderer.getDrawingBufferSize(resolution);
  const pass=new GTAOPass(scene,camera,Math.ceil(resolution.x/2),Math.ceil(resolution.y/2),undefined,
    {radius:.14,thickness:.08,distanceExponent:1,distanceFallOff:1,scale:1,samples:8,screenSpaceRadius:false},
    {radius:3,samples:8,rings:2,lumaPhi:8,depthPhi:8,normalPhi:6});
  pass.output=GTAOPass.OUTPUT.Off;
  const shared={ao:{value:pass.gtaoMap},depth:{value:pass.depthTexture},resolution:{value:resolution},near:{value:camera.near},far:{value:camera.far},aoStrength:{value:0},finishEnabled:{value:0}};
  const materials=new Set();scene.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.isMeshStandardMaterial)materials.add(m);});
  for(const m of Object.values(view.materials))if(m?.isMeshStandardMaterial)materials.add(m);
  const changes=[];
  function finishKind(m) {
    if(['mat_brass_hardware','mat_brass_fixed_guide','hall_restrained_brass'].includes(m.name))return 'brass';
    if(['mat_iron_structure','hall_painted_iron','hall_iron_edge_mouldings'].includes(m.name))return 'paint';
    if(m.name==='mat_steel_cable')return 'steel';return null;
  }
  for(const m of materials) {
    const kind=finishKind(m),previousCompile=m.onBeforeCompile,previousKey=m.customProgramCacheKey.bind(m);
    if(kind)changes.push({m,kind,color:m.color.clone(),roughness:m.roughness,metalness:m.metalness});
    m.onBeforeCompile=function(shader,...args) {
      previousCompile.call(this,shader,...args);
      Object.assign(shader.uniforms,{uContactAO:shared.ao,uContactDepth:shared.depth,uContactResolution:shared.resolution,uContactNear:shared.near,uContactFar:shared.far,uContactStrength:shared.aoStrength,uFinishEnabled:shared.finishEnabled});
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vFinishPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nvFinishPosition=transformed;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        varying vec3 vFinishPosition;
        uniform sampler2D uContactAO;uniform sampler2D uContactDepth;
        uniform vec2 uContactResolution;uniform float uContactNear,uContactFar,uContactStrength,uFinishEnabled;
        ${kind?noise:''}`);
      if(kind)shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        float broadFinish=finishNoise(vFinishPosition*32.0)-.5;
        float fineFinish=finishNoise(vFinishPosition*350.0)-.5;
        roughnessFactor=clamp(roughnessFactor+uFinishEnabled*(broadFinish*.03+fineFinish*.015),.16,.9);`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',`#include <aomap_fragment>
        vec2 contactUV=gl_FragCoord.xy/uContactResolution;
        float contactViewZ=perspectiveDepthToViewZ(texture2D(uContactDepth,contactUV).x,uContactNear,uContactFar);
        float contactDepthMatch=1.0-smoothstep(.025,.07,abs(contactViewZ+vViewPosition.z));
        float contactAO=mix(1.0,clamp(texture2D(uContactAO,contactUV).r,.25,1.0),uContactStrength*contactDepthMatch);
        reflectedLight.indirectDiffuse*=contactAO;
        #if defined(USE_ENVMAP) && defined(STANDARD)
          reflectedLight.indirectSpecular*=computeSpecularOcclusion(saturate(dot(geometryNormal,geometryViewDir)),contactAO,material.roughness);
        #endif
        #if defined(USE_CLEARCOAT)
          clearcoatSpecularIndirect*=contactAO;
        #endif
        #if defined(USE_SHEEN)
          sheenSpecularIndirect*=contactAO;
        #endif`);
    };
    m.customProgramCacheKey=()=>previousKey()+'|archive-finish-contact-v1|'+(kind||'base');m.needsUpdate=true;
  }
  const state={metal:false,ao:false,parameters:{radiusM:.14,thicknessM:.08,samples:8,resolutionScale:.5,strength:.7},affectedMaterials:changes.map(c=>({name:c.m.name,kind:c.kind})),set({metal=false,ao=false}) {
    this.metal=metal;this.ao=ao;shared.finishEnabled.value=metal?1:0;shared.aoStrength.value=ao?.7:0;
    for(const c of changes) {
      c.m.color.copy(c.color);c.m.roughness=c.roughness;c.m.metalness=c.metalness;
      if(!metal)continue;
      if(c.kind==='brass') {
        // Conductive brass, with aged rather than freshly polished reflectance.
        c.m.metalness=1;c.m.roughness=c.m.name==='mat_brass_fixed_guide'?.39:.34;
        if(c.m.name==='mat_brass_hardware')c.m.color.setRGB(.57,.365,.145);
      } else if(c.kind==='paint') {
        c.m.metalness=0;c.m.roughness=.51;
        if(c.m.name==='mat_iron_structure')c.m.color.setRGB(.045,.059,.069);
      } else {c.m.metalness=1;c.m.roughness=.3;}
    }
  },render() {
    renderer.getDrawingBufferSize(resolution);
    if(pass.width!==Math.ceil(resolution.x/2)||pass.height!==Math.ceil(resolution.y/2))pass.setSize(Math.ceil(resolution.x/2),Math.ceil(resolution.y/2));
    shared.near.value=camera.near;shared.far.value=camera.far;
    if(this.ao) {
      camera.updateMatrixWorld();scene.updateMatrixWorld();
      const transparent=[];scene.traverse(o=>{if(o.isMesh&&o.visible&&(Array.isArray(o.material)?o.material:[o.material]).some(m=>m.transparent&&m.opacity<.95)){transparent.push(o);o.visible=false;}});
      const oldAuto=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;
      pass.render(renderer,null,null);renderer.shadowMap.autoUpdate=oldAuto;
      for(const o of transparent)o.visible=true;
    }
    renderer.setRenderTarget(null);renderer.render(scene,camera);
  },dispose(){pass.dispose();}};
  state.set({metal:false,ao:false});
  return state;
}
