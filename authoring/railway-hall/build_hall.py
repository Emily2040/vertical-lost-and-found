"""Portable architectural complement for Vertical Lost & Found.
All geometry is authored in runtime metres, converted to Blender Z-up for export.
Textures in this file are procedural supplements, NOT Nano Banana outputs.
"""
import bpy, bmesh, math, json, hashlib, random, sys
from pathlib import Path
from mathutils import Vector
import numpy as np

ROOT=Path(__file__).resolve().parent
DOCK_DATA=json.loads((ROOT/'runtime-docks.json').read_text()) if (ROOT/'runtime-docks.json').exists() else {'drawers':[]}
DOCKS=[dict(d,xmin=d['x']-.94,xmax=d['x']+.94,ymin=d['floorMin']-.14,ymax=d['floorMax']+.58) for d in DOCK_DATA['drawers']]
OUT=ROOT/'assets'; OUT.mkdir(exist_ok=True)
TEX=OUT/'textures'; TEX.mkdir(exist_ok=True)
random.seed(1202)
bpy.ops.wm.read_factory_settings(use_empty=True)
BUCKETS={}; MATERIALS={}; BOX_CACHE={}

def material(name, color, roughness=.5, metallic=0, emission=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=roughness
    p.inputs['Metallic'].default_value=metallic
    if emission:
        p.inputs['Emission Color'].default_value=(*color,1)
        p.inputs['Emission Strength'].default_value=emission
    MATERIALS[name]=m;return m

def generated_texture(name, base, kind='stone'):
    # Low-amplitude colour and roughness variation; no inferred geometry from brightness.
    n=1024;rng=np.random.default_rng(391)
    y,x=np.mgrid[0:n,0:n]/n
    if kind=='wood':
        field=.028*np.sin(x*1100+np.sin(y*27)*3)+.012*np.sin(x*2400+np.sin(y*65)*5)
        field+=.03*np.sin(x*100+np.sin(y*5)*4)+rng.normal(0,.012,(n,n))
    elif kind=='paint':
        field=.012*np.sin(x*32)*np.sin(y*39)+rng.normal(0,.009,(n,n))
    else:
        field=.022*np.sin(x*45)*np.sin(y*39)+.014*np.sin(x*191+y*54)+rng.normal(0,.016,(n,n))
    rgb=np.clip(np.array(base)[None,None,:]*(1+field[:,:,None]),0,1)
    a=np.ones((n,n,4),dtype=np.float32);a[:,:,:3]=rgb
    im=bpy.data.images.new(name,width=n,height=n,alpha=False);im.pixels.foreach_set(a.ravel())
    im.filepath_raw=str(TEX/(name+'.png'));im.file_format='PNG';im.save();im.pack()
    return im

def textured(name, base, roughness, kind='stone'):
    m=material(name,base,roughness)
    im=generated_texture(name+'_colour',base,kind)
    t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=im
    p=m.node_tree.nodes.get('Principled BSDF');m.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
    return m

iron=textured('hall_painted_iron',(.105,.145,.153),.48,'paint')
trim=material('hall_iron_edge_mouldings',(.16,.205,.213),.43)
stone=textured('hall_warm_limestone',(.36,.342,.30),.83)
brick=textured('hall_recessed_brick',(.26,.225,.19),.88)
wood=textured('hall_warm_mahogany',(.19,.068,.042),.40,'wood')
inset=material('hall_wood_recess',(.09,.027,.018),.51)
brass=material('hall_restrained_brass',(.43,.29,.12),.32,.84)
black=material('hall_deep_recess',(.016,.022,.022),.92)
floor=[textured('hall_floor_'+str(i),(.29+i*.013,.285+i*.012,.262+i*.011),.62+i*.018) for i in range(3)]
glass=material('hall_glass_no_opaque_shadow',(.64,.76,.81),.3,0,.70)
glass.diffuse_color=(.64,.76,.81,.20)
glass.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=.20
glass.surface_render_method='DITHERED'

def optional_nano_lacquer():
    """Consume a copied local production family; never depend on the generator cache."""
    family=TEX/'nano_lacquer'
    paths={k:family/('handled_lacquer_'+k+'.png') for k in ['basecolor','roughness','metalness','normal']}
    if not all(p.exists() for p in paths.values()):return False
    nodes=wood.node_tree.nodes;links=wood.node_tree.links;p=nodes.get('Principled BSDF')
    uv=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeMapping');mapping.inputs['Scale'].default_value=(2,2,2)
    links.new(uv.outputs['UV'],mapping.inputs['Vector'])
    for channel,path in paths.items():
        im=bpy.data.images.load(str(path));im.colorspace_settings.name='sRGB' if channel=='basecolor' else 'Non-Color';im.pack()
        t=nodes.new('ShaderNodeTexImage');t.image=im;links.new(mapping.outputs['Vector'],t.inputs['Vector'])
        if channel=='normal':
            normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=1.0
            links.new(t.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],p.inputs['Normal'])
        else:links.new(t.outputs['Color'],p.inputs[{'basecolor':'Base Color','roughness':'Roughness','metalness':'Metallic'}[channel]])
    wood['family']='mat_handled_lacquer';wood['physical_tile_width_m']=.5
    return True

