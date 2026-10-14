"""Role-aware assembly of Gemini's detailed drawer; preserves bevelled source geometry."""
import bpy
import math
import json
from mathutils import Matrix
from collections import defaultdict

PREFIX = 'mesh_hero_drawer'

def group(name, parent, pos=(0, 0, 0), role=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = pos
    if role:
        obj['motion_role'] = role
    return obj

def reparent(obj, parent):
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world

def merge_role(role, preserve=()):
    """One draw primitive per material per motion role; exact decals remain separate."""
    groups = defaultdict(list)
    for obj in list(role.children):
        if obj.type != 'MESH' or any(s in obj.name for s in preserve):
            continue
        material = obj.data.materials[0] if obj.data.materials else None
        groups[material].append(obj)
    for material, objects in groups.items():
        source_names = [o.name for o in objects]
        bpy.context.view_layer.update()
        part_bounds = {}
        for part in objects:
            transform = role.matrix_world.inverted() @ part.matrix_world
            points = [transform @ v.co for v in part.data.vertices]
            part_bounds[part.name] = {'min': [min(v[i] for v in points) for i in range(3)], 'max': [max(v[i] for v in points) for i in range(3)]}
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        obj = bpy.context.active_object
        bpy.context.view_layer.update()
        transform = role.matrix_world.inverted() @ obj.matrix_world
        obj.data.transform(transform)
        obj.parent = role
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_basis = Matrix.Identity(4)
        suffix = material.name.replace('mat_', '') if material else 'unmaterialed'
        obj.name = role.name + '_' + suffix
        obj['motion_role'] = role.get('motion_role', '')
        obj['source_part_count'] = len(source_names)
        obj['source_parts'] = '|'.join(source_names)
        obj['source_part_bounds_blender'] = json.dumps(part_bounds)
        obj['uv_units_per_metre'] = 1.0

def assemble(hero, mats, builder):
    root = hero
    prefix = root.name
    original = [o for o in root.children_recursive if o.type == 'MESH']
    root['assembly_revision'] = 2
    root['uv_units_per_metre'] = 1.0
    root['nominal_drawer_width_m'] = 1.55
    root['reference_extension_m'] = 0.55
    root['fixed_dog_front_z_m'] = 0.55
    root['notch_position_formula_blender_y'] = 'extension_m - 1.10'
    body = group(prefix+'_role_body', root, role='moving_body')
    rearBulkhead = group(prefix+'_role_rear_bulkhead', root, role='moving_rear_bulkhead')
    fixed = group(prefix+'_role_fixed', root, role='fixed_guide')
    carrier = group(prefix+'_role_carrier', root, role='half_travel_carrier')
    pivot = group(prefix+'_role_latch_pivot', fixed, (.807, -.72, .075), 'fixed_hinged_pawl')
    pivot['release_angle_rad'] = .55
    pivot['dog_center_local_m'] = [0.0, .17, -.041]
    wheels = {}
    for side, sx in [('L', -1), ('R', 1)]:
        for i, ry in enumerate([-.68, .68]):
            center_z = -.135 if i == 0 else -.173
            wheel = group(prefix+f'_role_roller_{side}_{i}', carrier, (sx*.825, ry, center_z), 'carrier_roller')
            wheel['radius_m'] = .052
            wheel['contact_role'] = 'moving_runner' if i == 0 else 'fixed_channel'
            wheels[(side, i)] = wheel
    for obj in original:
        n = obj.name
        if any(m and m.name in {'mat_handled_lacquer', 'mat_luggage_canvas', 'mat_worn_lining'} for m in obj.data.materials):
            builder.apply_archival_uvs(obj, swap_uv=bool(obj.get('uv_swap_axes', False)))
        if any(s in n for s in ['_notch_tooth_', '_notch_shoulder_', '_notch_strike_']):
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        if any(n.endswith(s) for s in ['_wall_back', '_baize_back', '_baize_cap_rail_back']):
            reparent(obj,rearBulkhead)
            continue
        if '_latch_pawl' in n:
            if '_clevis_' in n or n.endswith('_pin'):
                obj.location.z += .013
                reparent(obj, fixed)
            else:
                if n.endswith('_latch_pawl'):
                    obj.location.z = .075
                    obj.rotation_euler.x = 0
                elif n.endswith('_dog'):
                    obj.location.y = -.55
                reparent(obj, pivot)
            continue
        if '_rail_channel_web_' in n or '_rail_flange_' in n:
            reparent(obj, fixed)
            # Retain the detailed C-section as a nested intermediate telescopic member.
            clone = obj.copy()
            clone.data = obj.data.copy()
            bpy.context.collection.objects.link(clone)
            clone.name = n.replace('_rail_', '_carrier_')
            reparent(clone, carrier)
            sx = -1 if n.endswith('_L') else 1
            clone.location.x = sx * (.809 if '_web_' in n else .819)
            clone.location.z = -.064 + (clone.location.z + .064) * .65
            clone.scale.x *= .6
            clone.scale.z *= .65
            continue
        if '_rail_web_bolt_' in n:
            reparent(obj, fixed)
            continue
        if '_rail_inner_runner_' in n:
            sx = -1 if n.endswith('_L') else 1
            obj.location.x = sx*.826
            obj.scale.x *= .55
        if '_notch_bar_' in n:
            # Rack floor top is .006m; closed dog bottom is .010m, leaving 4mm clearance.
            obj.location.z = -.004
            obj.scale.z *= .020 / .024
        if '_roller_' in n:
            side, index = n.rsplit('_', 2)[-2:]
            if side in ('L', 'R') and index.isdigit():
                obj.location.z += .027 if int(index) == 0 else -.011
                if any(s in n for s in ['_yoke_', '_axle_', '_locknut_']):
                    reparent(obj, carrier)
                else:
                    reparent(obj, wheels[(side, int(index))])
                continue
        reparent(obj, body)
    notches = group(prefix+'_role_notches', root, role='moving_notch_rack')
    # Gap .038m, dog .032m: 3mm longitudinal clearance each side when seated.
    for side, sx in [('L', -1), ('R', 1)]:
        for i, stop in enumerate([.60, 1.30, 1.95]):
            unit = group(prefix+('_notch_unit' if side == 'R' and i == 0 else f'_notch_unit_{side}_{i}'), notches, (sx*.807, stop-1.10, 0), 'moving_notch_unit')
            unit['stop_extension_m'] = stop
            unit['pocket_half_gap_m'] = .019
            for tag, y in [('front', -.04), ('rear', .04)]:
                builder.make_box(prefix+f'_seat_{side}_{i}_{tag}', (.052, .042, .048), (sx*.807, stop-1.10+y, .032), mats['brass'], .002, 2, root)
                reparent(bpy.context.active_object, unit)
            builder.make_box(prefix+f'_seat_{side}_{i}_floor', (.052, .038, .006), (sx*.807, stop-1.10, .003), mats['iron'], .001, 2, root)
            reparent(bpy.context.active_object, unit)
            merge_role(unit)
    # Small inner platform, not the player's outer standing deck. Used only by #104.
    pan = group(prefix+'_role_weighing_pan', root, (0, .48, .20), 'internal_weighing_pan')
    panBase = group(prefix+'_role_pan_guides', body, role='internal_pan_guides')
    pan['maximum_stroke_m'] = .09
    pan['footprint_m'] = [1.10, .90]
    pan['centre_browser_local_m'] = [0, .20, -.48]
    builder.make_box(prefix+'_weighing_pan_plate', (1.10, .90, .032), (0, .48, .184), mats['iron'], .009, 3, root)
    reparent(bpy.context.active_object, pan)
    for sx in [-1, 1]:
        builder.make_box(prefix+f'_weighing_pan_guard_{sx}', (.022, .88, .022), (sx*.54, .48, .28), mats['brass'], .004, 2, root)
        reparent(bpy.context.active_object, pan)
        for sy in [-1, 1]:
            obj=builder.make_box(prefix+f'_pan_guard_post_{sx}_{sy}',(.022,.022,.085),(sx*.54,.48+sy*.40,.24),mats['brass'],.003,2,root)
            reparent(obj,pan)
            obj=builder.make_cyl(prefix+f'_pan_guide_{sx}_{sy}',.023,.18,(sx*.47,.48+sy*.36,-.16),(0,0,0),mats['iron'],vertices=20,parent=root)
            reparent(obj,panBase)
            obj=builder.make_cyl(prefix+f'_pan_plunger_{sx}_{sy}',.012,.27,(sx*.47,.48+sy*.36,.049),(0,0,0),mats['brass'],vertices=20,parent=root)
            reparent(obj,pan)
    for tag, size, loc in [
        ('rear_guard',(1.10,.022,.022),(0,.91,.28)),
        ('front_lip',(1.10,.024,.032),(0,.03,.216))]:
        obj=builder.make_box(prefix+'_pan_'+tag,size,loc,mats['brass'],.004,2,root)
        reparent(obj,pan)
    # #104 only: fixed spring housing, separately rotating input ratchet and output spool.
    spring = group(prefix+'_role_spring_housing', fixed, (.98, -.62, -.14), 'stage1_spring_housing')
    output = group(prefix+'_role_output_spool', spring, (0, 0, 0), 'stage1_output_spool')
    winding = group(prefix+'_role_winding_ratchet', spring, (.10, 0, 0), 'stage1_winding_ratchet')
    release = group(prefix+'_role_spring_release', spring, (.10, -.11, .13), 'stage1_pan_release')
    def drum_cyl(tag, radius, depth, loc, material, parent, vertices=32):
        obj = builder.make_cyl(prefix+tag, radius, depth, loc, (0, math.pi/2, 0), material, vertices=vertices, parent=root)
        reparent(obj, parent)
    drum_cyl('_spring_case', .153, .055, (.93, -.62, -.14), mats['iron'], spring)
    drum_cyl('_spring_cover', .139, .014, (.895, -.62, -.14), mats['brass'], spring)
    drum_cyl('_output_barrel', .11, .080, (.995, -.62, -.14), mats['iron'], output)
    for x in [.948,1.042]:
        drum_cyl(f'_output_flange_{x}', .137, .016, (x, -.62, -.14), mats['brass'], output)
    drum_cyl('_output_hub', .045, .16, (.98, -.62, -.14), mats['iron'], output)
    drum_cyl('_ratchet_disc', .095, .015, (1.08, -.62, -.14), mats['iron'], winding)
    for i in range(20):
        a = i*math.tau/20
        obj=builder.make_box(prefix+f'_ratchet_tooth_{i}', (.018,.023,.026), (1.08,-.62+.099*math.sin(a),-.14+.099*math.cos(a)), mats['brass'], .002, 2, root, rot_xyz=(-a,0,0))
        reparent(obj,winding)
    drum_cyl('_ratchet_capnut', .025, .03, (1.10,-.62,-.14), mats['brass'], winding, 6)
    obj=builder.make_box(prefix+'_spring_release_arm',(.025,.115,.025),(1.08,-.685,-.01),mats['brass'],.004,2,root)
    reparent(obj,release)
    obj=builder.make_box(prefix+'_spring_release_dog',(.022,.022,.040),(1.08,-.630,-.031),mats['brass'],.003,2,root)
    reparent(obj,release)
    for y in [-.74,-.50]:
        obj=builder.make_box(prefix+f'_spring_mount_{y}',(.18,.035,.055),(.89,y,-.15),mats['iron'],.005,2,root)
        reparent(obj,spring)
    for role in [body, rearBulkhead, fixed, carrier, pivot, pan, panBase, spring, output, winding, release, *wheels.values()]:
        merge_role(role, preserve=('_card_plaque_inset',))
    # The neutral export origin represents .55m extension, between valid stops: show the latch released.
    pivot.rotation_euler.x = .55
    root['reference_latch_state'] = 'released'
    bpy.context.view_layer.update()
    root['source_mesh_count'] = len(original)
    root['merged_mesh_count'] = sum(o.type == 'MESH' for o in root.children_recursive)
    return root
