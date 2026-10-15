import bpy
import math
from mathutils import Vector, Matrix


def apply_archival_uvs(obj, uv_scale=1.0, uv_offset=(0.0, 0.0), swap_uv=False):
    """
    Metric box projection: one UV unit per metre. Per-part offsets and axis swaps
    retain grain direction; the material applies its physical tile size exactly once.
    uv_scale is retained for compatibility with the original builder calls and ignored.
    """
    # Retry02: one UV unit per metre; material tile scale is applied once in Blender.
    uv_scale = 1.0
    obj["uv_units_per_metre"] = 1.0
    obj["uv_swap_axes"] = bool(swap_uv)
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv_layer = mesh.uv_layers.active.data

    ox, oy = uv_offset
    for poly in mesh.polygons:
        n = poly.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop_idx in poly.loop_indices:
            v = mesh.vertices[mesh.loops[loop_idx].vertex_index].co
            if ax >= ay and ax >= az:
                u, w = v.y, v.z
            elif ay >= ax and ay >= az:
                u, w = v.x, v.z
            else:
                u, w = v.x, v.y
            if swap_uv:
                u, w = w, u
            uv_layer[loop_idx].uv = (u * uv_scale + ox, w * uv_scale + oy)


def apply_planar_region_uvs(obj, u_range=(0.35, 0.65), v_range=(0.35, 0.65)):
    """Map object vertices into a clean sub-rectangle of UV space (e.g. fine card stock region)."""
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

    u0, u1 = u_range
    v0, v1 = v_range
    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            v = mesh.vertices[mesh.loops[loop_idx].vertex_index].co
            tx = (v.x - min_x) / span_x
            tz = (v.z - min_z) / span_z
            uv_layer[loop_idx].uv = (u0 + tx * (u1 - u0), v0 + tz * (v1 - v0))


def make_box(
    name,
    size_xyz,
    loc_xyz,
    mat,
    bevel_width=0.006,
    segments=2,
    parent=None,
    rot_xyz=(0.0, 0.0, 0.0),
    uv_scale=0.85,
    uv_offset=(0.0, 0.0),
    swap_uv=False,
):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc_xyz, rotation=rot_xyz)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size_xyz
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    if bevel_width > 0.0:
        bev = obj.modifiers.new(name="Bevel", type="BEVEL")
        bev.width = bevel_width
        bev.segments = segments
        bev.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=bev.name)

    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)

    apply_archival_uvs(obj, uv_scale=uv_scale, uv_offset=uv_offset, swap_uv=swap_uv)
    if parent:
        obj.parent = parent
    return obj


def make_cyl(
    name,
    radius,
    depth,
    loc_xyz,
    rot_xyz,
    mat,
    vertices=32,
    bevel_ratio=0.08,
    segments=2,
    parent=None,
    uv_scale=1.0,
):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=loc_xyz,
        rotation=rot_xyz,
    )
    obj = bpy.context.active_object
    obj.name = name
    if bevel_ratio > 0.0:
        bev = obj.modifiers.new(name="Bevel", type="BEVEL")
        bev.width = min(radius, depth) * bevel_ratio
        bev.segments = segments
        bpy.ops.object.modifier_apply(modifier=bev.name)

    use_smooth = vertices >= 16
    for face in obj.data.polygons:
        face.use_smooth = use_smooth and (abs(face.normal.z) < 0.995)

    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)

    apply_archival_uvs(obj, uv_scale=uv_scale)
    if parent:
        obj.parent = parent
    return obj