NANO_LACQUER=optional_nano_lacquer()

def add(name,verts,faces,smooth=False,uvscale=1):
    b=BUCKETS.setdefault(name,{'v':[],'f':[],'smooth':[],'uv':[]})
    offset=len(b['v']);b['v'].extend(verts)
    for face in faces:
        b['f'].append(tuple(offset+i for i in face));b['smooth'].append(smooth)
        v0=Vector(verts[face[0]]);v1=Vector(verts[face[1]]);v2=Vector(verts[face[2]])
        normal=(v1-v0).cross(v2-v0);axis=max(range(3),key=lambda i:abs(normal[i]))
        axes=((2,1),(0,2),(0,1))[axis]
        b['uv'].append([(verts[j][axes[0]]*uvscale,verts[j][axes[1]]*uvscale) for j in face])

def box(name,p,size,bevel=0):
    key=tuple(size)+(bevel,)
    if key not in BOX_CACHE:
        bm=bmesh.new();bmesh.ops.create_cube(bm,size=1)
        for v in bm.verts:
            v.co.x*=size[0];v.co.y*=size[1];v.co.z*=size[2]
        if bevel:bmesh.ops.bevel(bm,geom=list(bm.edges),offset=min(bevel,min(size)*.35),segments=2,affect='EDGES')
        bm.verts.ensure_lookup_table();bm.verts.index_update()
        BOX_CACHE[key]=([tuple(v.co) for v in bm.verts],[tuple(v.index for v in f.verts) for f in bm.faces]);bm.free()
    v,f=BOX_CACHE[key];add(name,[(a+p[0],b+p[1],c+p[2]) for a,b,c in v],f)

def dock_box(name,p,size,bevel=0):
    """Split a dock return around the final garden portal, preserving headroom."""
    x0,x1=p[0]-size[0]/2,p[0]+size[0]/2;y0,y1=p[1]-size[1]/2,p[1]+size[1]/2
    xx=sorted(set([x0,x1]+[x for x in [-1.4,1.4] if x0<x<x1]));yy=sorted(set([y0,y1]+[y for y in [12.8,16.8] if y0<y<y1]))
    for xa,xb in zip(xx[:-1],xx[1:]):
        for ya,yb in zip(yy[:-1],yy[1:]):
            cx=(xa+xb)/2;cy=(ya+yb)/2
            if -1.4<cx<1.4 and 12.8<cy<16.8:continue
            box(name,(cx,cy,p[2]),(xb-xa,yb-ya,size[2]),bevel)

def cylinder(name,p,r,height,segments=24,axis='y'):
    v=[]
    for y in [-height/2,height/2]:
        for k in range(segments):
            t=2*math.pi*k/segments;pt=[r*math.cos(t),y,r*math.sin(t)]
            if axis=='z':pt=[pt[0],pt[2],pt[1]]
            if axis=='x':pt=[pt[1],pt[0],pt[2]]
            v.append(tuple(pt[i]+p[i] for i in range(3)))
    f=[tuple(range(segments-1,-1,-1)),tuple(range(segments,segments*2))]
    f.extend((i,(i+1)%segments,(i+1)%segments+segments,i+segments) for i in range(segments))
    add(name,v,f,True)

def lathe(name,x,z,profile):
    n=32;v=[(x+r*math.cos(k*2*math.pi/n),y,z+r*math.sin(k*2*math.pi/n)) for r,y in profile for k in range(n)]
    f=[(j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k) for j in range(len(profile)-1) for k in range(n)]
    add(name,v,f,True)

