"""Builds the footballer from MakeHuman (MPFB 2 + MakeHuman CC0 system assets).

blender -b --python blender/footballer_mh.py -- [preview_prefix]

Writes client/public/models/player.glb, player.json and models/tex/*.
The body carries morph targets (ethnicity, build, face shape) that the game bakes per player.
"""

import json
import math
import os
import sys
import time
import heapq

import addon_utils
import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, kdtree

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services.clothesservice import ClothesService  # noqa: E402
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.locationservice import LocationService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402
from bl_ext.user_default.mpfb.entities.objectproperties import HumanObjectProperties  # noqa: E402
from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "client", "public", "models")
TEX = os.path.join(MODELS, "tex")
argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
PREVIEW = argv[0] if argv else ""
DATA = LocationService.get_user_data()

BASE_MACRO = dict(gender=1.0, age=0.5, muscle=0.7, weight=0.5, proportions=0.75, height=0.55, cupsize=0.5, firmness=0.5)
BASE_RACE = dict(african=0.0, asian=0.0, caucasian=1.0)

MACRO_MORPHS = [
    ("afr", {}, dict(african=1.0, asian=0.0, caucasian=0.0)),
    ("asi", {}, dict(african=0.0, asian=1.0, caucasian=0.0)),
    ("mus", dict(muscle=1.0), None),
    ("hvy", dict(weight=0.8), None),
    ("lean", dict(weight=0.22), None),
    ("old", dict(age=0.62), None),
]

FACE_MORPHS = {
    "nw": [("nose-scale-horiz-incr", 1.0), ("nose-flaring-incr", 0.7), ("nose-nostrils-width-incr", 0.6)],
    "nn": [("nose-scale-horiz-decr", 0.9), ("nose-point-width-decr", 0.6)],
    "nl": [("nose-scale-vert-incr", 0.8), ("nose-scale-depth-incr", 0.6), ("nose-point-down", 0.3)],
    "ns": [("nose-scale-vert-decr", 0.7), ("nose-scale-depth-decr", 0.5), ("nose-point-up", 0.4)],
    "nh": [("nose-hump-incr", 1.0), ("nose-greek-decr", 0.4)],
    "jw": [("head-square", 0.8), ("chin-width-incr", 0.6), ("chin-bones-incr", 0.6)],
    "jn": [("head-invertedtriangular", 0.6), ("chin-width-decr", 0.6)],
    "cp": [("chin-prominent-incr", 1.0), ("chin-height-incr", 0.4)],
    "cr": [("chin-prominent-decr", 0.8), ("chin-height-decr", 0.3)],
    "fl": [("head-scale-vert-incr", 0.6), ("head-oval", 0.6)],
    "fr": [("head-round", 0.8), ("head-scale-horiz-incr", 0.4), ("head-fat-incr", 0.4)],
    "lf": [("mouth-upperlip-volume-incr", 1.0), ("mouth-lowerlip-volume-incr", 1.0), ("mouth-scale-horiz-incr", 0.3)],
    "lt": [("mouth-upperlip-volume-decr", 0.9), ("mouth-lowerlip-volume-decr", 0.7)],
    "mw": [("mouth-scale-horiz-incr", 1.0)],
    "cb": [("l-cheek-bones-incr", 1.0), ("r-cheek-bones-incr", 1.0)],
    "ch": [("l-cheek-volume-decr", 1.0), ("r-cheek-volume-decr", 1.0)],
    "es": [("l-eye-height2-decr", 0.8), ("r-eye-height2-decr", 0.8), ("l-eye-scale-decr", 0.4), ("r-eye-scale-decr", 0.4)],
    "eb": [("l-eye-scale-incr", 0.7), ("r-eye-scale-incr", 0.7)],
    "bh": [("eyebrows-trans-forward", 0.8), ("eyebrows-trans-down", 0.5)],
    "fh": [("forehead-scale-vert-incr", 1.0)],
    "eo": [("l-ear-flap-incr", 1.0), ("r-ear-flap-incr", 1.0), ("l-ear-scale-incr", 0.4), ("r-ear-scale-incr", 0.4)],
    "nk": [("measure-neck-circ-incr", 1.0), ("neck-scale-horiz-incr", 0.5)],
}

HAIRS = [
    ("short", "short02", 1.0),
    ("crop", "short01", 0.62),
    ("slick", "short04", 1.0),
    ("curly", "afro01", 0.4),
    ("afro", "afro01", 0.85),
    ("bun", "ponytail01", 1.0),
    ("longcurly", "bob01", 1.0),
]
BROWS = [("brow_a", "eyebrow001"), ("brow_b", "eyebrow009")]

BONE_MAP = {
    "pelvis": "hips",
    "spine_01": "spine",
    "spine_02": "spine2",
    "spine_03": "chest",
    "neck_01": "neck",
    "head": "head",
    "clavicle_l": "shoulderL",
    "upperarm_l": "upperarmL",
    "lowerarm_l": "forearmL",
    "hand_l": "handL",
    "clavicle_r": "shoulderR",
    "upperarm_r": "upperarmR",
    "lowerarm_r": "forearmR",
    "hand_r": "handR",
    "thigh_l": "thighL",
    "calf_l": "shinL",
    "foot_l": "footL",
    "ball_l": "toeL",
    "thigh_r": "thighR",
    "calf_r": "shinR",
    "foot_r": "footR",
    "ball_r": "toeR",
}

