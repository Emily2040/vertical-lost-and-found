import argparse
import bpy
import bmesh
import json
import math
import os
import sys
from pathlib import Path
from mathutils import Vector, Euler


def resolve_project_root(explicit_root=None) -> Path:
    if explicit_root:
        return Path(explicit_root).resolve()
    env_root = os.environ.get("VLF_PROJECT_ROOT") or os.environ.get("PROJECT_ROOT")
    if env_root:
        return Path(env_root).resolve()
    script_dir = Path(__file__).resolve().parent
    if script_dir.name == "scripts":
        return script_dir.parent
    if (script_dir / "contract.json").exists() or (script_dir / "assets").exists():
        return script_dir
    return script_dir.parent


def parse_blender_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Build Blender assets and GLB exports.")
    parser.add_argument("--project-root", type=Path, default=None)
    parser.add_argument("--output-root", type=Path, default=None)
    parser.add_argument("--pbr-dir", type=Path, default=None)
    parser.add_argument("--skip-renders", action="store_true", help="Geometry/debug export only; default also renders proof views.")
    return parser.parse_args(argv)


_ARGS = parse_blender_args()
PROJECT_ROOT = resolve_project_root(_ARGS.project_root)
OUTPUT_ROOT = _ARGS.output_root.resolve() if _ARGS.output_root else PROJECT_ROOT
PBR_DIR = _ARGS.pbr_dir.resolve() if _ARGS.pbr_dir else PROJECT_ROOT / "assets" / "textures" / "pbr"
BLEND_DIR = OUTPUT_ROOT / "assets" / "blender"
MODEL_DIR = OUTPUT_ROOT / "assets" / "models"
RENDER_DIR = OUTPUT_ROOT / "renders" / "blender"


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def create_pbr_material(name: str, family_prefix: str = None, base_rgb=(0.5, 0.5, 0.5), metallic=0.0, roughness=0.5, uv_scale=1.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out_node = nodes.new(type="ShaderNodeOutputMaterial")
    out_node.location = (600, 0)

    bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    bsdf.location = (260, 0)
    links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

    if family_prefix:
        family_dir = PROJECT_ROOT / "assets" / "textures" / "pbr" if family_prefix.startswith("label_") else PBR_DIR
        tex_coord = nodes.new(type="ShaderNodeTexCoord")
        tex_coord.location = (-780, 0)
        mapping = nodes.new(type="ShaderNodeMapping")
        mapping.location = (-560, 0)
        mapping.inputs["Scale"].default_value = (uv_scale, uv_scale, uv_scale)
        links.new(tex_coord.outputs["UV"], mapping.inputs["Vector"])

        # BaseColor (sRGB)
        bc_path = family_dir / f"{family_prefix}_basecolor.png"
        bc_tex = nodes.new(type="ShaderNodeTexImage")
        bc_tex.location = (-280, 260)
        bc_tex.image = bpy.data.images.load(str(bc_path), check_existing=True)
        bc_tex.image.colorspace_settings.name = "sRGB"
        links.new(mapping.outputs["Vector"], bc_tex.inputs["Vector"])
        links.new(bc_tex.outputs["Color"], bsdf.inputs["Base Color"])

        # Roughness (Non-Color)
        r_path = family_dir / f"{family_prefix}_roughness.png"
        r_tex = nodes.new(type="ShaderNodeTexImage")
        r_tex.location = (-280, 0)
        r_tex.image = bpy.data.images.load(str(r_path), check_existing=True)
        r_tex.image.colorspace_settings.name = "Non-Color"
        links.new(mapping.outputs["Vector"], r_tex.inputs["Vector"])
        links.new(r_tex.outputs["Color"], bsdf.inputs["Roughness"])

        # Metalness (Non-Color)
        m_path = family_dir / f"{family_prefix}_metalness.png"
        m_tex = nodes.new(type="ShaderNodeTexImage")
        m_tex.location = (-280, -240)
        m_tex.image = bpy.data.images.load(str(m_path), check_existing=True)
        m_tex.image.colorspace_settings.name = "Non-Color"
        links.new(mapping.outputs["Vector"], m_tex.inputs["Vector"])
        links.new(m_tex.outputs["Color"], bsdf.inputs["Metallic"])

        # Normal (Non-Color)
        n_path = family_dir / f"{family_prefix}_normal.png"
        n_tex = nodes.new(type="ShaderNodeTexImage")
        n_tex.location = (-280, -500)
        n_tex.image = bpy.data.images.load(str(n_path), check_existing=True)
        n_tex.image.colorspace_settings.name = "Non-Color"
        links.new(mapping.outputs["Vector"], n_tex.inputs["Vector"])

        norm_node = nodes.new(type="ShaderNodeNormalMap")
        norm_node.location = (20, -420)
        norm_node.inputs["Strength"].default_value = 1.0
        links.new(n_tex.outputs["Color"], norm_node.inputs["Color"])
        links.new(norm_node.outputs["Normal"], bsdf.inputs["Normal"])
    else:
        bsdf.inputs["Base Color"].default_value = (*base_rgb, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness

    return mat


def smart_uv_unwrap(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if obj.type == "MESH":
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.cube_project(cube_size=1.2, correct_aspect=True)
        bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)


def assign_deliberate_decal_uvs(obj):
    """
    Map the front (-Y) face of a label decal plate across the full [0.0, 1.0] x [0.0, 1.0] UV rectangle
    so 100% of the object-specific routing label is covered without distortion or cropping.
    Side/back faces map into the clean text-free canvas margin [0.01, 0.03] x [0.01, 0.03].
    """
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv_layer = mesh.uv_layers.active.data

    xs = [v.co.x for v in mesh.vertices]
    zs = [v.co.z for v in mesh.vertices]
    min_x, max_x = min(xs), max(xs)
    min_z, max_z = min(zs), max(zs)
    span_x = max(max_x - min_x, 1e-6)
    span_z = max(max_z - min_z, 1e-6)

    for poly in mesh.polygons:
        is_front_face = poly.normal.y < -0.35
        for loop_idx in poly.loop_indices:
            v = mesh.vertices[mesh.loops[loop_idx].vertex_index]
            u01 = (v.co.x - min_x) / span_x
            v01 = (v.co.z - min_z) / span_z
            if is_front_face:
                uv_layer[loop_idx].uv = (u01, v01)
            else:
                uv_layer[loop_idx].uv = (0.01 + 0.02 * u01, 0.01 + 0.02 * v01)


def add_label_decal_plate(name, size_xyz, loc_xyz, mat, bevel_width=0.002, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc_xyz)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size_xyz
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bev = obj.modifiers.new(name="Bevel", type="BEVEL")
    bev.width = bevel_width
    bev.segments = 1
    bev.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=bev.name)

    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)
    assign_deliberate_decal_uvs(obj)
    if parent:
        obj.parent = parent
    return obj


