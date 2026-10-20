import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = argv[0] if argv else "footballer.glb"
PREVIEW = argv[1] if len(argv) > 1 else ""

REGION = {
    "skin": 0,
    "shirt": 1,
    "shorts": 2,
    "socks": 3,
    "boots": 4,
    "arm": 5,
    "hand": 6,
    "hair": 7,
    "eyewhite": 8,
    "iris": 9,
    "lips": 10,
    "brow": 11,
    "head": 12,
}

PREVIEW_COLORS = {
    0: (0.78, 0.55, 0.42),
    1: (0.62, 0.05, 0.22),
    2: (0.05, 0.18, 0.55),
    3: (0.62, 0.05, 0.22),
    4: (0.05, 0.05, 0.05),
    5: (0.78, 0.55, 0.42),
    6: (0.78, 0.55, 0.42),
    7: (0.08, 0.05, 0.03),
    8: (0.95, 0.95, 0.95),
    9: (0.1, 0.07, 0.05),
    10: (0.62, 0.35, 0.32),
    11: (0.08, 0.05, 0.03),
    12: (0.8, 0.57, 0.44),
}

ARM_ANGLE = math.radians(40)
HEAD_C = Vector((0.0, 0.014, 1.664))
HEAD_R = Vector((0.08, 0.099, 0.119))


def clamp(v, a, b):
    return max(a, min(b, v))


def smooth(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def gauss(dx, dz, sx, sz):
    return math.exp(-((dx / sx) ** 2 + (dz / sz) ** 2))


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def set_regions(mesh, region_of_face):
    uv = mesh.uv_layers.get("Region") or mesh.uv_layers.new(name="Region")
    for poly in mesh.polygons:
        region = region_of_face(poly)
        for li in poly.loop_indices:
            uv.data[li].uv = (region + 0.5, 0.5)


def region_all(mesh, region):
    set_regions(mesh, lambda _poly: region)


def bm_to_object(bm, name):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh))
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


def apply_modifiers(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated)
    obj.modifiers.clear()
    old = obj.data
    obj.data = mesh
    bpy.data.meshes.remove(old)