def arch(name,centre,radius,depth=.16,width=.12,start=0,end=math.pi,steps=48,plane='wall',ellipse=1):
    # Rectangular ring section has real thickness and explicit fronts/sides.
    v=[]
    for i in range(steps+1):
        a=start+(end-start)*i/steps
        for rad,d in [(radius-width/2,-depth/2),(radius+width/2,-depth/2),(radius+width/2,depth/2),(radius-width/2,depth/2)]:
            if plane=='wall':p=(centre[0]+rad*math.cos(a),centre[1]+rad*math.sin(a)*ellipse,centre[2]+d)
            else:p=(centre[0]+d,centre[1]+rad*math.sin(a)*ellipse,centre[2]+rad*math.cos(a))
            v.append(p)
    f=[]
    for i in range(steps):
        for q in range(4):f.append((4*i+q,4*i+(q+1)%4,4*(i+1)+(q+1)%4,4*(i+1)+q))
    f.extend([(0,3,2,1),(4*steps,4*steps+1,4*steps+2,4*steps+3)])
    add(name,v,f)

def rod(name,a,b,r=.025,segments=8):
    a=Vector(a);b=Vector(b);d=(b-a).normalized();u=d.cross(Vector((0,1,0)))
    if u.length<.01:u=d.cross(Vector((1,0,0)))
    u.normalize();v=d.cross(u);verts=[]
    for c in (a,b):
        for k in range(segments):
            p=c+r*(u*math.cos(2*math.pi*k/segments)+v*math.sin(2*math.pi*k/segments));verts.append(tuple(p))
    faces=[(i,(i+1)%segments,(i+1)%segments+segments,i+segments) for i in range(segments)]
    add(name,verts,faces,True)

def column(x,z,top=18.2):
    box(iron.name,(x,.18,z),(.84,.36,.80),.035)
    profile=[(.40,.33),(.40,.45),(.34,.48),(.34,.64),(.28,.70),(.26,.88),(.23,1.1),(.22,top-1.1),(.25,top-.95),(.25,top-.78),(.29,top-.70),(.34,top-.5),(.39,top-.36),(.39,top-.22)]
    lathe(iron.name,x,z,profile)
    for y in [.92,5.1,10.1,top-.9]:cylinder(trim.name,(x,y,z),.25,.065)
    box(iron.name,(x,top-.12,z),(.85,.24,.77),.025)
    # Cast flutes and a capital with small load-bearing brackets.
    for k in range(8):
        a=k*math.pi/4;rod(trim.name,(x+.224*math.cos(a),1.25,z+.224*math.sin(a)),(x+.224*math.cos(a),top-1.15,z+.224*math.sin(a)),.016)
    for s in [-1,1]:
        rod(iron.name,(x+s*.20,top-.9,z),(x+s*.60,top-.18,z),.045)

# Floor: individual bevelled slabs, a darker perimeter course, narrow metal track inlays.
for ix,x in enumerate(np.arange(-15,15,1.5)):
    for iz,z in enumerate(np.arange(-3,18,1.5)):
        box(floor[(ix*11+iz*7)%3].name,(float(x+.75),-.08,float(z+.75)),(1.486,.16,1.486),.009)
for z in [3.6,5.2]:box(brass.name,(0,.006,z),(30,.015,.025),.004)
for x in [-12.7,12.7]:box(black.name,(x,.004,7.5),(.07,.012,21))

# Solid archive backing leaves the garden's full clear aperture.
box(black.name,(0,6.4,-2.35),(26,12.8,.35))
for s in [-1,1]:box(black.name,(s*7.2,15.5,-2.35),(11.6,5.4,.35))
box(black.name,(0,17.5,-2.35),(2.8,1.4,.35))

