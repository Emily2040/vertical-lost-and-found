// Authored geometry is measured in the drawer mesh's local Three.js frame.
// Simulation player Z renders at z-.25; drawer origin renders at zExt-.55.
export function localPlayerPoint(d,x,z){return {x:x-d.x,z:z-d.zExt+.30};}
export function supportSurfaces(d){
 const g=d.surfaceGeometry;
 if(!g)return [{id:'legacy',y:d.height/2,minX:-d.width/2,maxX:d.width/2,minZ:-d.depth/2+.30,maxZ:d.depth/2+.30}];
 const out=[{id:'floor',y:g.floorY,minX:-g.floorWidth/2,maxX:g.floorWidth/2,minZ:-g.floorDepth/2,maxZ:g.floorDepth/2}];
 if(g.pan){const p=g.pan;out.push({id:'pan',y:p.topY-(d.panDisplacementM||0),minX:p.x-p.width/2,maxX:p.x+p.width/2,minZ:p.z-p.depth/2,maxZ:p.z+p.depth/2});}
 if(g.rimY!==undefined){
  out.push({id:'rim-left',y:g.rimY,minX:-.782,maxX:-.7035,minZ:-1.02,maxZ:1.02},{id:'rim-right',y:g.rimY,minX:.7035,maxX:.782,minZ:-1.02,maxZ:1.02},{id:'rim-front',y:g.rimY,minX:-.782,maxX:.782,minZ:.9785,maxZ:1.0715},{id:'rim-back',y:g.rimY,minX:-.782,maxX:.782,minZ:-1.0715,maxZ:-.9785});
 }
 return out.sort((a,b)=>b.y-a.y);
}
export function surfaceAt(d,x,z){const p=localPlayerPoint(d,x,z);return supportSurfaces(d).find(s=>p.x>=s.minX&&p.x<=s.maxX&&p.z>=s.minZ&&p.z<=s.maxZ)||null;}
export function supportTop(d,x=d.x,z=d.zExt+.3){const s=surfaceAt(d,x,z);return d.y+(s?.y??d.surfaceGeometry?.floorY??d.height/2);}
// Minimum projection of the actual mesh support hull after the rendered Z roll.
// Keeping this in the solver prevents a rotated parcel from sinking into its tray.
export function payloadSupportProjection(p,n={x:0,y:1,z:0}){
 const angle=-(p.rollAngle||0),c=Math.cos(angle),s=Math.sin(angle);
 if(!p.supportHull?.length)return (p.geometryBottomY??0)*n.y;
 let minimum=Infinity;
 for(const [x,y,z] of p.supportHull)minimum=Math.min(minimum,n.x*(c*x-s*y)+n.y*(s*x+c*y)+n.z*z);
 return minimum;
}
export function chuteFrame(c){
 const dx=c.exitX-c.entryX,dy=c.exitY-c.entryY,dz=c.exitZ-c.entryZ,length=Math.hypot(dx,dy,dz),horizontal=Math.hypot(dx,dz);
 return {length,horizontal,t:{x:dx/length,y:dy/length,z:dz/length},n:{x:-dy*dx/(length*horizontal),y:horizontal/length,z:-dy*dz/(length*horizontal)},side:{x:-dz/horizontal,y:0,z:dx/horizontal}};
}
export function payloadChutePose(p,c,u){
 const {n,side}=chuteFrame(c),lane=c.payloadLanes?.[p.id]??0;
 const x=c.entryX+(c.exitX-c.entryX)*u+side.x*lane,z=c.entryZ+(c.exitZ-c.entryZ)*u+side.z*lane;
 const y=c.entryY+(c.exitY-c.entryY)*u-payloadSupportProjection(p,n)/n.y;
 return {x,y,z};
}
export function payloadRestPose(sim,p,d){
 const g=d.surfaceGeometry,pan=g?.pan;
 let localX=0,localZ=-.45,surfaceY=d.y+(g?.floorY??d.height/2);
 if(pan){localX=pan.x;localZ=pan.z;surfaceY=d.y+pan.topY-(d.panDisplacementM||0);}
 else if(d.id==='drawer_s2_ledge')localZ=({payload_carpet_02:-.72,payload_instruments_05:-.20,payload_trunk_01:.28})[p.id]??-.45;
 else if(d.id==='drawer_s2_counter')localZ=p.id==='payload_carpet_02'?-.35:.20;
 else if(d.id==='cage_s3_east'){localX=p.id==='payload_umbrella_04'?-.30:.30;localZ=0;}
 else if(d.id==='cage_s3_west'||d.id==='receiving_tray_01')localZ=0;
 else if(d.id==='drawer_s3_a')localX=p.id==='payload_umbrella_04'?-.28:.28;
 const slot=d.payloadSlots?.[p.id];if(slot){localX=slot.x;localZ=slot.z;}
 const tilt=d.tiltRad||0,n={x:0,y:Math.cos(tilt),z:Math.sin(tilt)};
 if(tilt)surfaceY=d.y+(g?.floorY??d.height/2)/n.y-localZ*Math.tan(tilt);
 const baseOffset=payloadSupportProjection(p,n)/n.y;
 return {x:d.x+localX,y:surfaceY-baseOffset,z:d.zExt-.20+localZ};
}
export function playerPanLoad(sim,d){
 const p=sim.player;if(!p.grounded||p.supportId!==d.id)return 0;
 const s=surfaceAt(d,p.x,p.z);if(s?.id!=='pan')return 0;
 return sim.contract.simulation.player_mass_kg+(p.carriedPayloadId?sim.payloads[p.carriedPayloadId].massKg:0);
}