def add_bevel_box(name, size_xyz, loc_xyz, mat, bevel_width=0.015, segments=2, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc_xyz)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size_xyz
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bev = obj.modifiers.new(name="Bevel", type="BEVEL")
    bev.width = bevel_width
    bev.segments = segments
    bev.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=bev.name)

    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)
    smart_uv_unwrap(obj)
    if parent:
        obj.parent = parent
    return obj


def add_cylinder_part(name, radius, depth, loc_xyz, rot_xyz, mat, vertices=64, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc_xyz, rotation=rot_xyz)
    obj = bpy.context.active_object
    obj.name = name
    bev = obj.modifiers.new(name="Bevel", type="BEVEL")
    bev.width = min(radius, depth) * 0.08
    bev.segments = 2
    bpy.ops.object.modifier_apply(modifier=bev.name)

    for face in obj.data.polygons:
        face.use_smooth = abs(face.normal.z) < 0.999

    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)
    smart_uv_unwrap(obj)
    if parent:
        obj.parent = parent
    return obj


def build_hero_drawer(mats, name_prefix="mesh_hero_drawer", origin=(0, 0, 0)):
    """
    Build a full-scale climbable archival drawer with real wall thickness, dovetail corner blocks,
    recessed worn baize lining, twin brass handles, side rail guide beams with 3 physical notches,
    guide rollers, and a hinged latch pawl.
    Blender Z-up: X = width (1.55m), Y = depth (-2.10m along -Y forward), Z = height (0.68m).
    """
    root = bpy.data.objects.new(name_prefix, None)
    bpy.context.collection.objects.link(root)
    root.location = origin

    W = 1.55
    D = 2.10
    H = 0.62
    T = 0.065  # 65mm solid timber/lacquer wall thickness

    # 1. Heavy Front Faceplate (overhanging lip for clear foothold silhouette)
    add_bevel_box(
        f"{name_prefix}_front_plate",
        (W + 0.08, T * 1.25, H + 0.06),
        (0.0, -D * 0.5, 0.0),
        mats["lacquer"],
        bevel_width=0.018,
        segments=3,
        parent=root
    )

    # 2. Left, Right, Back Walls & Bottom Slab
    add_bevel_box(
        f"{name_prefix}_wall_left",
        (T, D - T, H),
        (-W * 0.5 + T * 0.5, 0.0, 0.0),
        mats["lacquer"],
        bevel_width=0.012,
        parent=root
    )
    add_bevel_box(
        f"{name_prefix}_wall_right",
        (T, D - T, H),
        (W * 0.5 - T * 0.5, 0.0, 0.0),
        mats["lacquer"],
        bevel_width=0.012,
        parent=root
    )
    add_bevel_box(
        f"{name_prefix}_wall_back",
        (W - T * 1.5, T, H),
        (0.0, D * 0.5 - T * 0.5, 0.0),
        mats["lacquer"],
        bevel_width=0.012,
        parent=root
    )
    add_bevel_box(
        f"{name_prefix}_bottom_slab",
        (W - T * 1.6, D - T * 1.6, T),
        (0.0, 0.0, -H * 0.5 + T * 0.5),
        mats["lacquer"],
        bevel_width=0.010,
        parent=root
    )

    # 3. Recessed Worn Interior Baize Lining Floor & Side Pads (mat_worn_lining)
    add_bevel_box(
        f"{name_prefix}_baize_floor",
        (W - T * 2.2, D - T * 2.2, 0.028),
        (0.0, 0.0, -H * 0.5 + T + 0.014),
        mats["lining"],
        bevel_width=0.006,
        parent=root
    )
    for sx, side_tag in [(-1, "L"), (1, "R")]:
        add_bevel_box(
            f"{name_prefix}_baize_side_{side_tag}",
            (0.022, D - T * 2.4, H * 0.68),
            (sx * (W * 0.5 - T - 0.012), 0.0, -0.02),
            mats["lining"],
            bevel_width=0.005,
            parent=root
        )

    # 4. Brass Corner Dovetail/Reinforcement Brackets & Card Frame on Front Plate
    add_bevel_box(
        f"{name_prefix}_card_frame",
        (0.38, 0.024, 0.16),
        (0.0, -D * 0.5 - T * 0.65, 0.14),
        mats["brass"],
        bevel_width=0.006,
        parent=root
    )
    add_bevel_box(
        f"{name_prefix}_card_plaque_inset",
        (0.32, 0.026, 0.11),
        (0.0, -D * 0.5 - T * 0.68, 0.14),
        mats["canvas"],
        bevel_width=0.003,
        parent=root
    )

    # 5. Twin Heavy Turned Brass Pull Handles (also act as front climbing rungs)
    for hx, h_tag in [(-0.42, "L"), (0.42, "R")]:
        add_cylinder_part(
            f"{name_prefix}_handle_bar_{h_tag}",
            0.022, 0.34,
            (hx, -D * 0.5 - 0.11, -0.08),
            (0.0, math.pi * 0.5, 0.0),
            mats["brass"],
            parent=root
        )
        for sx in [-0.14, 0.14]:
            add_cylinder_part(
                f"{name_prefix}_handle_post_{h_tag}_{sx:+.2f}",
                0.018, 0.09,
                (hx + sx, -D * 0.5 - 0.065, -0.08),
                (math.pi * 0.5, 0.0, 0.0),
                mats["brass"],
                parent=root
            )

    # 6. Side Brass Notched Rail Bars (with 3 physical notch cutouts at 0.60m, 1.30m, 1.95m) & Guide Rollers
    for sx, side_tag in [(-1, "L"), (1, "R")]:
        rail_x = sx * (W * 0.5 + 0.035)
        add_bevel_box(
            f"{name_prefix}_notch_bar_{side_tag}",
            (0.045, D - 0.08, 0.09),
            (rail_x, 0.0, -0.06),
            mats["brass"],
            bevel_width=0.006,
            parent=root
        )
        # Three distinct raised notch teeth blocks along the rail bar
        for n_idx, ny in enumerate([-0.55, 0.10, 0.72]):
            add_bevel_box(
                f"{name_prefix}_notch_tooth_{side_tag}_{n_idx}",
                (0.058, 0.08, 0.055),
                (rail_x, ny, 0.01),
                mats["brass"],
                bevel_width=0.005,
                parent=root
            )
        # Two brass flanged rollers per side
        for r_idx, ry in enumerate([-0.68, 0.68]):
            add_cylinder_part(
                f"{name_prefix}_roller_{side_tag}_{r_idx}",
                0.065, 0.055,
                (rail_x + sx * 0.02, ry, -0.16),
                (0.0, math.pi * 0.5, 0.0),
                mats["brass"],
                parent=root
            )

    # 7. Hinged Brass Latch Pawl on Right Rail Front
    add_bevel_box(
        f"{name_prefix}_latch_pawl",
        (0.05, 0.18, 0.11),
        (W * 0.5 + 0.055, -D * 0.5 + 0.22, 0.08),
        mats["brass"],
        bevel_width=0.006,
        parent=root
    )

    return root


