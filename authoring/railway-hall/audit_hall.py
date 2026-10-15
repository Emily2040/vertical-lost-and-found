import json,struct,hashlib
from pathlib import Path
root=Path(__file__).resolve().parent
p=root/'assets/railway_hall.glb';blob=p.read_bytes()
length,kind=struct.unpack_from('<II',blob,12)
assert kind==0x4E4F534A
g=json.loads(blob[20:20+length])
manifest=json.loads((root/'hall-manifest.json').read_text())
assert manifest['aperture_face_aabb_intersections']==0
assert len(g['meshes'])<=20
wood=next(m for m in g['materials'] if m['name']=='hall_warm_mahogany')
for slot in [wood['pbrMetallicRoughness']['baseColorTexture'],wood['pbrMetallicRoughness']['metallicRoughnessTexture'],wood['normalTexture']]:
    scale=slot.get('extensions',{}).get('KHR_texture_transform',{}).get('scale')
    assert scale==[2,2],scale
assert wood['normalTexture'].get('scale',1)==1
assert all('bufferView' in i for i in g['images'])
glass=next(m for m in g['materials'] if m['name']=='hall_glass_no_opaque_shadow')
assert glass['alphaMode']=='BLEND',glass.get('alphaMode')
assert abs(glass['pbrMetallicRoughness']['baseColorFactor'][3]-.2)<1e-5
for entry in manifest['textures']:
    f=root/entry['path'];assert hashlib.sha256(f.read_bytes()).hexdigest()==entry['sha256']
out={'passed':True,'sha256':hashlib.sha256(blob).hexdigest(),'bytes':len(blob),'meshes':len(g['meshes']),'material_primitives':sum(len(m['primitives']) for m in g['meshes']),'embedded_images':len(g['images']),'nano_lacquer_uv_scale':[2,2],'normal_strength':wood['normalTexture'].get('scale',1),'glass_alpha_mode':glass['alphaMode'],'aperture_face_aabb_intersections':0,'scope':'File structure, authored aperture and material contracts only; not visual or gameplay acceptance.'}
(root/'asset-audit.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