def add_slotted_screw(name_base, loc_xyz, radius, depth, mat, parent, axis="Y", slot_angle=0.25):
    """
    Build a countersunk screw with a real physical inset slot channel between two split head halves
    and a recessed base collar so 1080p close-up and clay+wireframe proofs resolve the screw slot.
    """
    x, y, z = loc_xyz
    if axis == "Y":
        rot = (math.pi * 0.5, 0.0, 0.0)
        # Recessed collar seat
        make_cyl(
            f"{name_base}_seat",
            radius * 1.05,
            depth * 0.45,
            (x, y + depth * 0.22, z),
            rot,
            mat,
            vertices=16,
            bevel_ratio=0.05,
            parent=parent,
        )
        # Two split crown cheeks flanking a physical slot gap
        dx = math.cos(slot_angle) * radius * 0.42
        dz = math.sin(slot_angle) * radius * 0.42
        for side_idx, sign in enumerate([-1.0, 1.0]):
            make_box(
                f"{name_base}_cheek_{side_idx}",
                (radius * 1.55, depth * 0.65, radius * 0.56),
                (x - sign * dz, y - depth * 0.12, z + sign * dx),
                mat,
                bevel_width=radius * 0.12,
                segments=1,
                rot_xyz=(0.0, slot_angle, 0.0),
                parent=parent,
            )
    else:
        sx = 1.0 if axis == "+X" else -1.0
        rot = (0.0, math.pi * 0.5, 0.0)
        make_cyl(
            f"{name_base}_seat",
            radius * 1.05,
            depth * 0.45,
            (x - sx * depth * 0.22, y, z),
            rot,
            mat,
            vertices=16,
            bevel_ratio=0.05,
            parent=parent,
        )
        for side_idx, sign in enumerate([-1.0, 1.0]):
            make_box(
                f"{name_base}_cheek_{side_idx}",
                (depth * 0.65, radius * 1.55, radius * 0.56),
                (x + sx * depth * 0.12, y, z + sign * radius * 0.42),
                mat,
                bevel_width=radius * 0.12,
                segments=1,
                parent=parent,
            )