def build_load_cage(mats, name_prefix="mesh_load_cage", origin=(0, 0, 0)):
    root = bpy.data.objects.new(name_prefix, None)
    bpy.context.collection.objects.link(root)
    root.location = origin

    W, D, H = 1.45, 1.35, 1.15
    # Base platform tray with lacquer rim and worn baize floor
    add_bevel_box(f"{name_prefix}_tray_base", (W, D, 0.10), (0, 0, 0), mats["lacquer"], bevel_width=0.014, parent=root)
    add_bevel_box(f"{name_prefix}_tray_lining", (W - 0.14, D - 0.14, 0.03), (0, 0, 0.055), mats["lining"], bevel_width=0.005, parent=root)

    # 4 corner brass posts & top frame
    for sx in [-1, 1]:
        for sy in [-1, 1]:
            add_cylinder_part(
                f"{name_prefix}_post_{sx}_{sy}",
                0.028, H,
                (sx * (W * 0.5 - 0.05), sy * (D * 0.5 - 0.05), H * 0.5),
                (0, 0, 0),
                mats["brass"],
                parent=root
            )
    add_bevel_box(f"{name_prefix}_top_beam_x", (W, 0.07, 0.07), (0, 0, H), mats["brass"], bevel_width=0.008, parent=root)
    add_bevel_box(f"{name_prefix}_top_beam_y", (0.07, D, 0.07), (0, 0, H), mats["brass"], bevel_width=0.008, parent=root)
    # Top suspension clevis wheel
    add_cylinder_part(f"{name_prefix}_clevis_sheave", 0.14, 0.06, (0, 0, H + 0.14), (0, math.pi * 0.5, 0), mats["brass"], parent=root)
    # Front cargo hatch gate bar
    add_bevel_box(f"{name_prefix}_cargo_hatch_gate", (W - 0.16, 0.04, 0.42), (0, -D * 0.5 + 0.04, 0.26), mats["brass"], bevel_width=0.006, parent=root)
    return root


