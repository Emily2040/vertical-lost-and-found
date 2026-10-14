import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Actual geometry behind the earned doorway. Floor top is world Y14.5. */
export function buildRooftopGarden(view){
  const old=view.scene.getObjectByName('garden_terrace_01');if(old)view.scene.remove(old);
  const group=new THREE.Group();group.name='garden_terrace_01';group.position.y=14.5;
  view.gardenGroup=group;const batches=new Map();
  const material=(name,c,roughness=.8,metalness=0)=>new THREE.MeshStandardMaterial({name,color:c,roughness,metalness});
  const stone=material('garden_cut_limestone',0xa29473,.86),soil=material('garden_dark_soil',0x211b12,.98),
    iron=material('garden_painted_iron',0x2d493c,.48),wood=material('garden_weathered_oak',0x655037,.77),
    terracotta=material('garden_terracotta',0x945c39,.88),bark=material('garden_bark',0x534b35,.96),
    brass=material('garden_brass',0x8a7953,.4,.75);
  const add=(g,m,matrix)=>{if(matrix)g.applyMatrix4(matrix);if(!batches.has(m))batches.set(m,[]);batches.get(m).push(g);};
  const tr=(x,y,z,sx=1,sy=1,sz=1)=>new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion(),new THREE.Vector3(sx,sy,sz));
  const box=(w,h,d,x,y,z,m)=>add(new THREE.BoxGeometry(w,h,d),m,tr(x,y,z));
  const rod=(a,b,r,m)=>{a=new THREE.Vector3(...a);b=new THREE.Vector3(...b);const d=b.clone().sub(a);const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize());add(new THREE.CylinderGeometry(r*.8,r,d.length(),8),m,new THREE.Matrix4().compose(a.add(b).multiplyScalar(.5),q,new THREE.Vector3(1,1,1)));};
  let seed=901;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  // Continuous entrance, narrow path and raised beds. The walkway remains clear.
  box(2.65,.16,3.8,0,-.08,-1.25,stone);
  for(let x=-3.6;x<3.6;x+=.60)for(let z=-8.8;z<-2.0;z+=.60)box(.587,.14,.587,x+.3,-.07,z+.3,stone);
  // The terrace has a visible stone foundation, rather than sky below its slab.
  // It is behind the complete aperture and does not obstruct the y14.5 entrance.
  box(7.25,1.80,.34,0,-.90,-3.28,stone);
  // Low rear parapet grounds the bench; the upper glazing still admits daylight.
  for(let row=0;row<4;row++)for(let i=0;i<12;i++){
    const x=-3.6+(i+.5)*.60;
    box(.588,.278,.27,x,.14+row*.29,-8.73,stone);
  }
  box(7.38,.12,.39,0,1.20,-8.73,stone);
  for(const x of [-3.6,-1.8,0,1.8,3.6])rod([x,1.25,-8.70],[x,3.0,-8.70],.032,iron);
  for(const y of [1.25,2.12,3.0])rod([-3.6,y,-8.70],[3.6,y,-8.70],.029,iron);
  for(const side of [-1,1])for(const z of [-3.5,-6.4]){
    box(1.55,.44,2.35,side*2.4,.22,z,terracotta);
    box(1.39,.045,2.18,side*2.4,.45,z,soil);
    for(const edge of [-1,1])box(.10,.12,2.48,side*2.4+edge*.79,.49,z,stone);
    for(const edge of [-1,1])box(1.68,.12,.10,side*2.4,.49,z+edge*1.19,stone);
  }
  // Leaf mesh has a central crease and bent tip, rather than billboard foliage.
  const leafGeo=new THREE.BufferGeometry();
  leafGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,-.24,.38,.03,-.16,.76,.04,0,1,.10,.16,.76,.04,.24,.38,.03,0,.42,-.07],3));
  leafGeo.setIndex([0,1,6,1,2,6,2,3,6,3,4,6,4,5,6,5,0,6]);leafGeo.computeVertexNormals();
  const leafMat=new THREE.MeshPhysicalMaterial({name:'garden_living_leaves',color:0x5b7735,roughness:.67,side:THREE.DoubleSide,sheen:.25,sheenRoughness:.9,sheenColor:0x819346});
  const leaves=[];
  const leaf=(p,length,angle,tilt,color)=>{const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt,angle,rand()*.7-.35));leaves.push({matrix:new THREE.Matrix4().compose(new THREE.Vector3(...p),q,new THREE.Vector3(length*.65,length,length)),color});};
  // Ferns have a visible central rachis and paired pinnae, in several scales.
  for(const side of [-1,1])for(const zc of [-2.7,-4.1,-5.9,-7.2])for(let plant=0;plant<4;plant++){
    const root=new THREE.Vector3(side*(1.85+rand()*.85),.48,zc+(rand()-.5)*.85);
    for(let frond=0;frond<7;frond++){
      const ang=rand()*Math.PI*2,len=.65+rand()*.8;let previous=root.clone();
      for(let k=1;k<=10;k++){
        const t=k/10,p=root.clone().add(new THREE.Vector3(Math.cos(ang)*len*t,.8*Math.sin(t*Math.PI*.75),Math.sin(ang)*len*t));
        rod(previous.toArray(),p.toArray(),.008,iron);previous=p;
        for(const s of [-1,1])leaf(p.toArray(),(.10+.25*Math.sin(t*Math.PI))*len,ang+s*1.15,1.0,new THREE.Color().setHSL(.22+rand()*.07,.4,.22+rand()*.13));
      }
    }
  }
  // Two small fruit trees frame the destination without blocking the entrance.
  for(const [tx,tz] of [[-2.45,-6.8],[2.55,-5.4]]){
    rod([tx,.45,tz],[tx+.15,2.6,tz],.075,bark);
    for(let branch=0;branch<14;branch++){
      const a=branch*2.399,baseY=1.45+rand()*1.1,reach=.45+rand()*.7;
      const tip=[tx+Math.cos(a)*reach,baseY+.4+rand()*.45,tz+Math.sin(a)*reach];
      rod([tx+.1,baseY,tz],tip,.022,bark);
      for(let j=0;j<45;j++){
        const b=rand()*Math.PI*2,r=Math.sqrt(rand())*.60;
        leaf([tip[0]+Math.cos(b)*r,tip[1]+(rand()-.5)*.7,tip[2]+Math.sin(b)*r],.15+rand()*.17,rand()*Math.PI*2,rand()*2.2-.7,new THREE.Color().setHSL(.22+rand()*.08,.35+rand()*.25,.18+rand()*.15));
      }
    }
  }
  const inst=new THREE.InstancedMesh(leafGeo,leafMat,leaves.length);inst.name='garden_individual_creased_leaves';
  leaves.forEach((l,i)=>{inst.setMatrixAt(i,l.matrix);inst.setColorAt(i,l.color);});inst.castShadow=true;inst.receiveShadow=true;group.add(inst);
  // Conservatory ribs and glazing keep daylight visible through the real doorway.
  const glassMat=new THREE.MeshStandardMaterial({name:'garden_glazing',color:0xe0e8db,transparent:true,opacity:.15,roughness:.32,side:THREE.DoubleSide,depthWrite:false});
  const rearGlazing=new THREE.Mesh(new THREE.PlaneGeometry(7.16,1.70),glassMat);rearGlazing.name='garden_rear_glass_no_shadow';rearGlazing.position.set(0,2.12,-8.76);group.add(rearGlazing);
  const roofVertices=[],roofIndices=[];
  for(const z of [-1.7,-4.0,-6.3,-8.6]){
    for(const x of [-3.65,3.65]){rod([x,0,z],[x,2.85,z],.045,iron);box(.22,.10,.22,x,.06,z,brass);}
    const pts=[];for(let i=0;i<=32;i++){const a=i*Math.PI/32;pts.push(new THREE.Vector3(3.65*Math.cos(a),2.85+2.35*Math.sin(a),z));}
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),32,.045,6,false),iron);
  }
  for(let j=0;j<=14;j++){const a=j*Math.PI/14;rod([3.65*Math.cos(a),2.85+2.35*Math.sin(a),-1.7],[3.65*Math.cos(a),2.85+2.35*Math.sin(a),-8.6],.023,iron);}
  for(let j=0;j<14;j++)for(let k=0;k<6;k++){
    const n=roofVertices.length/3;for(const [a,z] of [[j*Math.PI/14,-1.7-k*1.15],[(j+1)*Math.PI/14,-1.7-k*1.15],[(j+1)*Math.PI/14,-2.85-k*1.15],[j*Math.PI/14,-2.85-k*1.15]])roofVertices.push(3.65*Math.cos(a),2.85+2.35*Math.sin(a),z);
    roofIndices.push(n,n+1,n+2,n,n+2,n+3);
  }
  const roofGeo=new THREE.BufferGeometry();roofGeo.setAttribute('position',new THREE.Float32BufferAttribute(roofVertices,3));roofGeo.setIndex(roofIndices);roofGeo.computeVertexNormals();
  const roof=new THREE.Mesh(roofGeo,glassMat);roof.name='garden_glass_no_shadow';group.add(roof);
  // An old slatted bench gives the garden a human scale and a clear destination.
  for(let i=0;i<7;i++)box(2.15,.045,.105,0,.57,-7.65+i*.115,wood);
  for(let i=0;i<5;i++)box(2.15,.10,.045,0,.75+i*.13,-7.75,wood);
  for(const x of [-.82,.82]){rod([x,0,-7.6],[x,.6,-7.6],.035,iron);rod([x,0,-7.0],[x,.6,-7.0],.035,iron);rod([x,.45,-7.6],[x,1.35,-7.8],.025,iron);}
  for(const [m,geos] of batches){const mesh=new THREE.Mesh(mergeGeometries(geos,false),m);mesh.name=m.name;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);geos.forEach(g=>g.dispose());}
  view.scene.add(group);
  view.gardenLight.position.set(1.5,20.5,-5.5);view.gardenLight.target.position.set(0,15.2,1.6);
  const sun=new THREE.DirectionalLight(0xffd79a,.2);sun.name='earned_garden_sun';sun.position.set(1,21,-7);sun.target.position.set(0,14.8,1);
  sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-6,right:6,top:7,bottom:-5,near:1,far:22});sun.shadow.bias=-.0001;sun.shadow.normalBias=.02;
  view.scene.add(sun,sun.target);view.gardenRevealSun=sun;
  return group;
}

export function syncRooftopGarden(view,sim){
  if(view.gardenRevealSun)view.gardenRevealSun.intensity=.15+2.8*(sim.gardenLightFactor||0);
}