# Deep cabinet bays, recessed panel mouldings and physically small brass pulls.
for j,x in enumerate(np.arange(-11.7,12,1.8)):
    stile_x=float(x-.87)
    exclusions=[(d['ymin']-.06,d['ymax']+.06) for d in DOCKS if d['xmin']-.05<stile_x<d['xmax']+.05]
    if abs(stile_x)<1.45:exclusions.append((12.8,16.8))
    intervals=[(0,17.6)]
    for lo,hi in exclusions:
        next_intervals=[]
        for a,b in intervals:
            if hi<=a or lo>=b:next_intervals.append((a,b))
            else:
                if a<lo:next_intervals.append((a,lo))
                if hi<b:next_intervals.append((hi,b))
        intervals=next_intervals
    for a,b in intervals:
        if b-a>.02:box(wood.name,(stile_x,(a+b)/2,-1.12),(.10,b-a,.34),.012)
    for k,y in enumerate(np.arange(.57,17.5,.84)):
        if abs(x)<1.7 and 12.35<y<17.15:continue
        if any(x+.84>d['xmin'] and x-.84<d['xmax'] and y+.39>d['ymin'] and y-.39<d['ymax'] for d in DOCKS):continue
        x=float(x);y=float(y)
        box(wood.name,(x,y,-1.17),(1.66,.76,.23),.012)
        box(inset.name,(x,y,-1.042),(1.43,.55,.02),.006)
        # Four proud perimeter mouldings, with visible corner thickness.
        for sy in [-1,1]:box(wood.name,(x,y+sy*.32,-1.005),(1.55,.055,.065),.008)
        for sx in [-1,1]:box(wood.name,(x+sx*.75,y,-1.005),(.055,.60,.065),.008)
        # Exact blank label frame; no generated pseudo-text on background fronts.
        for sy in [-1,1]:box(brass.name,(x,y+.11+sy*.043,-.958),(.18,.009,.016),.002)
        for sx in [-1,1]:box(brass.name,(x+sx*.085,y+.11,-.958),(.009,.085,.016),.002)
        box(black.name,(x,y+.11,-.972),(.16,.07,.006))
        rod(brass.name,(x-.12,y-.12,-.93),(x+.12,y-.12,-.93),.012)
        for sx in [-1,1]:rod(brass.name,(x+sx*.12,y-.12,-.93),(x+sx*.12,y-.09,-.975),.010)

# Arcaded iron frame extends beyond the playable storage wall and supports roof.
xs=[-12.6,-9,-5.4,-1.8,1.8,5.4,9,12.6]
for x in xs:
    column(x,-2.8 if abs(x)<8 else -1.12)
    if abs(x)<8:box(iron.name,(x,18.15,-1.95),(.34,.30,1.8),.02)
# Dark structural returns expose actual empty dock volume behind each moving drawer.
for d in DOCKS:
    h=d['ymax']-d['ymin'];cy=(d['ymin']+d['ymax'])/2
    for sx in [-1,1]:
        dock_box(iron.name,(d['x']+sx*.99,cy,-1.6),(.08,h+.16,1.0),.012)
        dock_box(trim.name,(d['x']+sx*.99,cy,-1.04),(.10,h+.16,.10),.008)
    for y in [d['ymin']-.04,d['ymax']+.04]:dock_box(iron.name,(d['x'],y,-1.6),(2.05,.08,1.0),.012)
for a,b in zip(xs[:-1],xs[1:]):
    c=(a+b)/2
    arch_spring=16.60 if abs(c)<.1 else 16.1
    for radius,width,depth in [(1.8,.16,.28),(1.60,.065,.32),(1.46,.035,.28)]:arch(iron.name,(c,arch_spring,-.90),radius,depth,width)
    # Cast rosette spandrels, confined above all footholds and outside garden.
    for sx in [-1,1]:
        cx=c+sx*1.22;cy=17.55
        arch(trim.name,(cx,cy,-.72),.24,.065,.028,0,math.tau,32)
        for k in range(6):
            t=k*math.pi/3;rod(trim.name,(cx,cy,-.72),(cx+.19*math.cos(t),cy+.19*math.sin(t),-.72),.012)
    for k in range(12):
        t=math.pi*(k+.5)/12;px=c+1.70*math.cos(t);py=16.1+1.70*math.sin(t)
        cylinder(brass.name,(px,py,-.70),.018,.018,12,'z')
for y,w,d in [(17.95,.12,.46),(18.15,.18,.64),(18.36,.09,.73)]:box(iron.name,(0,y,-.98),(26.4,w,d),.015)
for x in np.arange(-12.7,12.8,.25):box(trim.name,(float(x),18.0,-.59),(.09,.16,.10),.006)