def add_subsurf(obj, levels):
    mod = obj.modifiers.new("Sub", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    mod.uv_smooth = "NONE"
    return mod


def seg_dist(p, a, b):
    ab = b - a
    t = clamp((p - a).dot(ab) / max(ab.length_squared, 1e-9), 0.0, 1.0)
    return (a + ab * t - p).length, t


def arm_dir(side):
    return Vector((side * math.sin(ARM_ANGLE), 0.0, -math.cos(ARM_ANGLE)))


def body_graph():
    verts, radii, edges = [], [], []
    chains = []

    def v(p, r):
        verts.append(Vector(p))
        radii.append(r if isinstance(r, tuple) else (r, r))
        return len(verts) - 1

    pelvis = v((0.0, 0.008, 0.965), (0.152, 0.106))
    waist = v((0.0, 0.002, 1.085), (0.13, 0.09))
    chest = v((0.0, -0.008, 1.255), (0.162, 0.108))
    upchest = v((0.0, 0.0, 1.372), (0.172, 0.1))
    trap = v((0.0, 0.012, 1.452), (0.112, 0.076))
    neck = v((0.0, 0.012, 1.512), (0.058, 0.06))
    neck_top = v((0.0, 0.008, 1.585), (0.054, 0.056))
    torso = [pelvis, waist, chest, upchest, trap]
    for a, b in zip(torso, torso[1:]):
        edges.append((a, b))
    edges += [(trap, neck), (neck, neck_top)]
    chains.append(("torso", torso))
    chains.append(("neck", [trap, neck, neck_top]))

    for side, tag in ((1, "L"), (-1, "R")):
        hip = v((side * 0.092, 0.004, 0.915), (0.098, 0.1))
        thigh = v((side * 0.098, -0.006, 0.73), (0.09, 0.095))
        knee = v((side * 0.099, -0.006, 0.505), (0.055, 0.059))
        calf = v((side * 0.099, 0.02, 0.37), (0.065, 0.074))
        shin = v((side * 0.099, 0.008, 0.21), (0.042, 0.045))
        ankle = v((side * 0.099, 0.004, 0.095), (0.031, 0.034))
        leg = [hip, thigh, knee, calf, shin, ankle]
        edges.append((pelvis, hip))
        for a, b in zip(leg, leg[1:]):
            edges.append((a, b))
        chains.append(("hipjoin", [pelvis, hip]))
        chains.append(("leg", leg))

        d = arm_dir(side)
        sp = Vector((side * 0.188, 0.004, 1.418))
        shoulder = v(sp, (0.066, 0.066))
        deltoid = v(sp + d * 0.06, (0.064, 0.063))
        bicep = v(sp + d * 0.15, (0.055, 0.057))
        elbow = v(sp + d * 0.285, (0.041, 0.042))
        forearm = v(sp + d * 0.36, (0.049, 0.045))
        wrist = v(sp + d * 0.54, (0.028, 0.024))
        palm = v(sp + d * 0.61, (0.034, 0.028))
        fingers = v(sp + d * 0.70, (0.023, 0.02))
        arm = [shoulder, deltoid, bicep, elbow, forearm, wrist, palm, fingers]
        edges.append((upchest, shoulder))
        for a, b in zip(arm, arm[1:]):
            edges.append((a, b))
        chains.append(("armjoin", [upchest, shoulder]))
        chains.append(("arm", arm))
    return verts, radii, edges, chains


def build_body():
    verts, radii, edges, chains = body_graph()
    mesh = bpy.data.meshes.new("Body")
    mesh.from_pydata([tuple(p) for p in verts], edges, [])
    obj = link(bpy.data.objects.new("Body", mesh))
    skin = obj.modifiers.new("Skin", "SKIN")
    skin.branch_smoothing = 0.35
    skin.use_smooth_shade = True
    for i, r in enumerate(radii):
        sv = mesh.skin_vertices[0].data[i]
        sv.radius = r
        sv.use_root = i == 0
    add_subsurf(obj, 2)
    apply_modifiers(obj)
    for poly in obj.data.polygons:
        poly.use_smooth = True

    chain_data = []
    for name, idx in chains:
        pts = [verts[i] for i in idx]
        rad = [sum(radii[i]) / 2 for i in idx]
        cum = [0.0]
        for a, b in zip(pts, pts[1:]):
            cum.append(cum[-1] + (b - a).length)
        chain_data.append((name, pts, rad, cum))

    def classify(p):
        best = None
        for name, pts, rad, cum in chain_data:
            for i in range(len(pts) - 1):
                d, t = seg_dist(p, pts[i], pts[i + 1])
                r = rad[i] + (rad[i + 1] - rad[i]) * t
                score = d - r
                if best is None or score < best[0]:
                    best = (score, name, cum[i] + (cum[i + 1] - cum[i]) * t)
        return best[1], best[2]

    def region_of(poly):
        c = poly.center
        name, s = classify(c)
        if name == "torso":
            return REGION["shorts"] if c.z < 1.012 else REGION["shirt"]
        if name == "neck":
            return REGION["shirt"] if c.z < 1.488 else REGION["skin"]
        if name == "hipjoin":
            return REGION["shorts"]
        if name == "armjoin":
            return REGION["shirt"]
        if name == "leg":
            if s < 0.255:
                return REGION["shorts"]
            if s < 0.47:
                return REGION["skin"]
            return REGION["socks"]
        if name == "arm":
            if s < 0.185:
                return REGION["shirt"]
            if s < 0.53:
                return REGION["arm"]
            return REGION["hand"]
        return REGION["skin"]

    set_regions(obj.data, region_of)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv["Region"]
    bm.normal_update()
    push = {}
    for vert in bm.verts:
        regions = set()
        for loop in vert.link_loops:
            regions.add(int(loop[uv].uv.x))
        amount = 0.0
        if regions == {REGION["shirt"]}:
            amount = 0.006
        elif REGION["shirt"] in regions:
            amount = 0.003
        if regions == {REGION["shorts"]}:
            amount = 0.01
        elif REGION["shorts"] in regions and REGION["shirt"] not in regions:
            amount = 0.005
        if regions == {REGION["socks"]}:
            amount = 0.0025
        if amount:
            push[vert] = vert.normal * amount
    for vert, offset in push.items():
        vert.co += offset
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def head_shape(co, face=True):
    rel = co - HEAD_C
    x, y, z = rel.x, rel.y, rel.z
    nz = z / HEAD_R.z
    ny = y / HEAD_R.y
    k = smooth(0.15, -1.0, nz)
    x *= 1.0 - 0.2 * k
    if y > 0:
        y *= 1.0 - 0.34 * k
    else:
        y *= 1.0 - 0.08 * k
    chin = smooth(-0.55, -0.95, nz)
    x *= 1.0 + 0.08 * chin
    if ny > 0 and nz > -0.2:
        y *= 1.05
    if ny < -0.4 and nz > 0.35:
        y *= 0.97
    if face and ny < 0:
        front = smooth(0.0, -0.75, ny)
        for sx in (-1, 1):
            y += 0.0072 * gauss(x - sx * 0.031, z - 0.0, 0.015, 0.011) * front
            y -= 0.0042 * gauss(x - sx * 0.030, z - 0.021, 0.02, 0.006) * front
            x += sx * 0.004 * gauss(x - sx * 0.05, z + 0.012, 0.018, 0.016) * front
        tip = smooth(0.012, -0.028, z) if z > -0.03 else math.exp(-(((z + 0.03) / 0.0055) ** 2))
        width = 0.0085 + 0.0075 * smooth(0.0, -0.03, z)
        y -= 0.024 * tip * math.exp(-((x / width) ** 2)) * front
        y -= 0.0042 * gauss(x, z + 0.052, 0.02, 0.009) * front
        y += 0.0018 * gauss(x, z + 0.0525, 0.022, 0.0022) * front
        y -= 0.0065 * gauss(x, z + 0.094, 0.025, 0.014) * front
    return HEAD_C + Vector((x, y, z))


def sphere_bm(segments, rings):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    return bm


def head_bm(face=True, segments=40, rings=28):
    bm = sphere_bm(segments, rings)
    for vert in bm.verts:
        p = Vector((vert.co.x * HEAD_R.x, vert.co.y * HEAD_R.y, vert.co.z * HEAD_R.z)) + HEAD_C
        vert.co = head_shape(p, face)
    return bm


def surface_y(bm, x, z):
    best = None
    for vert in bm.verts:
        rel = vert.co - HEAD_C
        if rel.y > 0:
            continue
        d = (rel.x - x) ** 2 + (rel.z - z) ** 2
        if best is None or d < best[0]:
            best = (d, vert.co.y)
    return best[1]


def add_sphere(bm, center, radius, scale=(1, 1, 1), segments=12, rings=8):
    geom = bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    verts = geom["verts"]
    for vert in verts:
        vert.co = Vector((vert.co.x * radius * scale[0], vert.co.y * radius * scale[1], vert.co.z * radius * scale[2])) + Vector(center)
    return verts


def build_head():
    bm = head_bm(True)
    groups = {"head": list(bm.verts)}
    region_tags = {}

    def tag(verts, region):
        for vert in verts:
            region_tags[vert] = region

    for sx in (-1, 1):
        ear = add_sphere(bm, (sx * 0.077, HEAD_C.y + 0.012, HEAD_C.z - 0.004), 1.0, (0.01, 0.02, 0.028), 12, 8)
        rot = Matrix.Rotation(sx * -0.25, 3, "Z")
        center = Vector((sx * 0.077, HEAD_C.y + 0.012, HEAD_C.z - 0.004))
        for vert in ear:
            vert.co = center + rot @ (vert.co - center)
        tag(ear, REGION["head"])

        ex = sx * 0.031
        surf = surface_y(bm, ex, 0.0)
        eye_c = (ex, surf + 0.0086, HEAD_C.z + 0.0)
        eye = add_sphere(bm, eye_c, 0.0124, (1, 1, 0.9), 14, 10)
        tag(eye, REGION["eyewhite"])
        iris = add_sphere(bm, (ex, eye_c[1] - 0.0108, eye_c[2]), 0.007, (1, 0.35, 1), 12, 8)
        tag(iris, REGION["iris"])

        by = surface_y(bm, sx * 0.03, 0.021)
        brow = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        for vert in brow:
            vert.co = Vector((vert.co.x * 0.03 + sx * 0.031, vert.co.y * 0.006 + by - 0.0015, vert.co.z * 0.0055 + HEAD_C.z + 0.022))
        tag(brow, REGION["brow"])

    mesh = bpy.data.meshes.new("Head")
    bm.to_mesh(mesh)
    lookup = {}
    for i, vert in enumerate(bm.verts):
        lookup[i] = region_tags.get(vert, None)
    bm.free()
    obj = link(bpy.data.objects.new("Head", mesh))
    for poly in mesh.polygons:
        poly.use_smooth = True

    def region_of(poly):
        first = lookup.get(poly.vertices[0])
        if first is not None:
            return first
        return REGION["head"]

    set_regions(mesh, region_of)
    group = obj.vertex_groups.new(name="head")
    group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
    add_subsurf(obj, 1)
    apply_modifiers(obj)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def build_boot(side, tag):
    bm = sphere_bm(20, 12)
    cx = side * 0.098
    for vert in bm.verts:
        p = vert.co.copy()
        x = p.x * 0.05
        y = p.y * 0.132
        z = p.z * 0.055
        if p.y < -0.2:
            z *= 1.0 - 0.45 * smooth(-0.2, -1.0, p.y)
            x *= 1.0 - 0.18 * smooth(-0.3, -1.0, p.y)
        if p.y > 0.6:
            z *= 1.0 + 0.2 * smooth(0.6, 1.0, p.y)
        vert.co = Vector((cx + x, -0.042 + y, 0.05 + z))
        if vert.co.z < 0.004:
            vert.co.z = 0.004
    collar = bmesh.ops.create_cone(bm, cap_ends=False, segments=16, radius1=0.042, radius2=0.037, depth=0.06)["verts"]
    for vert in collar:
        vert.co += Vector((cx, 0.004, 0.085))
    obj = bm_to_object(bm, f"Boot.{tag}")
    region_all(obj.data, REGION["boots"])
    group = obj.vertex_groups.new(name=f"foot.{tag}")
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    add_subsurf(obj, 1)
    apply_modifiers(obj)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def build_rig():
    arm = bpy.data.armatures.new("Rig")
    rig = link(bpy.data.objects.new("Rig", arm))
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    def bone(name, head, tail, parent=None, connect=False):
        eb = arm.edit_bones.new(name)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        eb.roll = 0.0
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = connect
        return eb

    bone("hips", (0, 0.005, 0.94), (0, 0.002, 1.06))
    bone("spine", (0, 0.002, 1.06), (0, -0.004, 1.22), "hips", True)
    bone("chest", (0, -0.004, 1.22), (0, 0.004, 1.43), "spine", True)
    bone("neck", (0, 0.012, 1.475), (0, 0.009, 1.575), "chest")
    bone("head", (0, 0.009, 1.575), (0, 0.0, 1.79), "neck", True)
    for side, tag in ((1, "L"), (-1, "R")):
        d = arm_dir(side)
        sp = Vector((side * 0.188, 0.004, 1.418))
        bone(f"shoulder.{tag}", (side * 0.03, 0.0, 1.43), sp, "chest")
        bone(f"upperarm.{tag}", sp, sp + d * 0.285, f"shoulder.{tag}", True)
        bone(f"forearm.{tag}", sp + d * 0.285, sp + d * 0.54, f"upperarm.{tag}", True)
        bone(f"hand.{tag}", sp + d * 0.54, sp + d * 0.70, f"forearm.{tag}", True)
        bone(f"thigh.{tag}", (side * 0.09, 0.004, 0.925), (side * 0.098, -0.006, 0.505), "hips")
        bone(f"shin.{tag}", (side * 0.098, -0.006, 0.505), (side * 0.098, 0.004, 0.09), f"thigh.{tag}", True)
        bone(f"foot.{tag}", (side * 0.098, 0.004, 0.09), (side * 0.098, -0.15, 0.025), f"shin.{tag}", True)
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def skull_bm():
    return head_bm(True, 48, 34)


def hairline(rel):
    ang = abs(math.atan2(rel.x, -rel.y))
    if ang < math.pi / 2:
        return 0.062 + (0.012 - 0.062) * (ang / (math.pi / 2)) ** 1.4
    return 0.012 + (-0.07 - 0.012) * ((ang - math.pi / 2) / (math.pi / 2)) ** 0.9


def hair_cap(offset, top, noise_amp=0.0, noise_scale=40.0, front_lift=0.0, back_sweep=0.0, line_shift=0.0, fringe=0.0):
    bm = skull_bm()
    kill = []
    for vert in bm.verts:
        rel = vert.co - HEAD_C
        if rel.z < hairline(rel) + line_shift - 0.03:
            kill.append(vert)
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    for vert in bm.verts:
        rel = vert.co - HEAD_C
        n = Vector((rel.x / HEAD_R.x**2, rel.y / HEAD_R.y**2, rel.z / HEAD_R.z**2)).normalized()
        above = rel.z - hairline(rel) - line_shift
        h = clamp(above / 0.11, 0.0, 1.0)
        d = offset + top * h**1.6
        if noise_amp:
            d += noise_amp * (0.5 + 0.5 * noise.noise(vert.co * noise_scale))
        front = clamp(-rel.y / HEAD_R.y, 0.0, 1.0)
        d += front_lift * front * h
        d = d * smooth(0.0, 0.022, above) - 0.005 * (1.0 - smooth(-0.014, 0.0, above))
        vert.co += n * d
        if back_sweep:
            vert.co.y += back_sweep * h * h
        if fringe and rel.y < -0.06 and rel.z > 0.03:
            vert.co.y -= fringe * smooth(0.03, 0.08, rel.z)
            vert.co.z -= fringe * 0.6 * smooth(0.05, 0.09, rel.z)
    return bm


def finish_hair(bm, name, thickness=0.006):
    obj = bm_to_object(bm, name)
    solid = obj.modifiers.new("Solid", "SOLIDIFY")
    solid.thickness = thickness
    solid.offset = -1.0
    add_subsurf(obj, 1)
    apply_modifiers(obj)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    region_all(obj.data, REGION["hair"])
    return obj


def merge_bm(target, extra_obj_bm):
    mesh = bpy.data.meshes.new("tmp")
    extra_obj_bm.to_mesh(mesh)
    extra_obj_bm.free()
    target.from_mesh(mesh)
    bpy.data.meshes.remove(mesh)


def build_hair_styles():
    styles = {}
    styles["short"] = finish_hair(hair_cap(0.005, 0.014, 0.0015, 55.0, 0.004), "hair_short")
    styles["crop"] = finish_hair(hair_cap(0.006, 0.02, 0.003, 50.0, 0.006, 0.0, 0.0, 0.012), "hair_crop")
    styles["slick"] = finish_hair(hair_cap(0.006, 0.02, 0.0008, 30.0, 0.012, 0.018), "hair_slick")
    styles["curly"] = finish_hair(hair_cap(0.008, 0.03, 0.009, 70.0, 0.006), "hair_curly", 0.008)
    styles["afro"] = finish_hair(hair_cap(0.014, 0.034, 0.016, 42.0, 0.008, 0.0, -0.006), "hair_afro", 0.012)

    bm = hair_cap(0.0055, 0.012, 0.001, 50.0, 0.004, 0.012)
    add_sphere(bm, (0.0, HEAD_C.y + 0.094, HEAD_C.z + 0.072), 1.0, (0.034, 0.03, 0.032), 14, 10)
    styles["bun"] = finish_hair(bm, "hair_bun")

    bm = hair_cap(0.008, 0.018, 0.004, 45.0, 0.006, 0.012)
    back = add_sphere(bm, (0.0, HEAD_C.y + 0.04, HEAD_C.z - 0.07), 1.0, (0.088, 0.07, 0.115), 18, 12)
    for vert in back:
        rel = vert.co - Vector((0.0, HEAD_C.y + 0.04, HEAD_C.z - 0.07))
        if rel.y < -0.02:
            vert.co.y = HEAD_C.y + 0.04 - 0.02 + (rel.y + 0.02) * 0.25
        vert.co += Vector((0, 0, 0)) + Vector((0, 0.004, 0)) * noise.noise(vert.co * 40.0)
    styles["long"] = finish_hair(bm, "hair_long", 0.008)

    bm = hair_cap(0.01, 0.03, 0.01, 60.0, 0.006, 0.01)
    back = add_sphere(bm, (0.0, HEAD_C.y + 0.035, HEAD_C.z - 0.06), 1.0, (0.092, 0.075, 0.11), 18, 12)
    for vert in back:
        rel = vert.co - Vector((0.0, HEAD_C.y + 0.035, HEAD_C.z - 0.06))
        if rel.y < -0.02:
            vert.co.y = HEAD_C.y + 0.035 - 0.02 + (rel.y + 0.02) * 0.25
        n = rel.normalized()
        vert.co += n * 0.01 * (0.5 + 0.5 * noise.noise(vert.co * 55.0))
    styles["longcurly"] = finish_hair(bm, "hair_longcurly", 0.01)

    def beard_inside(rel):
        ang = abs(math.atan2(rel.x, -rel.y))
        top = -0.032 + 0.024 * smooth(math.radians(25), math.radians(60), ang)
        e_top = (top - rel.z) / 0.012
        e_side = (math.radians(116) - ang) / math.radians(12)
        mouth = math.sqrt((rel.x / 0.019) ** 2 + ((rel.z + 0.0525) / 0.0085) ** 2) - 1.0
        e_mouth = mouth * 3.0 if rel.y < 0 else 5.0
        return min(e_top, e_side, e_mouth)

    bm = skull_bm()
    kill = [vert for vert in bm.verts if beard_inside(vert.co - HEAD_C) < -1.6]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    for vert in bm.verts:
        rel = vert.co - HEAD_C
        n = Vector((rel.x / HEAD_R.x**2, rel.y / HEAD_R.y**2, rel.z / HEAD_R.z**2)).normalized()
        e = beard_inside(rel)
        grow = 0.0042 + 0.0024 * (0.5 + 0.5 * noise.noise(vert.co * 80.0))
        vert.co += n * (grow * smooth(0.0, 1.0, e) - 0.004 * (1.0 - smooth(-0.6, 0.0, e)))
    styles["beard"] = finish_hair(bm, "beard_full", 0.003)
    return styles


def assign_preview_colors(obj):
    mesh = obj.data
    uv = mesh.uv_layers["Region"]
    attr = mesh.color_attributes.get("Preview") or mesh.color_attributes.new(name="Preview", type="FLOAT_COLOR", domain="CORNER")
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            region = int(uv.data[li].uv.x)
            r, g, b = PREVIEW_COLORS.get(region, (1, 0, 1))
            attr.data[li].color = (r, g, b, 1.0)
    mesh.color_attributes.active_color = attr
    mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index


def parent_to_bone(obj, rig, bone_name):
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    bpy.context.view_layer.update()
    obj.matrix_world = world


def make_material(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.6
    return mat


def render_preview(path, rig, styles, show):
    scene = bpy.context.scene
    for name, obj in styles.items():
        obj.hide_render = name not in show
    try:
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "VERTEX"
    except Exception:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1000
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("W")
    world.color = (0.25, 0.3, 0.35)
    scene.world = world
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 55
    cam = link(bpy.data.objects.new("Cam", cam_data))
    scene.camera = cam

    def shot(file, loc, target):
        cam.location = Vector(loc)
        direction = Vector(target) - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = file
        bpy.ops.render.render(write_still=True)

    shot(path + "_front.png", (1.2, -3.4, 1.15), (0, 0, 0.95))
    shot(path + "_face.png", (0.18, -0.55, 1.68), (0, 0, 1.66))

    pose = rig.pose.bones
    for pb in pose:
        pb.rotation_mode = "XYZ"
    pose["thigh.L"].rotation_euler = (math.radians(-50), 0, 0)
    pose["shin.L"].rotation_euler = (math.radians(70), 0, 0)
    pose["thigh.R"].rotation_euler = (math.radians(25), 0, 0)
    pose["shin.R"].rotation_euler = (math.radians(20), 0, 0)
    pose["upperarm.L"].rotation_euler = (math.radians(40), 0, math.radians(-30))
    pose["forearm.L"].rotation_euler = (math.radians(-70), 0, 0)
    pose["upperarm.R"].rotation_euler = (math.radians(-40), 0, math.radians(30))
    pose["forearm.R"].rotation_euler = (math.radians(-70), 0, 0)
    pose["spine"].rotation_euler = (math.radians(-10), 0, 0)
    pose["head"].rotation_euler = (math.radians(10), 0, math.radians(20))
    bpy.context.view_layer.update()
    shot(path + "_pose.png", (2.6, -2.2, 1.2), (0, 0, 0.9))
    for pb in pose:
        pb.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body = build_body()
    rig = build_rig()

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    head = build_head()
    boots = [build_boot(1, "L"), build_boot(-1, "R")]
    bpy.ops.object.select_all(action="DESELECT")
    for part in [head, *boots]:
        part.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()

    kit = make_material("Kit", (0.8, 0.8, 0.8))
    body.data.materials.clear()
    body.data.materials.append(kit)

    styles = build_hair_styles()
    hair_mat = make_material("Hair", (0.1, 0.07, 0.05))
    for obj in styles.values():
        obj.data.materials.clear()
        obj.data.materials.append(hair_mat)
        parent_to_bone(obj, rig, "head")

    print("BODY_VERTS", len(body.data.vertices), "TRIS", sum(len(p.vertices) - 2 for p in body.data.polygons))
    for name, obj in styles.items():
        print("HAIR", name, len(obj.data.vertices))
    groups = {g.index: g.name for g in body.vertex_groups}
    empty = [name for idx, name in groups.items() if not any(idx == ge.group for v in body.data.vertices for ge in v.groups)]
    print("GROUPS", sorted(groups.values()), "EMPTY", empty)

    if PREVIEW:
        assign_preview_colors(body)
        for obj in styles.values():
            assign_preview_colors(obj)
        render_preview(PREVIEW + "_a", rig, styles, {"short"})
        render_preview(PREVIEW + "_b", rig, styles, {"bun", "beard"})
        render_preview(PREVIEW + "_c", rig, styles, {"afro"})
        for obj in [body, *styles.values()]:
            attr = obj.data.color_attributes.get("Preview")
            if attr:
                obj.data.color_attributes.remove(attr)

    for obj in bpy.data.objects:
        obj.hide_render = False
        obj.select_set(obj.type in {"MESH", "ARMATURE"})
        if obj.type == "MESH":
            obj.data.validate(clean_customdata=False)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_morph=False,
        export_skins=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_vertex_color="NONE",
        export_materials="EXPORT",
    )
    print("EXPORTED", OUT)


main()