def build_transfer_chute(mats, name_prefix="mesh_transfer_chute", origin=(0, 0, 0)):
    root = bpy.data.objects.new(name_prefix, None)
    bpy.context.collection.objects.link(root)
    root.location = origin

    L, W, H = 2.4, 0.78, 0.36
    add_bevel_box(f"{name_prefix}_bed", (L, W, 0.06), (0, 0, 0), mats["lacquer"], bevel_width=0.01, parent=root)
    for sy, tag in [(-1, "front"), (1, "back")]:
        add_bevel_box(f"{name_prefix}_flange_{tag}", (L, 0.05, H), (0, sy * (W * 0.5 - 0.025), H * 0.5), mats["brass"], bevel_width=0.008, parent=root)
    for r_idx in range(7):
        rx = -L * 0.42 + r_idx * (L * 0.84 / 6.0)
        add_cylinder_part(f"{name_prefix}_roller_{r_idx}", 0.032, W - 0.12, (rx, 0, 0.04), (math.pi * 0.5, 0, 0), mats["brass"], parent=root)
    return root


def build_payloads(mats, origin_base=(0, 0, 0)):
    payload_roots = {}

    # 1. Steamer Trunk (payload_trunk_01: Steamer Trunk #A-12, 35 kg)
    trunk = bpy.data.objects.new("mesh_steamer_trunk", None)
    bpy.context.collection.objects.link(trunk)
    trunk.location = (origin_base[0] + 3.0, origin_base[1], origin_base[2])
    add_bevel_box("trunk_body", (0.76, 0.48, 0.46), (0, 0, 0.23), mats["canvas"], bevel_width=0.018, parent=trunk)
    for sx in [-0.24, 0.24]:
        add_bevel_box(f"trunk_strap_{sx:+.2f}", (0.065, 0.51, 0.48), (sx, 0, 0.23), mats["lacquer"], bevel_width=0.006, parent=trunk)
    add_bevel_box("trunk_lock_plate", (0.14, 0.03, 0.12), (0, -0.245, 0.28), mats["brass"], bevel_width=0.005, parent=trunk)
    add_label_decal_plate(
        "decal_payload_trunk_01",
        (0.34, 0.008, 0.14),
        (0.0, -0.243, 0.125),
        mats["label_payload_trunk_01"],
        parent=trunk,
    )
    payload_roots["mesh_steamer_trunk"] = trunk

    # 2. Rolled Carpet (payload_carpet_02: Rolled Persian Carpet, 25 kg)
    carpet = bpy.data.objects.new("mesh_rolled_carpet", None)
    bpy.context.collection.objects.link(carpet)
    carpet.location = (origin_base[0] + 4.5, origin_base[1], origin_base[2])
    add_cylinder_part("carpet_roll_outer", 0.17, 1.05, (0, 0, 0.17), (0, math.pi * 0.5, 0), mats["lining"], parent=carpet)
    add_cylinder_part("carpet_roll_core", 0.11, 1.09, (0, 0, 0.17), (0, math.pi * 0.5, 0), mats["canvas"], parent=carpet)
    for sx in [-0.30, 0.30]:
        add_cylinder_part(f"carpet_strap_{sx:+.2f}", 0.18, 0.055, (sx, 0, 0.17), (0, math.pi * 0.5, 0), mats["brass"], parent=carpet)
    add_label_decal_plate(
        "decal_payload_carpet_02",
        (0.38, 0.010, 0.14),
        (0.0, -0.174, 0.17),
        mats["label_payload_carpet_02"],
        parent=carpet,
    )
    payload_roots["mesh_rolled_carpet"] = carpet

    # 3. Crated Ceramic Parcel (payload_ceramic_03: Crated Ceramic Parcel, 20 kg)
    parcel = bpy.data.objects.new("mesh_ceramic_parcel", None)
    bpy.context.collection.objects.link(parcel)
    parcel.location = (origin_base[0] + 6.0, origin_base[1], origin_base[2])
    add_cylinder_part("parcel_drum", 0.21, 0.56, (0, 0, 0.21), (0, math.pi * 0.5, 0), mats["canvas"], vertices=16, parent=parcel)
    for sx in [-0.22, 0.0, 0.22]:
        add_cylinder_part(f"parcel_band_{sx:+.2f}", 0.222, 0.045, (sx, 0, 0.21), (0, math.pi * 0.5, 0), mats["brass"], vertices=24, parent=parcel)
    add_label_decal_plate(
        "decal_payload_ceramic_03",
        (0.34, 0.010, 0.14),
        (0.0, -0.226, 0.21),
        mats["label_payload_ceramic_03"],
        parent=parcel,
    )
    payload_roots["mesh_ceramic_parcel"] = parcel

    # 4. Umbrella Case (payload_umbrella_04: Cast-Base Umbrella Case, 15 kg)
    umbrella = bpy.data.objects.new("mesh_umbrella_case", None)
    bpy.context.collection.objects.link(umbrella)
    umbrella.location = (origin_base[0] + 7.5, origin_base[1], origin_base[2])
    add_cylinder_part("umbrella_stand_tube", 0.15, 0.72, (0, 0, 0.38), (0, 0, 0), mats["lacquer"], vertices=12, parent=umbrella)
    add_cylinder_part("umbrella_base_weight", 0.19, 0.10, (0, 0, 0.05), (0, 0, 0), mats["brass"], vertices=16, parent=umbrella)
    add_cylinder_part("umbrella_ferrule_bundle", 0.08, 0.24, (0, 0, 0.80), (0, 0, 0), mats["canvas"], vertices=12, parent=umbrella)
    add_label_decal_plate(
        "decal_payload_umbrella_04",
        (0.24, 0.010, 0.13),
        (0.0, -0.155, 0.42),
        mats["label_payload_umbrella_04"],
        parent=umbrella,
    )
    payload_roots["mesh_umbrella_case"] = umbrella

    # 5. Boxed Surveying Instruments (payload_instruments_05: Boxed Surveying Instruments, 45 kg)
    inst = bpy.data.objects.new("mesh_boxed_instruments", None)
    bpy.context.collection.objects.link(inst)
    inst.location = (origin_base[0] + 9.0, origin_base[1], origin_base[2])
    add_bevel_box("inst_case_box", (0.62, 0.52, 0.54), (0, 0, 0.27), mats["lacquer"], bevel_width=0.015, parent=inst)
    add_bevel_box("inst_label_panel", (0.48, 0.025, 0.32), (0, -0.26, 0.27), mats["canvas"], bevel_width=0.005, parent=inst)
    add_cylinder_part("inst_dial_bezel", 0.11, 0.04, (0, -0.265, 0.30), (math.pi * 0.5, 0, 0), mats["brass"], parent=inst)
    add_label_decal_plate(
        "decal_payload_instruments_05",
        (0.42, 0.008, 0.13),
        (0.0, -0.277, 0.115),
        mats["label_payload_instruments_05"],
        parent=inst,
    )
    payload_roots["mesh_boxed_instruments"] = inst

    # 6. Opening Rolling Dispatch Parcel (rolling_parcel_01: Dispatch Brass Parcel, 18 kg)
    rolling_parcel = bpy.data.objects.new("mesh_rolling_parcel", None)
    bpy.context.collection.objects.link(rolling_parcel)
    rolling_parcel.location = (origin_base[0] + 10.5, origin_base[1], origin_base[2])
    add_cylinder_part("rolling_parcel_drum", 0.21, 0.56, (0, 0, 0.21), (0, math.pi * 0.5, 0), mats["canvas"], vertices=16, parent=rolling_parcel)
    for sx in [-0.22, 0.0, 0.22]:
        add_cylinder_part(f"rolling_parcel_band_{sx:+.2f}", 0.222, 0.045, (sx, 0, 0.21), (0, math.pi * 0.5, 0), mats["brass"], vertices=24, parent=rolling_parcel)
    add_label_decal_plate(
        "decal_rolling_parcel_01",
        (0.34, 0.010, 0.14),
        (0.0, -0.226, 0.21),
        mats["label_rolling_parcel_01"],
        parent=rolling_parcel,
    )
    payload_roots["mesh_rolling_parcel"] = rolling_parcel

    return payload_roots