SKIN, SHIRT, SHORTS, SOCKS, BOOTS, HAND, SLEEVE = 0, 1, 2, 3, 4, 6, 13
PIECE = {SHIRT: "shirt", SLEEVE: "shirt", SHORTS: "shorts", SOCKS: "socks"}

PREVIEW_COLORS = {
    SKIN: (0.8, 0.58, 0.45),
    SHIRT: (0.62, 0.05, 0.2),
    SLEEVE: (0.85, 0.3, 0.1),
    SHORTS: (0.05, 0.16, 0.5),
    SOCKS: (0.9, 0.9, 0.2),
    BOOTS: (0.05, 0.05, 0.05),
    HAND: (0.9, 0.7, 0.6),
}

T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def smooth(e0, e1, x):
    if e0 == e1:
        return 1.0 if x >= e1 else 0.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# ----------------------------------------------------------------------------- human


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


def set_macro(body, macro, race):
    for k, v in macro.items():
        HumanObjectProperties.set_value(k, v, entity_reference=body)
    for k, v in race.items():
        HumanObjectProperties.set_value(k, v, entity_reference=body)
    TargetService.reapply_macro_details(body)


def load_face_targets(body):
    names = sorted({t for spec in FACE_MORPHS.values() for t, _ in spec})
    for name in names:
        path = TargetService.target_full_path(name)
        if not path:
            raise RuntimeError("missing target " + name)
        TargetService.load_target(body, path, weight=0.0, name="face." + name)


def set_face(body, spec, on):
    keys = body.data.shape_keys.key_blocks
    for name, w in spec:
        keys["face." + name].value = w if on else 0.0


def add_asset(body, rel, kind):
    path = os.path.join(DATA, rel)
    obj = HumanService.add_mhclo_asset(path, body, asset_type=kind, subdiv_levels=0, material_type="NONE")
    mh = Mhclo()
    mh.load(path)
    mh.clothes = obj
    return obj, mh


def refit(body, assets):
    for obj, mh in assets:
        ClothesService.fit_clothes_to_human(obj, body, mh, set_parent=False)


SHOES = "shoes05"
SHOE_CUT, SHOE_RISE = 0.078, 0.32


def shoe_planes(B, floor):
    """Boot collar per foot: lowest at the heel, rising over the instep toward the laces."""
    out = {}
    for s in "lr":
        ankle = B[f"foot_{s}"][0]
        d = B[f"ball_{s}"][0] - ankle
        d = Vector((d.x, d.y, 0.0)).normalized()
        n = Vector((-SHOE_RISE * d.x, -SHOE_RISE * d.y, 1.0)).normalized()
        out[s] = (Vector((ankle.x, ankle.y, floor + SHOE_CUT)), n)
    return out


def trim_body_mask(body, shoes, rig):
    """MakeHuman shoes come with a sock up the shin; the body mask under it must shrink to the boot so our sock shows."""
    masks = [m for m in body.modifiers if m.type == "MASK" and m.vertex_group.startswith("Delete.")]
    for m in masks:
        m.show_viewport = False
    bpy.context.view_layer.update()
    pos = snapshot([body, shoes])
    for m in masks:
        m.show_viewport = True
    floor = float(pos[shoes.name][:, 2].min())
    planes = shoe_planes({b.name: (b.head.copy(), b.tail.copy()) for b in rig.pose.bones}, floor)
    bp = pos[body.name]
    drop = []
    for i, p in enumerate(bp):
        pc, pn = planes["l" if p[0] > 0 else "r"]
        if (Vector(p) - pc).dot(pn) > -0.016:
            drop.append(i)
    for m in masks:
        body.vertex_groups[m.vertex_group].remove(drop)
    bpy.context.view_layer.update()
    return floor


def cut_shoes(obj, B):
    me = obj.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    floor = float(co.reshape(-1, 3)[:, 2].min())
    planes = shoe_planes(B, floor)
    bm = bmesh.new()
    bm.from_mesh(me)
    for s, (pc, pn) in planes.items():
        sx = 1 if s == "l" else -1
        faces = [f for f in bm.faces if all(v.co.x * sx > 0 for v in f.verts)]
        edges = list({e for f in faces for e in f.edges})
        verts = list({v for f in faces for v in f.verts})
        bmesh.ops.bisect_plane(bm, geom=faces + edges + verts, plane_co=pc, plane_no=pn, dist=0.0002, clear_outer=True)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return floor


# ----------------------------------------------------------------------------- pose


def rotate_bone(rig, name, axis, angle):
    pb = rig.pose.bones[name]
    m = pb.matrix.copy()
    head = m.translation.copy()
    r = Matrix.Translation(head) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-head)
    pb.matrix = r @ m
    bpy.context.view_layer.update()


def align_bone(rig, name, target_dir):
    pb = rig.pose.bones[name]
    d = (pb.tail - pb.head).normalized()
    q = d.rotation_difference(target_dir.normalized())
    axis, ang = q.to_axis_angle()
    if ang > 1e-5:
        rotate_bone(rig, name, axis, ang)