# Side elevations: ashlar base, brick recessed bays, slender columns and glazed clerestory.
for side in [-1,1]:
    sx=side*13.9
    for z in [-1.2,3.6,8.4,13.2,18.0]:column(sx,z)
    for zc in [1.2,6.0,10.8,15.6]:
        box(brick.name,(side*14.12,4.2,zc),(.32,8.4,4.65),.02)
        # Ashlar joint lines are modelled shallow recess strips, not a flat blank wall.
        for y in np.arange(.6,8.2,.55):box(black.name,(side*13.945,float(y),zc),(.012,.014,4.50))
        for yi,y in enumerate(np.arange(.3,8.1,.55)):
            for dz in np.arange(-1.8+(yi%2)*.42,2.3,.84):box(black.name,(side*13.94,float(y),zc+float(dz)),(.015,.53,.012))
        for y in [.26,.67,8.35,8.52]:box(stone.name,(side*13.78,y,zc),(.48,.12,4.6),.02)
        # High window supports an arch, individual panes and mullion shadows.
        for j in range(8):
            zz=zc-2.1+j*.6
            for k in range(13):
                yy=9.0+k*.62
                box(glass.name,(side*13.98,yy,zz),(.022,.59,.56))
        for dz in np.arange(-2.4,2.5,.6):box(iron.name,(side*13.85,12.71,zc+float(dz)),(.12,8.4,.055),.006)
        for y in np.arange(8.7,17.1,.62):box(iron.name,(side*13.84,float(y),zc),(.12,.045,4.75),.005)
        # Arch in side plane (barrel mode uses YZ), and two smaller concentric rims.
        for r,w in [(2.4,.18),(2.17,.07)]:arch(iron.name,(sx,8.4,zc),r,.32,w,plane='barrel',ellipse=.85)

# Continuous barrel vault: elliptical section, structural I-ribs and fine mullion grid.
zcentre=6.45;radius=8.05;spring=18.3;rise=.78
for x in np.arange(-14,14.01,3.5):
    for rr,w,d in [(radius,.22,.10),(radius-.20,.065,.34),(radius+.02,.065,.34)]:
        arch(iron.name,(float(x),spring,zcentre),rr,d,w,plane='barrel',ellipse=rise,steps=64)
    # Iron diagonal lace within each rib's visible depth, not generic tube arches.
    for j in range(32):
        t=(j+.5)*math.pi/32
        p=(float(x),spring+(radius-.1)*math.sin(t)*rise,zcentre+(radius-.1)*math.cos(t))
        cylinder(trim.name,p,.035,.35,12,'x')
for x in np.arange(-14,14.01,28/24):
    arch(trim.name,(float(x),spring,zcentre),radius+.07,.037,.038,plane='barrel',ellipse=rise,steps=64)
for j in range(25):
    t=j*math.pi/24
    box(trim.name,(0,spring+(radius+.07)*math.sin(t)*rise,zcentre+(radius+.07)*math.cos(t)),(28.1,.042,.042),.004)
# Pane surfaces follow the actual vault, no image sky plate. Export no-shadow glass role.
verts=[];faces=[]
for i in range(24):
    xa=-14+i*(28/24);xb=xa+(28/24)
    for j in range(24):
        aa=j*math.pi/24+.002;bb=(j+1)*math.pi/24-.002;n=len(verts)
        for xx,a in [(xa+.018,aa),(xb-.018,aa),(xb-.018,bb),(xa+.018,bb)]:
            verts.append((xx,spring+(radius+.10)*math.sin(a)*rise,zcentre+(radius+.10)*math.cos(a)))
        faces.append((n,n+1,n+2,n+3))