def render_proof_views(drawer_root, mats):
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100

    # Use EEVEE for textured PBR close-up and material isolation
    for eng in ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"]:
        try:
            scene.render.engine = eng
            break
        except Exception:
            continue

    # Create Studio Lighting for Proof Renders
    world = bpy.data.worlds.new("ProofWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.10, 0.12, 0.16, 1.0)
        bg.inputs["Strength"].default_value = 1.4

    bpy.ops.object.light_add(type="AREA", location=(-1.8, -2.8, 1.9))
    key_light = bpy.context.active_object
    key_light.data.energy = 320.0
    key_light.data.size = 2.2
    key_light.data.color = (1.0, 0.93, 0.82)
    key_light.rotation_euler = Euler((math.radians(52), 0.0, math.radians(-32)), "XYZ")

    bpy.ops.object.light_add(type="AREA", location=(2.2, -1.8, 1.2))
    fill_light = bpy.context.active_object
    fill_light.data.energy = 160.0
    fill_light.data.size = 2.5
    fill_light.data.color = (0.72, 0.82, 1.0)
    fill_light.rotation_euler = Euler((math.radians(60), 0.0, math.radians(42)), "XYZ")

    bpy.ops.object.light_add(type="AREA", location=(0.0, 1.6, 2.2))
    rim_light = bpy.context.active_object
    rim_light.data.energy = 220.0
    rim_light.data.size = 2.0
    rim_light.rotation_euler = Euler((math.radians(-45), 0.0, 0.0), "XYZ")

    # Camera 1: Hero Drawer Close-Up (showing front lacquer, brass handles, card frame, baize interior, notched rail)
    bpy.ops.object.camera_add(location=(1.65, -2.55, 1.08))
    cam = bpy.context.active_object
    cam.data.lens = 42.0
    direction = Vector((0.0, -0.35, -0.05)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    scene.render.filepath = str(RENDER_DIR / "hero_drawer_closeup.png")
    bpy.ops.render.render(write_still=True)

    # Camera 2: Material Isolation / UV Scale Orthographic Three-Quarter Top View
    cam.location = (1.95, -2.10, 1.75)
    direction = Vector((0.0, -0.15, 0.0)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(RENDER_DIR / "hero_drawer_material_isolation.png")
    bpy.ops.render.render(write_still=True)

    # Camera 3: Clay + Wireframe View exposing bevels, thickness, joints, rollers, notches
    clay_mat = create_pbr_material("mat_clay_proof", base_rgb=(0.76, 0.74, 0.70), metallic=0.05, roughness=0.42)
    wire_mat = create_pbr_material("mat_wire_proof", base_rgb=(0.12, 0.14, 0.18), metallic=0.1, roughness=0.5)

    saved_mats = {}
    wire_mods = []
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.name.startswith("mesh_hero_drawer"):
            saved_mats[obj.name] = [m for m in obj.data.materials]
            obj.data.materials.clear()
            obj.data.materials.append(clay_mat)
            obj.data.materials.append(wire_mat)
            wmod = obj.modifiers.new(name="ProofWire", type="WIREFRAME")
            wmod.thickness = 0.0045
            wmod.use_replace = False
            wmod.material_offset = 1
            wire_mods.append((obj, wmod))

    cam.location = (1.55, -2.35, 1.15)
    direction = Vector((0.0, -0.30, -0.04)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(RENDER_DIR / "hero_drawer_clay_wireframe.png")
    bpy.ops.render.render(write_still=True)

    # Restore original PBR materials and remove temporary wireframe modifiers
    for obj, wmod in wire_mods:
        obj.modifiers.remove(wmod)
        obj.data.materials.clear()
        for m in saved_mats[obj.name]:
            obj.data.materials.append(m)


def main():
    # Source-relative production entry point; no review-workspace dependency.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import hero_drawer_parts as hero
    import role_assembly as roles
    BLEND_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    RENDER_DIR.mkdir(parents=True, exist_ok=True)

    clear_scene()

    mats = {
        "lacquer": create_pbr_material("mat_handled_lacquer", family_prefix="handled_lacquer", uv_scale=2.0),
        "canvas": create_pbr_material("mat_luggage_canvas", family_prefix="luggage_canvas", uv_scale=10.0),
        "lining": create_pbr_material("mat_worn_lining", family_prefix="worn_lining", uv_scale=4.0),
        "brass": create_pbr_material("mat_brass_hardware", base_rgb=(0.76, 0.58, 0.26), metallic=0.88, roughness=0.28),
        "iron": create_pbr_material("mat_iron_structure", base_rgb=(0.16, 0.18, 0.21), metallic=0.82, roughness=0.46),
        "foliage": create_pbr_material("mat_garden_foliage", base_rgb=(0.24, 0.46, 0.22), metallic=0.02, roughness=0.72),
        "label_rolling_parcel_01": create_pbr_material("mat_label_rolling_parcel_01", family_prefix="label_rolling_parcel_01", uv_scale=1.0),
        "label_payload_trunk_01": create_pbr_material("mat_label_payload_trunk_01", family_prefix="label_payload_trunk_01", uv_scale=1.0),
        "label_payload_carpet_02": create_pbr_material("mat_label_payload_carpet_02", family_prefix="label_payload_carpet_02", uv_scale=1.0),
        "label_payload_ceramic_03": create_pbr_material("mat_label_payload_ceramic_03", family_prefix="label_payload_ceramic_03", uv_scale=1.0),
        "label_payload_umbrella_04": create_pbr_material("mat_label_payload_umbrella_04", family_prefix="label_payload_umbrella_04", uv_scale=1.0),
        "label_payload_instruments_05": create_pbr_material("mat_label_payload_instruments_05", family_prefix="label_payload_instruments_05", uv_scale=1.0),
    }

    # Build hero drawer at origin first and render the 3 required proof views
    drawer_root = roles.assemble(hero.build_refined_hero_drawer(mats, name_prefix="mesh_hero_drawer", origin=(0.0, 0.0, 0.0)), mats, hero)
    if not _ARGS.skip_renders:
        render_proof_views(drawer_root, mats)

    # Remove studio helper lights/camera before exporting clean GLB proof asset
    for obj in list(bpy.data.objects):
        if obj.type in ("LIGHT", "CAMERA"):
            bpy.data.objects.remove(obj, do_unlink=True)

    # Save single-asset editable .blend and .glb proof
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / "hero_drawer_proof.blend"))
    bpy.ops.export_scene.gltf(
        filepath=str(MODEL_DIR / "hero_drawer_proof.glb"),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_extras=True
    )

    # Now add the remaining modular kit assets (load cage, transfer chute, and all 5 identifiable payloads)
    build_load_cage(mats, name_prefix="mesh_load_cage", origin=(-3.2, 0.0, 0.0))
    build_transfer_chute(mats, name_prefix="mesh_transfer_chute", origin=(-6.5, 0.0, 0.0))
    build_payloads(mats, origin_base=(0.0, 0.0, 0.0))
    for obj in bpy.data.objects:
        if obj.type == "MESH" and not obj.name.startswith("mesh_hero_drawer"):
            names = {m.name for m in obj.data.materials if m}
            if names & {"mat_handled_lacquer", "mat_luggage_canvas", "mat_worn_lining"}:
                hero.apply_archival_uvs(obj)

    # Pack external texture files so the .blend file is self-contained and editable
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / "vertical_lost_and_found.blend"))

    bpy.ops.export_scene.gltf(
        filepath=str(MODEL_DIR / "vertical_lost_and_found_kit.glb"),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_extras=True
    )
    print("Successfully built Blender .blend sources, GLB exports, and proof renders.")
    meshes = [o for o in drawer_root.children_recursive if o.type == "MESH"]
    vertices = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    report = {
        "status": "built_requires_browser_review", "root": drawer_root.name, "revision": 2,
        "hero_mesh_count": len(meshes), "source_mesh_count": drawer_root["source_mesh_count"],
        "hero_vertices": sum(len(o.data.vertices) for o in meshes),
        "hero_faces": sum(len(o.data.polygons) for o in meshes),
        "bounds_min": [min(v[i] for v in vertices) for i in range(3)],
        "bounds_max": [max(v[i] for v in vertices) for i in range(3)],
        "uv_units_per_metre": 1, "pbr_dir": str(PBR_DIR),
        "roles": [{"name": o.name, "role": o.get("motion_role"),
                   "mesh_count": sum(c.type == "MESH" for c in o.children_recursive)}
                  for o in drawer_root.children_recursive if o.type == "EMPTY"]
    }
    (OUTPUT_ROOT / "build-evidence.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