def pose_rig(rig):
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    bpy.context.view_layer.update()
    P = rig.pose.bones
    fwd = Vector((0, -1, 0))
    for s in "lr":
        hip = P[f"thigh_{s}"].head.copy()
        d = P[f"calf_{s}"].tail - hip
        axis, ang = d.rotation_difference(Vector((d.x * 0.5, d.y, d.z))).to_axis_angle()
        rotate_bone(rig, f"thigh_{s}", axis, ang)
        rotate_bone(rig, f"foot_{s}", axis, -ang)
        up = (P[f"upperarm_{s}"].tail - P[f"upperarm_{s}"].head).normalized()
        axis = up.cross(fwd).normalized()
        align_bone(rig, f"lowerarm_{s}", Matrix.Rotation(math.radians(8), 3, axis) @ up)
        thumb = P[f"thumb_01_{s}"].head.copy()
        for f, curl in (("index", (6, 10, 8)), ("middle", (8, 12, 9)), ("ring", (10, 14, 10)), ("pinky", (12, 17, 12))):
            knuckles = (P[f"pinky_01_{s}"].head - P[f"index_01_{s}"].head).normalized()
            for i, deg in enumerate(curl):
                bn = f"{f}_0{i + 1}_{s}"
                tip_name = f"{f}_03_{s}"
                before = (P[tip_name].tail - thumb).length
                rotate_bone(rig, bn, knuckles, math.radians(deg))
                after = (P[tip_name].tail - thumb).length
                if after > before:
                    rotate_bone(rig, bn, knuckles, math.radians(-2 * deg))


# ----------------------------------------------------------------------------- snapshots


def snapshot(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    out = {}
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        a = np.empty(len(me.vertices) * 3, dtype=np.float64)
        me.vertices.foreach_get("co", a)
        out[o.name] = a.reshape(-1, 3)
        ev.to_mesh_clear()
    return out


def shrink_hair(hair_pos, body_pos, head_mask, k):
    if k >= 0.999:
        return hair_pos
    tree = kdtree.KDTree(int(head_mask.sum()))
    idx = np.nonzero(head_mask)[0]
    for j, i in enumerate(idx):
        tree.insert(body_pos[i], j)
    tree.balance()
    out = hair_pos.copy()
    for i, p in enumerate(hair_pos):
        co, j, dist = tree.find(p)
        q = np.array(co)
        out[i] = q + (p - q) * k + (p - q) / max(dist, 1e-6) * 0.0015
    return out


# ----------------------------------------------------------------------------- body processing


def bone_groups(obj):
    names = {vg.index: vg.name for vg in obj.vertex_groups}
    me = obj.data
    parts = {
        "torso": {"pelvis", "spine_01", "spine_02", "spine_03", "clavicle_l", "clavicle_r"},
        "neck": {"neck_01", "head"},
        "uarm_l": {"upperarm_l"},
        "uarm_r": {"upperarm_r"},
        "larm": {"lowerarm_l", "lowerarm_r"},
        "thigh_l": {"thigh_l"},
        "thigh_r": {"thigh_r"},
        "calf_l": {"calf_l"},
        "calf_r": {"calf_r"},
        "foot": {"foot_l", "foot_r", "ball_l", "ball_r"},
    }
    lookup = {}
    for p, bones in parts.items():
        for b in bones:
            lookup[b] = p
    order = list(parts.keys()) + ["hand"]
    W = np.zeros((len(me.vertices), len(order)))
    head_w = np.zeros(len(me.vertices))
    for v in me.vertices:
        for g in v.groups:
            n = names.get(g.group, "")
            if n in lookup:
                W[v.index, order.index(lookup[n])] += g.weight
            elif n.startswith(("hand_", "thumb_", "index_", "middle_", "ring_", "pinky_")):
                W[v.index, order.index("hand")] += g.weight
            if n in ("head",):
                head_w[v.index] += g.weight
    return W, order, head_w


def group_verts(obj, name):
    vg = obj.vertex_groups.get(name)
    if vg is None:
        return set()
    out = set()
    for v in obj.data.vertices:
        for g in v.groups:
            if g.group == vg.index and g.weight > 0.5:
                out.add(v.index)
    return out


SLEEVE_T, SHORTS_T, SOCK_T = 0.47, 0.5, 0.14


def kit_planes(B):
    neck_y = B["neck_01"][0].y
    front = Vector((0.0, neck_y - 0.075, B["clavicle_l"][0].z + 0.012))
    back = Vector((0.0, neck_y + 0.07, B["neck_01"][0].z - 0.004))
    collar_n = Vector((1, 0, 0)).cross(back - front).normalized()
    if collar_n.z < 0:
        collar_n = -collar_n
    planes = {"collar": (front, collar_n), "waist": (Vector((0, 0, B["pelvis"][0].z + 0.04)), Vector((0, 0, 1)))}
    for s in "lr":
        for key, bone, t in (("sleeve", "upperarm", SLEEVE_T), ("shorts", "thigh", SHORTS_T), ("sock", "calf", SOCK_T)):
            h, tl = B[f"{bone}_{s}"]
            planes[f"{key}_{s}"] = (h + (tl - h) * t, (tl - h).normalized())
        ua = B[f"upperarm_{s}"][0]
        sx = 1 if s == "l" else -1
        planes[f"seam_{s}"] = (Vector((ua.x - sx * 0.005, 0, 0)), Vector((sx, 0, 0)))
    return planes


def bisect_kit(obj, B):
    planes = kit_planes(B)
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)

    def axis_dist(p, bone):
        h, t = B[bone]
        d = (t - h).normalized()
        v = p - h
        return (v - d * v.dot(d)).length

    for name, (pc, pn) in planes.items():
        s = name[-1]
        if name.startswith("sleeve"):
            sel = lambda p: axis_dist(p, f"upperarm_{s}") < 0.08 and abs((p - pc).dot(pn)) < 0.05  # noqa: E731
        elif name.startswith("shorts"):
            sel = lambda p: axis_dist(p, f"thigh_{s}") < 0.115 and abs((p - pc).dot(pn)) < 0.05  # noqa: E731
        elif name.startswith("sock"):
            sel = lambda p: axis_dist(p, f"calf_{s}") < 0.085 and abs((p - pc).dot(pn)) < 0.05  # noqa: E731
        elif name.startswith("seam"):
            ua = B[f"upperarm_{s}"][0]
            sel = lambda p: p.z > ua.z - 0.1 and p.z < ua.z + 0.08 and abs((p - pc).dot(pn)) < 0.03 and abs(p.y - ua.y) < 0.1  # noqa: E731
        elif name == "waist":
            sel = lambda p: abs(p.x) < 0.24 and abs(p.z - pc.z) < 0.05  # noqa: E731
        else:
            nb = B["neck_01"][0]
            sel = lambda p: math.hypot(p.x, p.y - nb.y) < 0.11 and abs((p - pc).dot(pn)) < 0.05  # noqa: E731
        faces = [f for f in bm.faces if all(sel(v.co) for v in f.verts)]
        if not faces:
            continue
        edges = list({e for f in faces for e in f.edges})
        verts = list({v for f in faces for v in f.verts})
        bmesh.ops.bisect_plane(bm, geom=faces + edges + verts, plane_co=pc, plane_no=pn, dist=0.0004)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return planes