add(glass.name,verts,faces)
# Complete the two curved gable ends: the roof is supported and enclosed rather
# than floating above rectangular windows with an unbuilt triangular void.
for side in [-1,1]:
    xx=side*13.96
    for j in range(32):
        za=zcentre-radius+j*(2*radius/32)+.025
        zb=zcentre-radius+(j+1)*(2*radius/32)-.025
        maxa=spring+math.sqrt(max(0,radius*radius-(za-zcentre)**2))*rise
        maxb=spring+math.sqrt(max(0,radius*radius-(zb-zcentre)**2))*rise
        for ya in np.arange(17.0,24.8,.62):
            yb=ya+.585
            if ya>min(maxa,maxb)-.04:continue
            add(glass.name,[(xx,float(ya),za),(xx,float(ya),zb),(xx,min(float(yb),maxb-.04),zb),(xx,min(float(yb),maxa-.04),za)],[(0,1,2,3)])
        rod(iron.name,(xx-side*.08,17.0,za),(xx-side*.08,maxa-.01,za),.025)
    for yy in np.arange(17.0,24.8,.62):
        half=radius*math.sqrt(max(0,1-((yy-spring)/(radius*rise))**2))
        if half>.1:rod(iron.name,(xx-side*.08,float(yy),zcentre-half),(xx-side*.08,float(yy),zcentre+half),.023)
    box(iron.name,(xx,17.16,zcentre),(.35,.22,16.4),.025)
    arch(iron.name,(xx,18.3,zcentre),radius,.32,.18,plane='barrel',ellipse=rise,steps=64)
    # Cast radial fanlight gives the glazed gable a railway-station identity.
    rose=(xx-side*.18,20.9,zcentre)
    for rr,ww in [(2.22,.075),(2.07,.035),(.48,.055),(.30,.025)]:arch(iron.name,rose,rr,.10,ww,0,math.tau,64,plane='barrel')
    for k in range(12):
        a=k*math.tau/12
        rod(iron.name,(rose[0],rose[1]+.48*math.sin(a),rose[2]+.48*math.cos(a)),(rose[0],rose[1]+2.07*math.sin(a),rose[2]+2.07*math.cos(a)),.025)
        c=(rose[0],rose[1]+1.40*math.sin(a),rose[2]+1.40*math.cos(a))
        arch(trim.name,c,.35,.07,.020,0,math.tau,24,plane='barrel')

# Opposite longitudinal elevation supports the other spring line of the vault.
for x in xs:column(x,14.45)
for a,b in zip(xs[:-1],xs[1:]):
    c=(a+b)/2
    box(brick.name,(c,4.2,14.70),(3.46,8.4,.32),.025)
    for y in np.arange(.6,8.2,.55):box(black.name,(c,float(y),14.527),(3.43,.015,.014))
    for y in [8.35,8.55,17.95]:box(iron.name,(c,y,14.40),(3.65,.18,.35),.02)
    for j in range(6):
        for k in range(15):box(glass.name,(a+.30+j*.6,8.95+k*.60,14.58),(.56,.56,.025))
    for x in np.arange(a,b+.01,.6):box(iron.name,(float(x),13.2,14.47),(.04,9.1,.09),.005)
    for y in np.arange(8.65,17.8,.6):box(iron.name,(c,float(y),14.47),(3.6,.045,.09),.005)
    for r,w in [(1.8,.15),(1.6,.06)]:arch(iron.name,(c,8.5,14.40),r,.27,w)
# Eaves and long fascia with restrained repeating brackets.
for z in [-1.6,14.5]:
    for y,d in [(18.15,.14),(18.32,.25),(18.52,.10)]:box(iron.name,(0,y,z),(28.5,d,.46),.02)
    for x in np.arange(-13.5,14,.65):box(trim.name,(float(x),18.05,z),(.10,.23,.20),.008)

# Convert runtime (x,y,z) -> Blender (x,-z,y), merge by material role.
objects=[];roles=[]
for name,b in BUCKETS.items():
    mesh=bpy.data.meshes.new(name+'_mesh');mesh.from_pydata([(x,-z,y) for x,y,z in b['v']],[],b['f']);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);obj.data.materials.append(MATERIALS[name])
    uv=mesh.uv_layers.new(name='UVMap')
    for poly,coords,smooth in zip(mesh.polygons,b['uv'],b['smooth']):
        poly.use_smooth=smooth
        for li,xy in zip(poly.loop_indices,coords):uv.data[li].uv=xy
    obj['role']='glass_no_shadow' if name==glass.name else 'static_architecture'
    obj['source']='Authored geometry; procedural architectural material supplement'
    objects.append(obj)
    roles.append({'name':name,'role':obj['role'],'vertices':len(mesh.vertices),'faces':len(mesh.polygons),'metallic':MATERIALS[name].node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value})
    if name==glass.name:obj.visible_shadow=False