def build_refined_hero_drawer(mats, name_prefix="mesh_hero_drawer", origin=(0, 0, 0)):
    """
    Build a high-craft railway archive drawer with:
    - Layered recessed front panel + mortised stiles/rails + fielded lower panels
    - Narrow cast-metal perimeter edging with corner gussets and physical inset screw slots
    - Readable recessed index card holder with cast backplate, deep brass bezel, top slot, and corner screws
    - Turned brass handles with cast-iron standoff escutcheons, hex bolt heads, turned collars, and knuckles
    - Interior burgundy baize floor/wall pads framed by hardwood retaining battens and compartment cleats
    - Side C-channel guide tracks, precision 3-station notch racks, flanged rollers with hub/axle separation,
      and a mechanically engaged pivoting latch pawl + clevis + strike assembly on the right front rail.
    Preserves root name `mesh_hero_drawer`, origin, exterior envelope (W=1.55, D=2.10, H=0.62), and role names.
    """
    root = bpy.data.objects.new(name_prefix, None)
    bpy.context.collection.objects.link(root)
    root.location = origin

    W = 1.55
    D = 2.10
    H = 0.62
    T = 0.065

    W_front = W + 0.08   # 1.63m total front plate width
    H_front = H + 0.06   # 0.68m total front plate height
    Y_front = -D * 0.5   # -1.05m nominal front plane

    # -------------------------------------------------------------------------
    # 1. LAYERED RECESSED FRONT FACEPLATE & NARROW CAST-METAL EDGING
    # -------------------------------------------------------------------------
    # Deep recessed core backing slab (keeps exact `front_plate` role name)
    make_box(
        f"{name_prefix}_front_plate",
        (W_front - 0.016, 0.052, H_front - 0.016),
        (0.0, Y_front + 0.012, 0.0),
        mats["lacquer"],
        bevel_width=0.008,
        segments=2,
        parent=root,
        uv_scale=0.65,
        uv_offset=(0.12, 0.08),
    )

    # Mortised outer hardwood stiles & rails stepping 26mm forward of the recessed core
    make_box(
        f"{name_prefix}_front_rail_top",
        (W_front - 0.008, 0.032, 0.094),
        (0.0, Y_front - 0.024, H_front * 0.5 - 0.047),
        mats["lacquer"],
        bevel_width=0.009,
        segments=2,
        parent=root,
        uv_scale=0.72,
        uv_offset=(0.28, 0.44),
    )
    make_box(
        f"{name_prefix}_front_rail_bottom",
        (W_front - 0.008, 0.032, 0.086),
        (0.0, Y_front - 0.024, -H_front * 0.5 + 0.043),
        mats["lacquer"],
        bevel_width=0.009,
        segments=2,
        parent=root,
        uv_scale=0.72,
        uv_offset=(0.52, 0.19),
    )
    for sx, tag in [(-1.0, "L"), (1.0, "R")]:
        make_box(
            f"{name_prefix}_front_stile_{tag}",
            (0.116, 0.032, H_front - 0.172),
            (sx * (W_front * 0.5 - 0.062), Y_front - 0.024, -0.002),
            mats["lacquer"],
            bevel_width=0.008,
            segments=2,
            parent=root,
            uv_scale=0.75,
            uv_offset=(0.35 * sx, 0.62),
            swap_uv=True,
        )

    # Horizontal mid cross-rail & central vertical mullion dividing upper frieze from lower twin handle bays
    make_box(
        f"{name_prefix}_front_rail_mid",
        (W_front - 0.232, 0.026, 0.048),
        (0.0, Y_front - 0.020, 0.042),
        mats["lacquer"],
        bevel_width=0.006,
        segments=2,
        parent=root,
        uv_scale=0.70,
        uv_offset=(0.18, 0.77),
    )
    make_box(
        f"{name_prefix}_front_mullion_center",
        (0.078, 0.026, 0.282),
        (0.0, Y_front - 0.020, -0.116),
        mats["lacquer"],
        bevel_width=0.006,
        segments=2,
        parent=root,
        uv_scale=0.70,
        uv_offset=(0.64, 0.31),
        swap_uv=True,
    )

    # Stepped inner bolection molding & bevel-fielded recessed panels for left/right handle bays and upper frieze
    for sx, tag in [(-1.0, "L"), (1.0, "R")]:
        # Lower handle bay inner molding frame & raised fielded panel
        bay_x = sx * 0.368
        make_box(
            f"{name_prefix}_front_field_panel_{tag}",
            (0.555, 0.018, 0.215),
            (bay_x, Y_front - 0.014, -0.116),
            mats["lacquer"],
            bevel_width=0.012,
            segments=2,
            parent=root,
            uv_scale=0.62,
            uv_offset=(0.08 + 0.15 * sx, 0.14),
        )
        # Upper frieze side panel flanking the central card holder
        make_box(
            f"{name_prefix}_front_frieze_panel_{tag}",
            (0.385, 0.016, 0.122),
            (sx * 0.455, Y_front - 0.013, 0.152),
            mats["lacquer"],
            bevel_width=0.009,
            segments=2,
            parent=root,
            uv_scale=0.62,
            uv_offset=(0.42 + 0.12 * sx, 0.52),
        )

    # Narrow Cast-Metal Edging (`mats["iron"]`) wrapping the front faceplate perimeter
    edge_t = 0.016
    wrap_d = 0.082
    make_box(
        f"{name_prefix}_cast_edge_top_face",
        (W_front + 0.006, 0.012, edge_t),
        (0.0, Y_front - 0.036, H_front * 0.5 - edge_t * 0.5),
        mats["iron"],
        bevel_width=0.003,
        parent=root,
    )
    make_box(
        f"{name_prefix}_cast_edge_top_return",
        (W_front + 0.006, wrap_d, 0.012),
        (0.0, Y_front - 0.001, H_front * 0.5 + 0.002),
        mats["iron"],
        bevel_width=0.003,
        parent=root,
    )
    make_box(
        f"{name_prefix}_cast_edge_bot_face",
        (W_front + 0.006, 0.012, edge_t),
        (0.0, Y_front - 0.036, -H_front * 0.5 + edge_t * 0.5),
        mats["iron"],
        bevel_width=0.003,
        parent=root,
    )
    make_box(
        f"{name_prefix}_cast_edge_bot_return",
        (W_front + 0.006, wrap_d, 0.012),
        (0.0, Y_front - 0.001, -H_front * 0.5 - 0.002),
        mats["iron"],
        bevel_width=0.003,
        parent=root,
    )
    for sx, tag in [(-1.0, "L"), (1.0, "R")]:
        make_box(
            f"{name_prefix}_cast_edge_side_face_{tag}",
            (edge_t, 0.012, H_front + 0.006),
            (sx * (W_front * 0.5 - edge_t * 0.5), Y_front - 0.036, 0.0),
            mats["iron"],
            bevel_width=0.003,
            parent=root,
        )
        make_box(
            f"{name_prefix}_cast_edge_side_return_{tag}",
            (0.012, wrap_d, H_front + 0.006),
            (sx * (W_front * 0.5 + 0.002), Y_front - 0.001, 0.0),
            mats["iron"],
            bevel_width=0.003,
            parent=root,
        )

    # Corner cast-iron miter gussets with physical inset slotted screws
    for sx, x_tag in [(-1.0, "L"), (1.0, "R")]:
        for sz, z_tag in [(-1.0, "B"), (1.0, "T")]:
            gx = sx * (W_front * 0.5 - 0.044)
            gz = sz * (H_front * 0.5 - 0.042)
            make_box(
                f"{name_prefix}_cast_gusset_{z_tag}{x_tag}",
                (0.088, 0.014, 0.084),
                (gx, Y_front - 0.038, gz),
                mats["iron"],
                bevel_width=0.004,
                parent=root,
            )
            add_slotted_screw(
                f"{name_prefix}_gusset_screw_{z_tag}{x_tag}",
                (gx - sx * 0.014, Y_front - 0.044, gz - sz * 0.012),
                radius=0.009,
                depth=0.008,
                mat=mats["brass"],
                parent=root,
                axis="Y",
                slot_angle=0.35 * sx * sz,
            )

    # -------------------------------------------------------------------------
    # 2. CARCASS WALLS, CLIMBABLE TOP RIM & REAR CORNER JOINERY
    # -------------------------------------------------------------------------
    make_box(
        f"{name_prefix}_wall_left",
        (T, D - T, H),
        (-W * 0.5 + T * 0.5, 0.0, 0.0),
        mats["lacquer"],
        bevel_width=0.010,
        parent=root,
        uv_scale=0.68,
        uv_offset=(0.15, 0.25),
    )
    make_box(
        f"{name_prefix}_wall_right",
        (T, D - T, H),
        (W * 0.5 - T * 0.5, 0.0, 0.0),
        mats["lacquer"],
        bevel_width=0.010,
        parent=root,
        uv_scale=0.68,
        uv_offset=(0.45, 0.55),
    )
    make_box(
        f"{name_prefix}_wall_back",
        (W - T * 1.5, T, H),
        (0.0, D * 0.5 - T * 0.5, 0.0),
        mats["lacquer"],
        bevel_width=0.010,
        parent=root,
        uv_scale=0.68,
        uv_offset=(0.30, 0.10),
    )
    make_box(
        f"{name_prefix}_bottom_slab",
        (W - T * 1.6, D - T * 1.6, T),
        (0.0, 0.0, -H * 0.5 + T * 0.5),
        mats["lacquer"],
        bevel_width=0.008,
        parent=root,
        uv_scale=0.65,
    )

    # Moulded top coping rail along side walls for clean foothold silhouette
    for sx, tag in [(-1.0, "L"), (1.0, "R")]:
        make_box(
            f"{name_prefix}_wall_coping_{tag}",
            (T + 0.014, D - T * 1.2, 0.024),
            (sx * (W * 0.5 - T * 0.5), 0.02, H * 0.5 - 0.010),
            mats["lacquer"],
            bevel_width=0.006,
            parent=root,
            uv_scale=0.72,
            uv_offset=(0.22 * sx, 0.40),
        )
        # Rear cast-iron corner reinforcement brackets
        for sz, z_tag in [(-1.0, "low"), (1.0, "high")]:
            make_box(
                f"{name_prefix}_rear_corner_strap_{tag}_{z_tag}",
                (0.016, 0.11, 0.068),
                (sx * (W * 0.5 + 0.004), D * 0.5 - 0.06, sz * 0.18),
                mats["iron"],
                bevel_width=0.003,
                parent=root,
            )

    # -------------------------------------------------------------------------
    # 3. INTERIOR BURGUNDY BAIZE LINING & HARDWOOD RETAINING BATTENS
    # -------------------------------------------------------------------------
    baize_floor = make_box(
        f"{name_prefix}_baize_floor",
        (W - T * 2.2, D - T * 2.2, 0.028),
        (0.0, 0.0, -H * 0.5 + T + 0.014),
        mats["lining"],
        bevel_width=0.005,
        parent=root,
        uv_scale=2.6,
        uv_offset=(0.15, 0.25),
    )
    for sx, side_tag in [(-1.0, "L"), (1.0, "R")]:
        make_box(
            f"{name_prefix}_baize_side_{side_tag}",
            (0.020, D - T * 2.4, H * 0.64),
            (sx * (W * 0.5 - T - 0.011), 0.0, -0.028),
            mats["lining"],
            bevel_width=0.004,
            parent=root,
            uv_scale=2.8,
            uv_offset=(0.35 * sx, 0.48),
            swap_uv=True,
        )
        # Hardwood retaining batten capping the top of each side baize pad
        make_box(
            f"{name_prefix}_baize_cap_rail_{side_tag}",
            (0.028, D - T * 2.3, 0.026),
            (sx * (W * 0.5 - T - 0.014), 0.0, 0.182),
            mats["lacquer"],
            bevel_width=0.005,
            parent=root,
            uv_scale=0.80,
            uv_offset=(0.12 * sx, 0.66),
        )

    make_box(
        f"{name_prefix}_baize_back",
        (W - T * 2.4, 0.020, H * 0.64),
        (0.0, D * 0.5 - T - 0.011, -0.028),
        mats["lining"],
        bevel_width=0.004,
        parent=root,
        uv_scale=2.8,
        uv_offset=(0.55, 0.18),
    )
    make_box(
        f"{name_prefix}_baize_cap_rail_back",
        (W - T * 2.3, 0.028, 0.026),
        (0.0, D * 0.5 - T - 0.014, 0.182),
        mats["lacquer"],
        bevel_width=0.005,
        parent=root,
        uv_scale=0.80,
        uv_offset=(0.44, 0.33),
    )

    # Low-profile interior floor perimeter battens & two transverse compartment cleats
    for ny_cleat in [-0.34, 0.34]:
        make_box(
            f"{name_prefix}_interior_cleat_{ny_cleat:+.2f}",
            (W - T * 2.5, 0.034, 0.014),
            (0.0, ny_cleat, -H * 0.5 + T + 0.032),
            mats["lacquer"],
            bevel_width=0.003,
            parent=root,
            uv_scale=0.85,
        )

    # -------------------------------------------------------------------------
    # 4. READABLE RECESSED CARD HOLDER WITH INSET SCREW SLOTS
    # -------------------------------------------------------------------------
    card_z = 0.152
    # Cast-iron mounting backplate seated on the upper center frieze
    make_box(
        f"{name_prefix}_card_backplate",
        (0.415, 0.014, 0.178),
        (0.0, Y_front - 0.034, card_z),
        mats["iron"],
        bevel_width=0.004,
        parent=root,
    )
    # Recessed cream/ochre archival index card bed (mapped to clean fine-grain UV region)
    card_inset = make_box(
        f"{name_prefix}_card_plaque_inset",
        (0.325, 0.008, 0.112),
        (0.0, Y_front - 0.041, card_z),
        mats["canvas"],
        bevel_width=0.002,
        parent=root,
    )
    apply_planar_region_uvs(card_inset, u_range=(0.38, 0.62), v_range=(0.38, 0.62))

    # Deep 4-sided brass keeper bezel overhanging the recessed card bed by 14mm
    # Keep `card_frame` name on the primary lower/outer bezel rail and parent/join frame bars cleanly
    make_box(
        f"{name_prefix}_card_frame",
        (0.386, 0.018, 0.024),
        (0.0, Y_front - 0.050, card_z - 0.062),
        mats["brass"],
        bevel_width=0.004,
        parent=root,
    )
    for sx, tag in [(-1.0, "L"), (1.0, "R")]:
        # Split top hood rail leaving a central thumb-notch card insertion slot
        make_box(
            f"{name_prefix}_card_frame_top_{tag}",
            (0.148, 0.018, 0.022),
            (sx * 0.119, Y_front - 0.050, card_z + 0.062),
            mats["brass"],
            bevel_width=0.004,
            parent=root,
        )
        # Side vertical keeper rails with inner card-channel lip
        make_box(
            f"{name_prefix}_card_frame_side_{tag}",
            (0.034, 0.018, 0.148),
            (sx * 0.176, Y_front - 0.050, card_z),
            mats["brass"],
            bevel_width=0.004,
            parent=root,
        )
        for sz, z_tag in [(-1.0, "B"), (1.0, "T")]:
            add_slotted_screw(
                f"{name_prefix}_card_screw_{z_tag}{tag}",
                (sx * 0.176, Y_front - 0.058, card_z + sz * 0.058),
                radius=0.0075,
                depth=0.007,
                mat=mats["brass"],
                parent=root,
                axis="Y",
                slot_angle=0.5 * sx,
            )

    # -------------------------------------------------------------------------
    # 5. TWIN TURNED BRASS PULL HANDLES WITH STANDOFF ESCUTCHEONS & BOLT HEADS
    # -------------------------------------------------------------------------
    handle_z = -0.116
    for hx, h_tag in [(-0.368, "L"), (0.368, "R")]:
        # Turned multi-section grip bar
        make_cyl(
            f"{name_prefix}_handle_bar_{h_tag}",
            0.015,
            0.355,
            (hx, Y_front - 0.112, handle_z),
            (0.0, math.pi * 0.5, 0.0),
            mats["brass"],
            vertices=32,
            parent=root,
        )
        # Central swelled barrel hand-grip sleeve
        make_cyl(
            f"{name_prefix}_handle_grip_barrel_{h_tag}",
            0.023,
            0.165,
            (hx, Y_front - 0.112, handle_z),
            (0.0, math.pi * 0.5, 0.0),
            mats["brass"],
            vertices=32,
            bevel_ratio=0.14,
            parent=root,
        )
        # Twin turned ring ferrules flanking the swelled barrel
        for fx, f_tag in [(-0.092, "L"), (0.092, "R")]:
            make_cyl(
                f"{name_prefix}_handle_ferrule_{h_tag}_{f_tag}",
                0.026,
                0.015,
                (hx + fx, Y_front - 0.112, handle_z),
                (0.0, math.pi * 0.5, 0.0),
                mats["brass"],
                vertices=32,
                bevel_ratio=0.18,
                parent=root,
            )
        # Outer hex end-cap nuts securing the bar outside the standoff knuckles
        for ex, e_tag in [(-0.182, "L"), (0.182, "R")]:
            make_cyl(
                f"{name_prefix}_handle_end_nut_{h_tag}_{e_tag}",
                0.019,
                0.016,
                (hx + ex, Y_front - 0.112, handle_z),
                (0.0, math.pi * 0.5, 0.0),
                mats["iron"],
                vertices=6,
                bevel_ratio=0.12,
                parent=root,
            )

        # Separate standoff posts, clevis knuckles, cast-iron baseplates & hex bolt heads
        for sx in [-0.14, 0.14]:
            px = hx + sx
            # Cast-iron standoff escutcheon plate seated on the fielded panel
            make_box(
                f"{name_prefix}_handle_standoff_plate_{h_tag}_{sx:+.2f}",
                (0.058, 0.014, 0.086),
                (px, Y_front - 0.028, handle_z),
                mats["iron"],
                bevel_width=0.004,
                parent=root,
            )
            # Top & bottom hex mounting bolt heads on the standoff plate
            for bz, b_tag in [(-0.028, "B"), (0.028, "T")]:
                make_cyl(
                    f"{name_prefix}_handle_bolt_{h_tag}_{sx:+.2f}_{b_tag}",
                    0.0085,
                    0.009,
                    (px, Y_front - 0.036, handle_z + bz),
                    (math.pi * 0.5, 0.0, 0.0),
                    mats["brass"],
                    vertices=6,
                    bevel_ratio=0.12,
                    parent=root,
                )
            # Turned brass base collar / rosette
            make_cyl(
                f"{name_prefix}_handle_collar_{h_tag}_{sx:+.2f}",
                0.022,
                0.016,
                (px, Y_front - 0.041, handle_z),
                (math.pi * 0.5, 0.0, 0.0),
                mats["brass"],
                vertices=28,
                bevel_ratio=0.15,
                parent=root,
            )
            # Main standoff shaft (preserves `handle_post` role name)
            make_cyl(
                f"{name_prefix}_handle_post_{h_tag}_{sx:+.2f}",
                0.014,
                0.072,
                (px, Y_front - 0.076, handle_z),
                (math.pi * 0.5, 0.0, 0.0),
                mats["brass"],
                vertices=28,
                parent=root,
            )
            # Front clevis knuckle boss wrapping the grip bar
            make_cyl(
                f"{name_prefix}_handle_knuckle_{h_tag}_{sx:+.2f}",
                0.023,
                0.030,
                (px, Y_front - 0.112, handle_z),
                (0.0, math.pi * 0.5, 0.0),
                mats["brass"],
                vertices=28,
                bevel_ratio=0.14,
                parent=root,
            )

    # -------------------------------------------------------------------------
    # 6. SIDE RAIL C-CHANNELS, PRECISION NOTCH RACKS & FLANGED ROLLERS
    # -------------------------------------------------------------------------
    for sx, side_tag in [(-1.0, "L"), (1.0, "R")]:
        wall_outer_x = sx * (W * 0.5)
        rail_x = sx * (W * 0.5 + 0.032)

        # Cast-iron C-channel structural rail housing (`mats["iron"]`)
        make_box(
            f"{name_prefix}_rail_channel_web_{side_tag}",
            (0.018, D - 0.08, 0.112),
            (wall_outer_x + sx * 0.009, 0.0, -0.064),
            mats["iron"],
            bevel_width=0.004,
            parent=root,
        )
        make_box(
            f"{name_prefix}_rail_flange_top_{side_tag}",
            (0.048, D - 0.08, 0.018),
            (wall_outer_x + sx * 0.024, 0.0, -0.016),
            mats["iron"],
            bevel_width=0.004,
            parent=root,
        )
        make_box(
            f"{name_prefix}_rail_flange_bot_{side_tag}",
            (0.048, D - 0.08, 0.018),
            (wall_outer_x + sx * 0.024, 0.0, -0.112),
            mats["iron"],
            bevel_width=0.004,
            parent=root,
        )
        # Inner guide track runner bar inside the C-channel recess
        make_box(
            f"{name_prefix}_rail_inner_runner_{side_tag}",
            (0.022, D - 0.14, 0.038),
            (wall_outer_x + sx * 0.028, 0.0, -0.064),
            mats["brass"],
            bevel_width=0.004,
            parent=root,
        )
        # Channel mounting bolts along the recessed web
        for by in [-0.82, -0.25, 0.35, 0.82]:
            make_cyl(
                f"{name_prefix}_rail_web_bolt_{side_tag}_{by:+.2f}",
                0.009,
                0.012,
                (wall_outer_x + sx * 0.020, by, -0.064),
                (0.0, math.pi * 0.5, 0.0),
                mats["iron"],
                vertices=6,
                parent=root,
            )

        # Machined Brass Notch Rack Bar seated atop the upper channel flange (preserves `notch_bar` name)
        make_box(
            f"{name_prefix}_notch_bar_{side_tag}",
            (0.034, D - 0.10, 0.024),
            (rail_x, 0.0, 0.004),
            mats["brass"],
            bevel_width=0.004,
            parent=root,
        )

        # Three physical notch pockets + arrest dog teeth + iron strike plates at ny in [-0.55, 0.10, 0.72]
        for n_idx, ny in enumerate([-0.55, 0.10, 0.72]):
            # Rear arrest tooth (preserves `notch_tooth` role name)
            make_box(
                f"{name_prefix}_notch_tooth_{side_tag}_{n_idx}",
                (0.048, 0.054, 0.048),
                (rail_x, ny + 0.032, 0.032),
                mats["brass"],
                bevel_width=0.004,
                parent=root,
            )
            # Forward guide shoulder defining the front wall of the physical notch pocket
            make_box(
                f"{name_prefix}_notch_shoulder_{side_tag}_{n_idx}",
                (0.044, 0.038, 0.034),
                (rail_x, ny - 0.038, 0.025),
                mats["brass"],
                bevel_width=0.004,
                parent=root,
            )
            # Hardened cast-iron strike face plate inside the notch pocket
            make_box(
                f"{name_prefix}_notch_strike_{side_tag}_{n_idx}",
                (0.052, 0.014, 0.042),
                (rail_x, ny + 0.002, 0.029),
                mats["iron"],
                bevel_width=0.002,
                parent=root,
            )

        # Two Flanged Guide Rollers per side with Yoke Bracket, Rim Flanges, Web, Hub Boss & Separate Axle
        for r_idx, ry in enumerate([-0.68, 0.68]):
            rx = rail_x + sx * 0.018
            rz = -0.162
            # Cast-iron hanger yoke bracket connecting bottom rail flange down to roller axle
            make_box(
                f"{name_prefix}_roller_yoke_{side_tag}_{r_idx}",
                (0.036, 0.092, 0.068),
                (wall_outer_x + sx * 0.020, ry, -0.136),
                mats["iron"],
                bevel_width=0.004,
                parent=root,
            )
            # Main roller tread cylinder (preserves `roller` role name)
            make_cyl(
                f"{name_prefix}_roller_{side_tag}_{r_idx}",
                0.052,
                0.038,
                (rx, ry, rz),
                (0.0, math.pi * 0.5, 0.0),
                mats["brass"],
                vertices=40,
                bevel_ratio=0.06,
                parent=root,
            )
            # Inner & outer raised railway wheel flanges
            for fx_off, f_tag in [(-0.018, "in"), (0.018, "out")]:
                make_cyl(
                    f"{name_prefix}_roller_flange_{f_tag}_{side_tag}_{r_idx}",
                    0.068,
                    0.009,
                    (rx + sx * fx_off, ry, rz),
                    (0.0, math.pi * 0.5, 0.0),
                    mats["brass"],
                    vertices=40,
                    bevel_ratio=0.12,
                    parent=root,
                )
            # Recessed dark cast-iron wheel web disc separating outer rim from central hub
            make_cyl(
                f"{name_prefix}_roller_web_{side_tag}_{r_idx}",
                0.041,
                0.049,
                (rx, ry, rz),
                (0.0, math.pi * 0.5, 0.0),
                mats["iron"],
                vertices=32,
                bevel_ratio=0.05,
                parent=root,
            )
            # Raised machined brass hub boss
            make_cyl(
                f"{name_prefix}_roller_hub_{side_tag}_{r_idx}",
                0.024,
                0.058,
                (rx + sx * 0.003, ry, rz),
                (0.0, math.pi * 0.5, 0.0),
                mats["brass"],
                vertices=28,
                bevel_ratio=0.10,
                parent=root,
            )
            # Separate steel/iron axle shaft & outer hex locknut protruding through hub center
            make_cyl(
                f"{name_prefix}_roller_axle_{side_tag}_{r_idx}",
                0.012,
                0.074,
                (rx + sx * 0.006, ry, rz),
                (0.0, math.pi * 0.5, 0.0),
                mats["iron"],
                vertices=16,
                bevel_ratio=0.08,
                parent=root,
            )
            make_cyl(
                f"{name_prefix}_roller_locknut_{side_tag}_{r_idx}",
                0.018,
                0.012,
                (rx + sx * 0.036, ry, rz),
                (0.0, math.pi * 0.5, 0.0),
                mats["iron"],
                vertices=6,
                bevel_ratio=0.12,
                parent=root,
            )

    # -------------------------------------------------------------------------
    # 7. PIVOTING LATCH PAWL, CLEVIS MOUNT & STRIKE RELATIONSHIP (RIGHT FRONT RAIL)
    # -------------------------------------------------------------------------
    # All parts of this assembly include `latch_pawl` in their name so runtime `scene.js`
    # detaches the whole assembly cleanly while Blender proofs show complete mechanical engagement
    # into the front notch pocket (`ny = -0.55`).
    lx = W * 0.5 + 0.032
    # Cast-iron twin-ear pivot clevis straddling the rail ahead of the first notch
    for cx_off, c_tag in [(-0.022, "in"), (0.022, "out")]:
        make_box(
            f"{name_prefix}_latch_pawl_clevis_{c_tag}",
            (0.010, 0.054, 0.068),
            (lx + cx_off, -0.72, 0.044),
            mats["iron"],
            bevel_width=0.003,
            parent=root,
        )
    # Horizontal brass pivot pin & retaining collar passing through the clevis ears
    make_cyl(
        f"{name_prefix}_latch_pawl_pin",
        0.013,
        0.066,
        (lx, -0.72, 0.062),
        (0.0, math.pi * 0.5, 0.0),
        mats["brass"],
        vertices=24,
        parent=root,
    )
    # Pivoting brass latch pawl arm spanning from pivot (-0.72) back to the first notch pocket (-0.55)
    make_box(
        f"{name_prefix}_latch_pawl",
        (0.032, 0.205, 0.034),
        (lx, -0.635, 0.062),
        mats["brass"],
        bevel_width=0.005,
        rot_xyz=(math.radians(-4.0), 0.0, 0.0),
        parent=root,
    )
    # Downward-hooked arrest dog tooth seated directly inside the ny = -0.55 strike pocket
    make_box(
        f"{name_prefix}_latch_pawl_dog",
        (0.030, 0.032, 0.048),
        (lx, -0.552, 0.034),
        mats["brass"],
        bevel_width=0.004,
        parent=root,
    )
    # Forward-projecting operator lift handle & counterweight knob
    make_cyl(
        f"{name_prefix}_latch_pawl_handle",
        0.009,
        0.085,
        (lx, -0.765, 0.076),
        (math.radians(68.0), 0.0, 0.0),
        mats["brass"],
        vertices=20,
        parent=root,
    )
    make_cyl(
        f"{name_prefix}_latch_pawl_knob",
        0.016,
        0.024,
        (lx, -0.802, 0.091),
        (math.radians(68.0), 0.0, 0.0),
        mats["brass"],
        vertices=24,
        bevel_ratio=0.22,
        parent=root,
    )

    return root