def classify(obj, bones, planes):
    me = obj.data
    W, order, _ = bone_groups(obj)
    co = np.array([v.co[:] for v in me.vertices])
    B = bones
    waist_z = planes["waist"][0].z
    cpc, cpn = planes["collar"]

    def above_collar(c):
        return (c - cpc).dot(cpn) > 0

    def t_on(name, c):
        h, t = B[name]
        d = t - h
        return (c - h).dot(d) / d.length_squared

    regions = []
    for poly in me.polygons:
        vs = list(poly.vertices)
        w = W[vs].sum(axis=0)
        part = order[int(np.argmax(w))]
        c = Vector(co[vs].mean(axis=0))
        side = "l" if c.x > 0 else "r"
        r = SKIN
        if part == "hand":
            r = HAND
        elif part == "larm":
            r = SKIN
        elif part == "neck":
            r = SKIN if above_collar(c) else SHIRT
        elif part == "torso":
            if above_collar(c) and abs(c.x) < 0.11:
                r = SKIN
            elif c.z < waist_z:
                r = SHORTS
            else:
                r = SHIRT
        elif part.startswith("uarm"):
            r = SHIRT if t_on(f"upperarm_{side}", c) < SLEEVE_T else SKIN
        elif part.startswith("thigh"):
            r = SHORTS if t_on(f"thigh_{side}", c) < SHORTS_T else SKIN
        elif part.startswith("calf"):
            r = SOCKS if t_on(f"calf_{side}", c) > SOCK_T else SKIN
        elif part == "foot":
            r = SOCKS
        if r == SHIRT:
            spc, spn = planes[f"seam_{side}"]
            if (c - spc).dot(spn) > 0:
                r = SLEEVE
        regions.append(r)
    return regions