# Actual Blender architectural proof with sunlight and area fill, no fog or cone meshes.
def pt(p):return (p[0],-p[2],p[1])
def aim(obj,target):obj.rotation_euler=(Vector(pt(target))-obj.location).to_track_quat('-Z','Y').to_euler()
def light(name,kind,p,energy,size=5,color=(1,1,1),target=(0,7,0)):
    d=bpy.data.lights.new(name,kind);d.energy=energy;d.color=color
    if kind=='AREA':d.shape='DISK';d.size=size
    if kind=='SUN':d.angle=.10
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=pt(p);aim(o,target);return o
light('clerestory daylight','AREA',(-7,21,8),3500,12,(.77,.87,1))
light('warm sun','SUN',(9,24,12),2.4,5,(1,.88,.69))
light('front bounce','AREA',(2,8,8),500,9,(.65,.75,.86))
bpy.context.scene.world=bpy.data.worlds.new('hall sky');bpy.context.scene.world.use_nodes=True
bpy.context.scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.24,.31,.40,1)
bpy.context.scene.world.node_tree.nodes['Background'].inputs[1].default_value=.35
camdata=bpy.data.cameras.new('proof camera');camera=bpy.data.objects.new('proof camera',camdata);bpy.context.collection.objects.link(camera)
camera.location=pt((10,2.6,6.8));aim(camera,(-1.5,11.6,-.8));camdata.lens=21;bpy.context.scene.camera=camera
sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.samples=16 if '--quick-proof' in sys.argv else 32;sc.cycles.use_denoising=True
sc.render.resolution_x=1920;sc.render.resolution_y=1080;sc.render.resolution_percentage=100
sc.view_settings.view_transform='AgX';sc.view_settings.look='AgX - Medium High Contrast';sc.view_settings.exposure=.3
sc.render.image_settings.file_format='PNG';sc.render.filepath=str(ROOT/'blender-hall-proof.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'railway_hall.blend'))
bpy.ops.object.select_all(action='DESELECT')
for obj in objects:obj.select_set(True)
# AABB overlap is conservative here: every face touching the clear rectangular
# gateway is rejected, including a continuous stile whose endpoints miss it.
aperture_hits=[]
for name,b in BUCKETS.items():
    for fi,face in enumerate(b['f']):
        pts=[b['v'][j] for j in face]
        lo=[min(p[i] for p in pts) for i in range(3)];hi=[max(p[i] for p in pts) for i in range(3)]
        if hi[0]>-1.3999 and lo[0]<1.3999 and hi[1]>12.8001 and lo[1]<16.7999 and hi[2]>-1.9 and lo[2]<-.70:
            aperture_hits.append({'material':name,'face':fi,'bounds':[lo,hi]})
(ROOT/'aperture-failures.json').write_text(json.dumps(aperture_hits,indent=2))
if aperture_hits:
    raise RuntimeError('Static geometry intrudes into garden aperture')
bpy.ops.export_scene.gltf(filepath=str(OUT/'railway_hall.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_materials='EXPORT',export_extras=True)
allv=[v for b in BUCKETS.values() for v in b['v']]
manifest={'revision':'retry02-hall-004-headroom','units':'metres','coordinate_space':'runtime_threejs_yup','bounds_runtime':{'min':[min(v[i] for v in allv) for i in range(3)],'max':[max(v[i] for v in allv) for i in range(3)]},'garden_clear_aperture':{'x':[-1.4,1.4],'y':[12.8,16.8]},'static_material_draw_calls':len(objects),'roles':roles,'textures':[],'nano_lacquer_applied':NANO_LACQUER,'material_provenance':'Procedural authored complementary iron and stone maps are not Nano Banana outputs. Optional Nano lacquer copies use the shared material provenance and 0.5 m tile.'}
manifest['aperture_face_aabb_intersections']=len(aperture_hits)
manifest['drawer_docks']=DOCK_DATA
for p in TEX.rglob('*.png'):manifest['textures'].append({'path':str(p.relative_to(ROOT)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'source':'prepared Nano family' if 'nano_lacquer' in str(p) else 'authored procedural complement'})
(ROOT/'hall-manifest.json').write_text(json.dumps(manifest,indent=2))
print('HALL_EXPORT_COMPLETE',len(objects),sum(len(o.data.vertices) for o in objects),flush=True)
bpy.ops.render.render(write_still=True)
if '--deliver-root' in sys.argv:
    import shutil
    destination=Path(sys.argv[sys.argv.index('--deliver-root')+1]).resolve()
    for source,target in [(OUT/'railway_hall.glb',destination/'assets/models/railway_hall.glb'),(OUT/'railway_hall.blend',destination/'assets/blender/railway_hall.blend')]:
        target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
print('HALL_PROOF_COMPLETE',flush=True)