def split_hems(obj, regions):
    """Detaches each kit piece from skin along its border and bridges the gap with a thin hem wall."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    reg = bm.faces.layers.int.new("region")
    for f, r in zip(bm.faces, regions):
        f[reg] = r
    uv = bm.loops.layers.uv.active
    hem_layer = bm.verts.layers.int.new("hem")

    def piece(r):
        return PIECE.get(r, "skin%d" % r)

    for target in ("shirt", "shorts", "socks"):
        in_piece = lambda f: piece(f[reg]) == target and f[reg] >= 0  # noqa: E731
        border = []
        for e in bm.edges:
            if len(e.link_faces) != 2:
                continue
            a, b = e.link_faces
            pa, pb = in_piece(a), in_piece(b)
            if pa == pb:
                continue
            other = b if pa else a
            if target == "shorts" and piece(other[reg]) == "shirt":
                continue
            if target == "socks" and piece(other[reg]) in ("shirt", "shorts"):
                continue
            border.append(e)
        if not border:
            continue
        bverts = {v for e in border for v in e.verts}
        dup = {}
        for v in bverts:
            nv = bm.verts.new(v.co, v)
            nv[hem_layer] = 1
            dup[v] = nv
        bm.verts.index_update()
        border_set = {frozenset((e.verts[0], e.verts[1])) for e in border}
        edge_dir = {}
        old_faces = [f for f in bm.faces if in_piece(f) and any(v in dup for v in f.verts)]
        for f in old_faces:
            verts = [dup.get(v, v) for v in f.verts]
            loops_uv = [l[uv].uv.copy() for l in f.loops]
            for i, l in enumerate(f.loops):
                a, b = l.vert, l.link_loop_next.vert
                if frozenset((a, b)) in border_set:
                    edge_dir[frozenset((a, b))] = (a, b, loops_uv[i], loops_uv[(i + 1) % len(f.loops)])
            nf = bm.faces.new(verts, f)
            nf[reg] = f[reg]
            for l, u in zip(nf.loops, loops_uv):
                l[uv].uv = u
            bm.faces.remove(f)
        for key, (a, b, ua, ub) in edge_dir.items():
            try:
                nf = bm.faces.new((dup[b], dup[a], a, b))
            except ValueError:
                continue
            region = None
            for f in dup[a].link_faces:
                if in_piece(f) and f is not nf:
                    region = f[reg]
                    break
            nf[reg] = region if region is not None else (SHIRT if target == "shirt" else SHORTS if target == "shorts" else SOCKS)
            nf.smooth = True
            for l, u in zip(nf.loops, (ub, ua, ua, ub)):
                l[uv].uv = u
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.update()


def mesh_adjacency(me):
    n = len(me.vertices)
    ev = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ev)
    ev = ev.reshape(-1, 2)
    nbr = [[] for _ in range(n)]
    for a, b in ev:
        nbr[a].append(b)
        nbr[b].append(a)
    return nbr, ev


def face_regions(me):
    a = me.attributes["region"]
    r = np.empty(len(me.polygons), dtype=np.int32)
    a.data.foreach_get("value", r)
    return r


def vert_regions(me, freg):
    """Per-vertex: set of regions of adjacent faces."""
    vr = [set() for _ in me.vertices]
    for p, r in zip(me.polygons, freg):
        for v in p.vertices:
            vr[v].add(int(r))
    return vr


def hem_distance(me, nbr, freg, vr, co):
    hem = np.zeros(len(me.vertices), dtype=bool)
    if "hem" in me.attributes:
        h = np.empty(len(me.vertices), dtype=np.int32)
        me.attributes["hem"].data.foreach_get("value", h)
        hem = h > 0
    dist = np.full(len(me.vertices), 1.0)
    pq = []
    for i in np.nonzero(hem)[0]:
        dist[i] = 0.0
        pq.append((0.0, int(i)))
    heapq.heapify(pq)
    piece_of = lambda i: {PIECE.get(r, "skin") for r in vr[i]}  # noqa: E731
    while pq:
        d, i = heapq.heappop(pq)
        if d > dist[i] or d > 0.3:
            continue
        pi = piece_of(i)
        for j in nbr[i]:
            if not (piece_of(j) & pi - {"skin"}):
                continue
            nd = d + float(np.linalg.norm(co[i] - co[j]))
            if nd < dist[j]:
                dist[j] = nd
                heapq.heappush(pq, (nd, j))
    return dist, hem


def vertex_normals(me):
    me.update()
    n = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("normal", n)
    return n.reshape(-1, 3)


def kit_offsets(me, co, nrm, vr, dist, bones):
    off = np.zeros_like(co)
    for i in range(len(co)):
        regs = vr[i]
        if not regs:
            continue
        pieces = {PIECE.get(r, "skin") for r in regs}
        if "skin" in pieces and len(pieces) == 1:
            continue
        d = dist[i]
        amt = 0.0
        if "shorts" in pieces:
            amt = 0.009 + 0.014 * (1 - smooth(0.0, 0.16, d))
        elif "shirt" in pieces:
            amt = 0.006
            if SLEEVE in regs:
                amt += 0.007 * (1 - smooth(0.0, 0.06, d))
            if co[i][2] < bones["pelvis"][0].z + 0.15:
                amt += 0.006
        elif "socks" in pieces:
            amt = 0.0028
            if co[i][1] < bones["calf_l"][0].y - 0.02 and co[i][2] > 0.2 and co[i][2] < bones["calf_l"][0].z - 0.06:
                amt += 0.0035
        if "skin" in pieces or HAND in regs:
            amt *= 0.0
        off[i] = nrm[i] * amt
    return off


def laplacian(co, edges, movable, iters, lam):
    p = co.copy()
    mask = np.zeros(len(co), dtype=bool)
    mask[movable] = True
    deg = np.bincount(edges.ravel(), minlength=len(co)).astype(np.float64)[:, None]
    deg[deg == 0] = 1
    for _ in range(iters):
        s = np.zeros_like(p)
        np.add.at(s, edges[:, 0], p[edges[:, 1]])
        np.add.at(s, edges[:, 1], p[edges[:, 0]])
        p[mask] += lam * (s[mask] / deg[mask] - p[mask])
    return p


def masks(me, co, obj, head_w):
    n = len(co)
    lips = group_verts(obj, "lips")
    scalp = group_verts(obj, "scalp")
    ears = group_verts(obj, "ears")
    lips_idx = np.array(sorted(lips)) if lips else np.zeros(0, dtype=int)
    M = co[lips_idx].mean(axis=0) if len(lips_idx) else np.array([0, -0.1, 1.6])
    ear_front = min(co[i][1] for i in ears) if ears else M[1] + 0.09
    col = np.zeros((n, 4))
    col[:, 3] = 1.0
    for i in range(n):
        if head_w[i] < 0.05 and co[i][2] < M[2] - 0.12:
            continue
        x, y, z = co[i]
        ax = abs(x - M[0])
        top = M[2] + 0.017 + 0.034 * smooth(0.018, 0.075, ax)
        f_top = smooth(top + 0.006, top - 0.006, z)
        f_front = smooth(ear_front + 0.004, ear_front - 0.012, y)
        f_bot = smooth(M[2] - 0.115, M[2] - 0.075, z)
        under_jaw = smooth(M[1] + 0.07, M[1] + 0.03, y)
        f_bot = max(f_bot * 1.0, 0.0) * (1.0 if z > M[2] - 0.075 else under_jaw)
        beard = f_top * f_front * f_bot
        if i in lips:
            beard = 0.0
        col[i, 0] = beard
        s = 1.0 if i in scalp else 0.0
        side = smooth(ear_front - 0.002, ear_front - 0.014, y) * smooth(ear_front - 0.034, ear_front - 0.022, y)
        burn = side * smooth(M[2] + 0.035, M[2] + 0.055, z)
        col[i, 1] = max(s, burn)
        col[i, 2] = 1.0 if i in lips else 0.0
    return col, M, ear_front


# ----------------------------------------------------------------------------- textures


def save_image(src, dst, size=None, fmt="PNG", quality=90):
    img = bpy.data.images.load(src, check_existing=False)
    if size and (img.size[0] > size or img.size[1] > size):
        img.scale(size, size)
    scene = bpy.context.scene
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    s = scene.render.image_settings
    s.file_format = fmt
    if fmt == "JPEG":
        s.quality = quality
        s.color_mode = "RGB"
    else:
        s.color_mode = "RGBA"
        s.compression = 90
    img.save_render(dst, scene=scene)
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    w, h = img.size
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


def average_on_uv(px, uvs):
    h, w, _ = px.shape
    xs = np.clip((uvs[:, 0] % 1.0) * (w - 1), 0, w - 1).astype(int)
    ys = np.clip((uvs[:, 1] % 1.0) * (h - 1), 0, h - 1).astype(int)
    c = px[ys, xs, :3]
    lum = c @ np.array([0.2126, 0.7152, 0.0722])
    keep = (lum > np.percentile(lum, 10)) & (lum < np.percentile(lum, 90))
    return [float(x) for x in c[keep].mean(axis=0)]


# ----------------------------------------------------------------------------- preview


def preview(objs, path, hide=()):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1000
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    path = os.path.abspath(path)
    if not scene.world:
        scene.world = bpy.data.worlds.new("W")
    scene.world.color = (0.25, 0.3, 0.35)
    cam = bpy.data.objects.get("PreviewCam")
    if cam is None:
        cam = bpy.data.objects.new("PreviewCam", bpy.data.cameras.new("PreviewCam"))
        scene.collection.objects.link(cam)
    scene.camera = cam
    for o in objs:
        o.hide_render = o.name in hide

    def shot(file, loc, target, lens):
        cam.data.lens = lens
        cam.location = Vector(loc)
        cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = file
        bpy.ops.render.render(write_still=True)

    shot(path + "_front.png", (1.0, -3.6, 1.1), (0, 0, 0.95), 50)
    shot(path + "_back.png", (-1.0, 3.6, 1.2), (0, 0, 0.95), 50)
    shot(path + "_face.png", (0.22, -0.62, 1.7), (0, -0.02, 1.66), 70)
    shot(path + "_side.png", (0.7, -0.35, 1.68), (0, -0.02, 1.64), 70)
    for o in objs:
        o.hide_render = False


def region_colors(obj, freg, vcol=None):
    me = obj.data
    attr = me.color_attributes.new(name="Preview", type="FLOAT_COLOR", domain="CORNER")
    for p, r in zip(me.polygons, freg):
        c = PREVIEW_COLORS.get(int(r), (1, 0, 1))
        for li in p.loop_indices:
            cc = c
            if vcol is not None:
                v = me.loops[li].vertex_index
                if vcol[v, 0] > 0.05:
                    cc = tuple(a * (1 - vcol[v, 0]) + b * vcol[v, 0] for a, b in zip(cc, (0.15, 0.1, 0.08)))
                if vcol[v, 1] > 0.05:
                    cc = tuple(a * (1 - vcol[v, 1]) + b * vcol[v, 1] for a, b in zip(cc, (0.3, 0.2, 0.1)))
            attr.data[li].color = (*cc, 1.0)
    me.color_attributes.active_color = attr
    return attr


def flat_colors(obj, color):
    me = obj.data
    attr = me.color_attributes.new(name="Preview", type="FLOAT_COLOR", domain="CORNER")
    for d in attr.data:
        d.color = (*color, 1.0)
    me.color_attributes.active_color = attr


# ----------------------------------------------------------------------------- main


def main():
    os.makedirs(TEX, exist_ok=True)
    clear_scene()
    macro = dict(BASE_MACRO)
    macro["race"] = dict(BASE_RACE)
    body = HumanService.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True, scale=0.1, macro_detail_dict=macro)
    rig = HumanService.add_builtin_rig(body, "game_engine", import_weights=True)
    log("human + rig")

    assets = []
    names = {}

    def asset(key, rel, kind):
        o, mh = add_asset(body, rel, kind)
        assets.append((o, mh))
        names[key] = o
        return o

    asset("eyes", "eyes/high-poly/high-poly.mhclo", "Eyes")
    for key, b in BROWS:
        asset(key, f"eyebrows/{b}/{b}.mhclo", "Eyebrows")
    asset("lashes", "eyelashes/eyelashes01/eyelashes01.mhclo", "Eyelashes")
    asset("shoes", f"clothes/{SHOES}/{SHOES}.mhclo", "Clothes")
    for key, h, _ in HAIRS:
        asset("hair_" + key, f"hair/{h}/{h}.mhclo", "Hair")
    load_face_targets(body)
    refit(body, assets)
    log("assets", {k: len(o.data.vertices) for k, o in names.items()})
    log("shoe floor", trim_body_mask(body, names["shoes"], rig))

    pose_rig(rig)
    bones = {b.name: (b.head.copy(), b.tail.copy()) for b in rig.pose.bones}
    log("posed")

    objs = [body] + [o for o, _ in assets]
    base = snapshot(objs)
    head_mask = None

    def post(snap):
        nonlocal head_mask
        bp = snap[body.name]
        if head_mask is None:
            head_mask = bp[:, 2] > bones["neck_01"][1].z - 0.02
        for key, _, k in HAIRS:
            o = names["hair_" + key]
            snap[o.name] = shrink_hair(snap[o.name], bp, head_mask, k)
        return snap

    base = post(base)
    variants = []
    for name, m, race in MACRO_MORPHS:
        mm = dict(BASE_MACRO)
        mm.update(m)
        set_macro(body, mm, race or BASE_RACE)
        refit(body, assets)
        variants.append((name, post(snapshot(objs))))
        set_macro(body, BASE_MACRO, BASE_RACE)
        log("morph", name)
    refit(body, assets)
    for name, spec in FACE_MORPHS.items():
        set_face(body, spec, True)
        refit(body, assets)
        variants.append((name, post(snapshot(objs))))
        set_face(body, spec, False)
    refit(body, assets)
    log("face morphs", len(FACE_MORPHS))
    check = snapshot(objs)
    log("base drift", float(np.abs(check[body.name] - base[body.name]).max()))

    dg = bpy.context.evaluated_depsgraph_get()
    finals = {}
    for key, o in [("body", body)] + list(names.items()):
        ev = o.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        me.name = key
        fo = bpy.data.objects.new(key, me)
        bpy.context.scene.collection.objects.link(fo)
        arr = base[o.name]
        if len(me.vertices) != len(arr):
            raise RuntimeError(f"vertex mismatch {key}")
        me.vertices.foreach_set("co", arr.astype(np.float32).ravel())
        fo.shape_key_add(name="Basis", from_mix=False)
        for vname, snap in variants:
            k = fo.shape_key_add(name=vname, from_mix=False)
            k.data.foreach_set("co", snap[o.name].astype(np.float32).ravel())
        finals[key] = (fo, o)
    log("final meshes")

    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)

    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    log("rest pose applied")
    sole = cut_shoes(finals["shoes"][0], bones)
    log("shoes cut", len(finals["shoes"][0].data.vertices))

    body_o = finals["body"][0]
    me = body_o.data
    planes = bisect_kit(body_o, bones)
    log("bisect", len(me.vertices))
    regions = classify(body_o, bones, planes)
    split_hems(body_o, regions)
    log("hems", len(me.vertices))

    freg = face_regions(me)
    vr = vert_regions(me, freg)
    nbr, edges = mesh_adjacency(me)
    keys = me.shape_keys.key_blocks
    co = np.empty(len(me.vertices) * 3)
    keys[0].data.foreach_get("co", co)
    co = co.reshape(-1, 3)
    dist, hem = hem_distance(me, nbr, freg, vr, co)
    nrm = vertex_normals(me)
    off = kit_offsets(me, co, nrm, vr, dist, bones)
    shirt_v = [i for i in range(len(co)) if vr[i] and all(PIECE.get(r) == "shirt" for r in vr[i]) and not hem[i]]
    shorts_v = [i for i in range(len(co)) if vr[i] and all(PIECE.get(r) in ("shirt", "shorts") for r in vr[i]) and SHORTS in vr[i] and not hem[i]]
    for kb in keys:
        a = np.empty(len(me.vertices) * 3)
        kb.data.foreach_get("co", a)
        a = a.reshape(-1, 3) + off
        a = laplacian(a, edges, shirt_v, 6, 0.5)
        a = laplacian(a, edges, shorts_v, 4, 0.5)
        kb.data.foreach_set("co", a.astype(np.float32).ravel())
        if kb.name == "Basis":
            me.vertices.foreach_set("co", a.astype(np.float32).ravel())
    me.update()
    log("cloth")

    uv1 = me.uv_layers.new(name="Region")
    _, _, head_w = bone_groups(body_o)
    for p, r in zip(me.polygons, freg):
        for li in p.loop_indices:
            v = me.loops[li].vertex_index
            uv1.data[li].uv = (int(r) + 0.5, float(min(dist[v], 0.5)))
    co_final = np.empty(len(me.vertices) * 3)
    keys[0].data.foreach_get("co", co_final)
    co_final = co_final.reshape(-1, 3)
    vcol, mouth, ear_front = masks(me, co_final, body_o, head_w)
    ca = me.color_attributes.new(name="Mask", type="FLOAT_COLOR", domain="POINT")
    ca.data.foreach_set("color", vcol.astype(np.float32).ravel())
    log("masks")

    for old, new in BONE_MAP.items():
        rig.data.bones[old].name = new
    rig.name = "Armature"
    rig.data.name = "Armature"
    for key, (fo, _) in finals.items():
        for vg in fo.vertex_groups:
            if vg.name in BONE_MAP:
                vg.name = BONE_MAP[vg.name]
        fo.parent = rig
        fo.matrix_parent_inverse = rig.matrix_world.inverted()
        mod = fo.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
    log("rig bound")

    for key, (fo, _) in finals.items():
        if key == "body":
            continue
        fm = fo.data
        if key == "shoes":
            u = fm.uv_layers.new(name="Region")
            for d in u.data:
                d.uv = (BOOTS + 0.5, 0.0)

    lips_c = Vector(mouth)
    nip = group_verts(body_o, "nipple")
    nip_a = co_final[sorted(nip)] if nip else np.array([[0.1, -0.12, 1.36]])
    nip_c = Vector((float(np.abs(nip_a[:, 0]).mean()), float(nip_a[:, 1].mean()), float(nip_a[:, 2].mean())))
    shirt_v = [i for i in range(len(co_final)) if vr[i] and all(PIECE.get(r) == "shirt" for r in vr[i])]
    sc = co_final[shirt_v]
    torso = sc[np.abs(sc[:, 0]) < 0.2]
    meta = {
        "height": float(co_final[:, 2].max()),
        "sole": float(-sole),
        "hip": float(bones["pelvis"][0].z),
        "headCenter": [0.0, float(bones["head"][0].z + 0.08), float(-(bones["head"][0].y - 0.01))],
        "mouth": [float(lips_c.x), float(lips_c.z), float(-lips_c.y)],
        "nipple": [float(abs(nip_c.x)), float(nip_c.z), float(-nip_c.y)],
        "shirtTop": float(torso[:, 2].max()),
        "shirtBottom": float(torso[:, 2].min()),
        "collarBack": float(torso[(torso[:, 1] > 0.02) & (np.abs(torso[:, 0]) < 0.03), 2].max()),
        "collarFront": float(torso[(torso[:, 1] < -0.05) & (np.abs(torso[:, 0]) < 0.03), 2].max()),
        "chestFrontZ": float(-torso[:, 1].min()),
        "backZ": float(-torso[:, 1].max()),
        "shoulderX": float(abs(bones["upperarm_l"][0].x)),
        "shortsTop": float(bones["pelvis"][0].z + 0.04),
        "morphs": [n for n, _ in variants],
        "hairs": [h for h, _, _ in HAIRS],
    }

    skin_uv = np.array([me.uv_layers["UVMap"].data[li].uv[:] for p, r in zip(me.polygons, freg) if r == SKIN for li in p.loop_indices])
    avgs = {}
    for name, rel in (("light", "skins/young_caucasian_male/young_lightskinned_male_diffuse.png"), ("dark", "skins/young_african_male/young_darkskinned_male_diffuse.png"), ("asian", "skins/young_asian_male/young_lightskinned_male_diffuse3.png")):
        px = save_image(os.path.join(DATA, rel), os.path.join(TEX, f"skin_{name}.jpg"), 2048, "JPEG", 88)
        avgs[name] = average_on_uv(px, skin_uv)
    meta["skinAvg"] = avgs
    for key, h, _ in HAIRS:
        src_dir = os.path.join(DATA, "hair", h)
        diff = [f for f in os.listdir(src_dir) if f.endswith("_diffuse.png")][0]
        out = os.path.join(TEX, f"hair_{h}.png")
        if not os.path.exists(out):
            save_image(os.path.join(src_dir, diff), out, 1024, "PNG")
    for key, b in BROWS:
        save_image(os.path.join(DATA, "eyebrows", b, b + ".png"), os.path.join(TEX, f"{key}.png"), 512, "PNG")
    save_image(os.path.join(DATA, "eyelashes", "eyelashes01", "eyelashes01.png"), os.path.join(TEX, "lashes.png"), 512, "PNG")
    for e in ("brown", "brownlight", "blue", "green", "grey"):
        save_image(os.path.join(DATA, "eyes", "materials", f"{e}_eye.png"), os.path.join(TEX, f"eye_{e}.png"), 512, "PNG")
    save_image(os.path.join(DATA, "clothes", SHOES, f"{SHOES}_diffuse.png"), os.path.join(TEX, "boot.jpg"), 1024, "JPEG", 88)
    meta["hairTex"] = {k: f"hair_{h}.png" for k, h, _ in HAIRS}
    log("textures")

    for key, (fo, _) in finals.items():
        fm = fo.data
        mat = bpy.data.materials.get("mat_" + key) or bpy.data.materials.new("mat_" + key)
        fm.materials.clear()
        fm.materials.append(mat)

    if PREVIEW:
        region_colors(body_o, freg, vcol)
        palette = {"shoes": (0.05, 0.05, 0.05), "eyes": (0.9, 0.9, 0.9), "lashes": (0.05, 0.05, 0.05)}
        for key, (fo, _) in finals.items():
            if key != "body":
                flat_colors(fo, palette.get(key, (0.12, 0.08, 0.05)))
        objs_f = [fo for fo, _ in finals.values()]
        hide_all_hair = {fo.name for k, (fo, _) in finals.items() if k.startswith("hair_") or k == "brow_b"}
        preview(objs_f, PREVIEW + "_bald", hide_all_hair)
        preview(objs_f, PREVIEW + "_short", hide_all_hair - {"hair_short"})
        preview(objs_f, PREVIEW + "_curly", hide_all_hair - {"hair_curly"})
        for fo in objs_f:
            a = fo.data.color_attributes.get("Preview")
            if a:
                fo.data.color_attributes.remove(a)
        ca = body_o.data.color_attributes["Mask"]
        body_o.data.color_attributes.active_color = ca
        log("preview")

    for o in bpy.data.objects:
        o.select_set(o.type in {"MESH", "ARMATURE"} and o.name != "PreviewCam")
    body_o.data.color_attributes.active_color = body_o.data.color_attributes["Mask"]
    body_o.data.color_attributes.render_color_index = body_o.data.color_attributes.active_color_index
    out = os.path.join(MODELS, "player.glb")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_morph=True,
        export_morph_normal=True,
        export_skins=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_vertex_color="ACTIVE",
        export_materials="PLACEHOLDER",
    )
    with open(os.path.join(MODELS, "player.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    log("exported", out, os.path.getsize(out) // 1024, "KB")
    print(json.dumps({k: v for k, v in meta.items() if k not in ("morphs",)}, indent=1))


main()
