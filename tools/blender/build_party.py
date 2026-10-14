"""Build the party's rigged, animated combat models (Locklear, Gorath, Owyn, Pug, James, Patrus).

Usage (headless):
  blender --background --factory-startup --python tools/blender/build_party.py -- <outfits_root> <base_characters_root> <ual1_glb> <ual2_glb> <jobs.json> [name ...]

Each character is a Modular Outfits outfit on the shared 65-bone rig, with the base character's head, a kit
hairstyle (the beard can be trimmed to a moustache or goatee) and procedural garments skinned to the same bones:

  breastplate  plate shell over the chest (from the outfit's shirt), raised trim and rivets round its edges
  pauldrons    three overlapping lames on each shoulder
  robe         a smoothed shell over the shirt plus a long skirt weighted from the pelvis to both legs
  cape         hangs from the shoulders, weighted down the spine
  collar       high open-fronted collar
  cap          close-fitting skullcap
  baldric      leather strap from the left shoulder to the right hip
  scarf        thick scarf round the neck with a knot at the front
  belt         belt with a buckle; "scabbard" hangs an empty scabbard on the left hip

The weapon ("sword" or "staff") is parented to the right hand bone. The animation libraries' clips are renamed to
the game's states (idle, walk, attack, block, cast, shoot, hit, death) and exported as one glTF animation each.

jobs.json entries:
  {"name": "locklear", "out": "public/models/party/locklear.glb", "outfit": "Male_Peasant",
   "drop": ["Head_Hood"], "extras": [], "hair": "Hair_SimpleParted", "beard": "Hair_Beard", "trim": "moustache",
   "hair_color": [r, g, b], "beard_color": [r, g, b], "brow_color": [r, g, b],
   "tints": {"Body": {"color": [r, g, b]}},   # outfit parts, as build_bodies.tint_object
   "garments": [{"type": "breastplate", "color": [..], "trim": [..]}, ...],
   "weapon": {"type": "sword"}, "scale": 1.0, "clips": {"idle": "Sword_Idle", ...},
   "preview": "shots/party/locklear"}
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, kdtree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_bodies import SKIN_MATERIAL, bypass_vertex_colour, import_gltf, reset, tint_object, upstream  # noqa: E402

DEFAULT_CLIPS = {
    "idle": "Sword_Idle",
    "walk": "Walk_Loop",
    "attack": "Sword_Attack",
    "block": "Sword_Block",
    "cast": "Spell_Simple_Shoot",
    "shoot": "Pistol_Shoot",
    "hit": "Hit_Chest",
    "death": "Death01",
}


# ---------------------------------------------------------------- helpers


def material(name, rgb, roughness=0.8, metallic=0.0, image=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if image is not None:
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        mul = mat.node_tree.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        mul.inputs[6].default_value = (*rgb, 1.0)
        mat.node_tree.links.new(tex.outputs["Color"], mul.inputs[7])
        mat.node_tree.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
    return mat


def cloth_image(name, size=256, seed=3, folds=True):
    """Pale woven-cloth luminance texture (multiplied by the garment colour): fine weave and soft vertical folds."""
    import numpy as np
    rnd = np.random.default_rng(seed)
    y, x = np.mgrid[0:size, 0:size] / size
    weave = 0.04 * (np.sin(x * size * math.pi) * np.sin(y * size * math.pi))
    noise = rnd.normal(0, 0.035, (size, size))
    fold = 0.045 * np.sin(x * 2 * math.pi * 6 + np.sin(y * 2 * math.pi) * 0.8) if folds else 0
    lum = np.clip(0.88 + weave + noise + fold, 0, 1)
    img = bpy.data.images.new(name, size, size)
    px = np.ones((size, size, 4), dtype=np.float32)
    px[..., 0] = px[..., 1] = px[..., 2] = lum
    img.pixels.foreach_set(px.reshape(-1))
    img.pack()
    return img


def link(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if mat is not None:
        me.materials.append(mat)
    return obj


def apply_modifier(obj, mod):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.view_layer.objects:
        o.select_set(o is obj)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def solidify(obj, thickness, offset=1.0):
    mod = obj.modifiers.new("solid", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = offset
    mod.use_even_offset = False
    mod.use_quality_normals = True
    apply_modifier(obj, mod)


def smooth_shading(obj, angle=50):
    for p in obj.data.polygons:
        p.use_smooth = True
    if hasattr(obj.data, "set_sharp_from_angle"):
        obj.data.set_sharp_from_angle(angle=math.radians(angle))


def top_bone(v, layer, names):
    w = v[layer]
    return names[max(w.items(), key=lambda kv: kv[1])[0]] if w else ""


def set_weights(obj, arm, fn):
    """Skin `obj` to `arm`: fn(world co) -> {bone: weight}."""
    groups = {}
    for v in obj.data.vertices:
        for bone, w in fn(obj.matrix_world @ v.co).items():
            if w <= 1e-4:
                continue
            g = groups.get(bone) or obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
            groups[bone] = g
            g.add([v.index], w, "REPLACE")
    bind(obj, arm)


def bind(obj, arm):
    for m in [m for m in obj.modifiers if m.type == "ARMATURE"]:
        obj.modifiers.remove(m)
    mw = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = "OBJECT"
    obj.matrix_world = mw
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm


class Skinner:
    """Nearest-vertex weight lookup over skinned reference meshes (rest pose, world space)."""

    def __init__(self, objs):
        self.weights = []
        pts = []
        for o in objs:
            names = [g.name for g in o.vertex_groups]
            for v in o.data.vertices:
                ws = {names[g.group]: g.weight for g in v.groups if g.weight > 1e-4}
                if ws:
                    pts.append(o.matrix_world @ v.co)
                    self.weights.append(ws)
        self.tree = kdtree.KDTree(len(pts))
        for i, p in enumerate(pts):
            self.tree.insert(p, i)
        self.tree.balance()

    def __call__(self, co, only=None):
        """Weights at `co` averaged over the 4 nearest reference vertices; `only` keeps those bones (prefixes)."""
        acc = {}
        hits = self.tree.find_n(co, 4)
        for _, i, d in hits:
            k = 1.0 / (d + 0.01)
            for b, w in self.weights[i].items():
                if only and not b.startswith(only):
                    continue
                acc[b] = acc.get(b, 0) + w * k
        tot = sum(acc.values()) or 1
        return {b: w / tot for b, w in acc.items()}


def smoothstep(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- shells


def shell(src, name, mat, keep, offset, smooth=12, thickness=0.01, cuts=()):
    """Copy of `src` (a skinned rest-pose mesh) keeping the vertices `keep(co, bone)` accepts, smoothed, pushed out
    along its normals by `offset` and solidified. It keeps `src`'s skin weights."""
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bm.transform(src.matrix_world)
    layer = bm.verts.layers.deform.active
    names = [g.name for g in src.vertex_groups]
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co, top_bone(v, layer, names))], context="VERTS")
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.004)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    for _ in range(smooth):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    # Smoothing shrinks the surface: push each vertex out along its normal until it clears every source
    # vertex nearby by `offset`, so nothing underneath shows through.
    pts = [src.matrix_world @ v.co for v in src.data.vertices]
    tree = kdtree.KDTree(len(pts))
    for i, p in enumerate(pts):
        tree.insert(p, i)
    tree.balance()
    def clear(margin):
        bm.normal_update()
        for v in bm.verts:
            push = margin
            for p, _, _ in tree.find_range(v.co, 0.06):
                push = max(push, (p - v.co).dot(v.normal) + margin)
            v.co += v.normal * push

    # Push, smooth the lumps the pushes left (buttons, belts underneath), then push back out a little.
    clear(offset)
    for _ in range(smooth // 2):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    clear(offset * 0.4)
    # Clean straight edges: drop everything on the far side of each (point, normal) plane.
    for co, no in cuts:
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_outer=True)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for n in names:
        obj.vertex_groups.new(name=n)
    me.materials.clear()
    if mat is not None:
        me.materials.append(mat)
    if thickness:
        solidify(obj, thickness, -1.0)
    smooth_shading(obj)
    return obj


def rim(plate, name, mat, width=1, lift=0.006, thickness=0.008):
    """A raised band over the faces along `plate`'s open edges (before it is solidified)."""
    bm = bmesh.new()
    bm.from_mesh(plate.data)
    edge = {v for e in bm.edges if e.is_boundary for v in e.verts}
    ring = set(edge)
    for _ in range(width - 1):
        ring |= {o for v in ring for e in v.link_edges for o in e.verts}
    keep = {f for f in bm.faces if all(v in ring for v in f.verts) or sum(v in edge for v in f.verts) >= 2}
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in keep], context="FACES")
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * lift
    obj = link(name, bm, mat)
    for g in plate.vertex_groups:
        obj.vertex_groups.new(name=g.name)
    solidify(obj, thickness, -1.0)
    smooth_shading(obj)
    return obj, [plate.matrix_world @ plate.data.vertices[i].co for i in sorted({v.index for v in plate.data.vertices})]


def boundary_points(obj, every=0.06):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    pts, last = [], []
    for e in bm.edges:
        if not e.is_boundary:
            continue
        for v in e.verts:
            p = obj.matrix_world @ v.co
            if all((p - q).length > every for q in last):
                pts.append((p, v.normal.copy()))
                last.append(p)
    bm.free()
    return pts


def studs(points, name, mat, radius=0.007, lift=0.012):
    bm = bmesh.new()
    for p, n in points:
        geom = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius)
        bmesh.ops.translate(bm, verts=geom["verts"], vec=p + n * lift)
    obj = link(name, bm, mat)
    smooth_shading(obj)
    return obj


# ---------------------------------------------------------------- garments


def part_of(objs, suffix):
    return next((o for o in objs if o.type == "MESH" and o.name.split(".")[0].endswith(suffix)), None)


def g_breastplate(ctx, g):
    shirt = ctx["shirt"]
    steel = material("plate", g.get("color", (0.42, 0.43, 0.47)), 0.38, 0.85)
    trim_mat = material("plate_trim", g.get("trim", (0.42, 0.43, 0.46)), 0.4, 0.85)
    zlo, zhi = g.get("z", (1.04, 1.47))

    xw = g.get("half_width", 0.19)

    def keep(co, bone):
        return bone.startswith(("spine", "pelvis", "clavicle", "neck")) and zlo - 0.06 < co.z < zhi + 0.12 and abs(co.x) < xw + 0.06

    cuts = [((0, 0, zhi), (0, 0, 1)), ((0, 0, zlo), (0, 0, -1)), ((xw, 0, 0), (1, 0, -0.35)), ((-xw, 0, 0), (-1, 0, -0.35))]
    plate = shell(shirt, "breastplate", steel, keep, g.get("offset", 0.03), smooth=24, thickness=0, cuts=cuts)
    band, _ = rim(plate, "breastplate_trim", trim_mat)
    pts = boundary_points(plate, 0.055)
    solidify(plate, 0.012, -1.0)
    smooth_shading(plate)
    out = [plate, band, studs(pts, "rivets", trim_mat)]
    if g.get("ornate"):
        # Gorath's moredhel cuirass: raised gold plates over the pectorals and a boss on the stomach.
        gold = material("ornament", g.get("ornament", (0.75, 0.55, 0.18)), 0.35, 0.9)
        bm = bmesh.new()
        for sx in (-1, 1):
            geom = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.07)
            bmesh.ops.scale(bm, verts=geom["verts"], vec=(1.0, 0.25, 0.75))
            bmesh.ops.translate(bm, verts=geom["verts"], vec=(sx * 0.075, -0.155, 1.36))
        geom = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.045)
        bmesh.ops.scale(bm, verts=geom["verts"], vec=(1.0, 0.3, 1.0))
        bmesh.ops.translate(bm, verts=geom["verts"], vec=(0, -0.16, 1.2))
        orn = link("ornament", bm, gold)
        smooth_shading(orn)
        snap_to_surface(orn, plate, 0.004)
        out.append(orn)
    for o in out[1:]:
        set_weights(o, ctx["arm"], lambda co: ctx["skin"](co, ("spine", "pelvis", "clavicle")))
    bind(plate, ctx["arm"])
    return out


def snap_to_surface(obj, target, lift):
    """Move `obj` so its back sits on `target`'s surface (nearest point along -Y from its centre)."""
    centre = sum((obj.matrix_world @ v.co for v in obj.data.vertices), Vector()) / len(obj.data.vertices)
    bm = bmesh.new()
    bm.from_mesh(target.data)
    tree = kdtree.KDTree(len(bm.verts))
    for i, v in enumerate(bm.verts):
        tree.insert(target.matrix_world @ v.co, i)
    tree.balance()
    best_y = min(tree.find_range(centre, 0.2) or [(centre, 0, 0)], key=lambda h: h[0].y)[0].y
    bm.free()
    back = max(v.co.y for v in obj.data.vertices)
    for v in obj.data.vertices:
        v.co.y += best_y - lift - back + 0.012


def g_pauldrons(ctx, g):
    steel = material("pauldron", g.get("color", (0.55, 0.56, 0.6)), 0.32, 0.85)
    trim_mat = material("pauldron_trim", g.get("trim", (0.42, 0.43, 0.46)), 0.4, 0.85)
    out = []
    for side, tag in ((1, "l"), (-1, "r")):
        for k in range(3):
            bm = bmesh.new()
            geom = bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=0.115 - k * 0.012)
            vs = geom["verts"]
            bmesh.ops.delete(bm, geom=[v for v in vs if v.co.z < -0.15 * 0.115 or v.co.x * side < -0.02], context="VERTS")
            rot = Matrix.Rotation(math.radians(-(28 + k * 14) * side), 3, "Y")
            for v in bm.verts:
                v.co = rot @ v.co
                v.co.y *= 1.12
                v.co += Vector((side * (0.2 + k * 0.045), 0.055, 1.47 - k * 0.045))
            obj = link(f"pauldron_{tag}{k}", bm, steel)
            solidify(obj, 0.008, -1.0)
            smooth_shading(obj)
            out.append(obj)
            if k == 0:
                pts = boundary_points_mesh(obj)
                out.append(studs(pts[::3], f"pauldron_rivets_{tag}", trim_mat, 0.006, 0.004))
        for o in out[-4:]:
            set_weights(o, ctx["arm"], lambda co, tag=tag: {f"clavicle_{tag}": 0.35, f"upperarm_{tag}": 0.65})
    return out


def boundary_points_mesh(obj):
    return [(obj.matrix_world @ v.co, Vector((0, 0, 1))) for v in obj.data.vertices if v.co.z < min(w.co.z for w in obj.data.vertices) + 0.012]


def g_robe(ctx, g):
    cloth = material("robe", g.get("color", (0.85, 0.83, 0.78)), 0.9, 0.0, ctx["cloth"])
    shirt = ctx["shirt"]
    vneck = g.get("vneck", 0.11)

    def keep(co, bone):
        if not bone.startswith(("spine", "pelvis", "clavicle", "neck")):
            return False
        # Open V neck: drop the front of the chest above the sternum.
        if co.y < -0.02 and co.z > 1.5 - vneck * 2.2 and abs(co.x) < (co.z - (1.5 - vneck * 2.2)) * 0.45:
            return False
        return co.z > 0.92

    top = shell(shirt, "robe_top", cloth, keep, g.get("offset", 0.014), smooth=6, thickness=0.008)
    top_uv(top)
    bind(top, ctx["arm"])
    out = [top]
    # Skirt from the waist to the ankles, weighted from the pelvis to both legs.
    zt, zb = g.get("waist", 1.0), g.get("hem", 0.07)
    bot = g.get("flare", (0.25, 0.21))
    waist = waist_extent(shirt, zt)
    rings, seg = 16, 40
    bm = bmesh.new()
    grid = []
    for r in range(rings + 1):
        t = r / rings
        rx = waist[0] + (bot[0] - waist[0]) * t ** 0.8
        ry = waist[1] + (bot[1] - waist[1]) * t ** 0.8
        z = zt - (zt - zb) * t
        row = []
        for s in range(seg):
            a = 2 * math.pi * s / seg
            wob = 1 + 0.035 * math.sin(a * 7 + t * 2) * t
            row.append(bm.verts.new((math.sin(a) * rx * wob, waist[2] - math.cos(a) * ry * wob, z)))
        grid.append(row)
    for r in range(rings):
        for s in range(seg):
            bm.faces.new((grid[r][s], grid[r][(s + 1) % seg], grid[r + 1][(s + 1) % seg], grid[r + 1][s]))
    bm.normal_update()
    skirt = link("robe_skirt", bm, cloth)
    bmesh_uv_cylinder(skirt, waist[2])
    solidify(skirt, 0.01, 1.0)
    smooth_shading(skirt)

    def skirt_w(co):
        t = min(max((zt - co.z) / (zt - zb), 0.0), 1.0)
        legs = smoothstep(0.0, 0.55, t) * 0.65
        calf = smoothstep(0.5, 1.0, t) * 0.55
        left = min(max(0.5 + co.x / (2 * 0.11), 0.0), 1.0)
        w = {"pelvis": 1 - legs}
        for tag, k in (("l", left), ("r", 1 - left)):
            w[f"thigh_{tag}"] = legs * (1 - calf) * k
            w[f"calf_{tag}"] = legs * calf * k
        return w

    set_weights(skirt, ctx["arm"], skirt_w)
    out.append(skirt)
    # Wide cuffs at the ends of the sleeves.
    for side, tag in ((1, "l"), (-1, "r")):
        bm = bmesh.new()
        geom = bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=0.055, radius2=0.1, depth=0.16)
        bmesh.ops.rotate(bm, verts=geom["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90 * side), 3, "Y"))
        bmesh.ops.translate(bm, verts=geom["verts"], vec=(side * 0.6, 0.068, 1.452))
        cuff = link(f"robe_cuff_{tag}", bm, cloth)
        bmesh_uv_cylinder(cuff, 0.07)
        solidify(cuff, 0.008, 1.0)
        smooth_shading(cuff)
        set_weights(cuff, ctx["arm"], lambda co, tag=tag: {f"lowerarm_{tag}": 1.0})
        out.append(cuff)
    return out


def top_uv(obj):
    bmesh_uv_cylinder(obj, 0.02)


def bmesh_uv_cylinder(obj, cy):
    me = obj.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    uv = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        co = obj.matrix_world @ me.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((math.atan2(co.x, -(co.y - cy)) / (2 * math.pi)) * 3 + 0.5, co.z * 1.5)


def waist_extent(shirt, z):
    cs = [shirt.matrix_world @ v.co for v in shirt.data.vertices]
    band = [c for c in cs if abs(c.z - z) < 0.04] or cs
    xs = max(abs(c.x) for c in band)
    ys = [c.y for c in band]
    cy = (min(ys) + max(ys)) / 2
    return xs + 0.03, (max(ys) - min(ys)) / 2 + 0.035, cy


def g_cape(ctx, g):
    cloth = material("cape", g.get("color", (0.5, 0.04, 0.03)), 0.85, 0.0, ctx["cloth"])
    cols, rows = 20, 22
    top, bottom = 1.5, g.get("hem", 0.3)
    bm = bmesh.new()
    grid = []
    for r in range(rows + 1):
        v = r / rows
        z = top - (top - bottom) * v
        row = []
        for c in range(cols + 1):
            u = c / cols * 2 - 1
            half = 0.2 + 0.17 * v
            x = u * half
            y = 0.1 + 0.05 * math.sqrt(v) + 0.12 * v + 0.05 * (1 - u * u) - 0.04 * u * u * (1 - v)
            y += 0.012 * math.sin(u * math.pi * 3) * v
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for r in range(rows):
        for c in range(cols):
            bm.faces.new((grid[r][c], grid[r + 1][c], grid[r + 1][c + 1], grid[r][c + 1]))
    bm.normal_update()
    cape = link("cape", bm, cloth)
    me = cape.data
    uv = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (co.x * 2 + 0.5, co.z * 1.5)
    solidify(cape, 0.01, 1.0)
    smooth_shading(cape)

    def w(co):
        v = min(max((top - co.z) / (top - bottom), 0.0), 1.0)
        a = 1 - smoothstep(0.0, 0.3, v)
        b = smoothstep(0.0, 0.3, v) * (1 - smoothstep(0.3, 0.7, v))
        c = smoothstep(0.3, 0.7, v)
        return {"spine_03": a + 0.0, "spine_02": b * 0.6, "spine_01": b * 0.4 + c * 0.5, "pelvis": c * 0.5}

    set_weights(cape, ctx["arm"], w)
    # Clasps at the shoulders.
    gold = material("clasp", g.get("clasp", (0.75, 0.55, 0.18)), 0.35, 0.9)
    bm = bmesh.new()
    for sx in (-1, 1):
        geom = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=6, radius=0.028)
        bmesh.ops.scale(bm, verts=geom["verts"], vec=(1, 0.5, 1))
        bmesh.ops.translate(bm, verts=geom["verts"], vec=(sx * 0.17, -0.06, 1.47))
    clasps = link("cape_clasps", bm, gold)
    smooth_shading(clasps)
    set_weights(clasps, ctx["arm"], lambda co: {"spine_03": 1.0})
    return [cape, clasps]


def g_collar(ctx, g):
    cloth = material("collar", g.get("color", (0.5, 0.04, 0.03)), 0.85, 0.0, ctx["cloth"])
    seg, rows = 32, 6
    bm = bmesh.new()
    grid = []
    gap = math.radians(g.get("gap", 45))
    for r in range(rows + 1):
        t = r / rows
        z = 1.44 + 0.1 * t
        rad = 0.105 + 0.035 * t
        row = []
        for s in range(seg + 1):
            a = gap + (2 * math.pi - 2 * gap) * s / seg
            row.append(bm.verts.new((math.sin(a) * rad, 0.02 - math.cos(a) * rad * 0.95, z)))
        grid.append(row)
    for r in range(rows):
        for s in range(seg):
            bm.faces.new((grid[r][s], grid[r][s + 1], grid[r + 1][s + 1], grid[r + 1][s]))
    bm.normal_update()
    collar = link("collar", bm, cloth)
    bmesh_uv_cylinder(collar, 0.02)
    solidify(collar, 0.012, 1.0)
    smooth_shading(collar)
    set_weights(collar, ctx["arm"], lambda co: {"spine_03": 0.7 - 0.3 * (co.z - 1.44) / 0.1, "neck_01": 0.3 + 0.3 * (co.z - 1.44) / 0.1})
    return [collar]


def g_cap(ctx, g):
    cloth = material("cap", g.get("color", (0.88, 0.86, 0.8)), 0.9, 0.0, ctx["cloth"])
    bm = bmesh.new()
    geom = bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=1.0)
    bmesh.ops.delete(bm, geom=[v for v in geom["verts"] if v.co.z < 0.05], context="VERTS")
    c = Vector(g.get("centre", (0, 0.012, 1.725)))
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.1, v.co.y * 0.115, v.co.z * 0.12)) + c
        # Tilt back so the brim sits on the forehead and above the ears.
        v.co.z += (v.co.y - c.y) * 0.25
    cap = link("cap", bm, cloth)
    bmesh_uv_cylinder(cap, c.y)
    solidify(cap, 0.008, 1.0)
    smooth_shading(cap)
    set_weights(cap, ctx["arm"], lambda co: {"Head": 1.0})
    return [cap]


def g_baldric(ctx, g):
    leather = material("leather", g.get("color", (0.16, 0.09, 0.05)), 0.7)
    a = Vector((0.16, 1.5))
    b = Vector((-0.17, 0.98))
    d = (b - a).normalized()
    nrm = Vector((-d.y, d.x))
    half = g.get("width", 0.04) / 2

    def keep(co, bone):
        return abs((Vector((co.x, co.z)) - a).dot(nrm)) < half and co.z > 0.92 and bone.startswith(("spine", "pelvis", "clavicle"))

    strap = shell(ctx["shirt"], "baldric", leather, keep, g.get("offset", 0.022), smooth=3, thickness=0.006)
    bind(strap, ctx["arm"])
    metal = material("buckle", (0.6, 0.6, 0.62), 0.35, 0.85)
    bm = bmesh.new()
    geom = bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, verts=geom["verts"], vec=(0.05, 0.012, 0.05))
    bmesh.ops.rotate(bm, verts=geom["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(math.atan2(d.y, d.x) + math.pi / 2, 3, "Y"))
    p = a + d * 0.32
    bmesh.ops.translate(bm, verts=geom["verts"], vec=(p.x, -0.18, p.y))
    buckle = link("baldric_buckle", bm, metal)
    snap_to_surface(buckle, strap, 0.0)
    set_weights(buckle, ctx["arm"], lambda co: ctx["skin"](co, ("spine",)))
    return [strap, buckle]


def g_scarf(ctx, g):
    cloth = material("scarf", g.get("color", (0.45, 0.06, 0.04)), 0.9, 0.0, ctx["cloth"])
    bm = bmesh.new()
    geom = bmesh.ops.create_cone(bm, cap_ends=False, segments=32, radius1=0.125, radius2=0.1, depth=0.07)
    for v in geom["verts"]:
        v.co.y *= 0.95
        v.co.z += 1.505 + 0.02 * (v.co.y > 0)
        v.co.y += 0.02
    knot = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.035)
    bmesh.ops.translate(bm, verts=knot["verts"], vec=(0.02, -0.12, 1.47))
    tail = bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, verts=tail["verts"], vec=(0.05, 0.012, 0.16))
    bmesh.ops.rotate(bm, verts=tail["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-12), 3, "Y"))
    bmesh.ops.translate(bm, verts=tail["verts"], vec=(0.035, -0.13, 1.37))
    scarf = link("scarf", bm, cloth)
    bmesh_uv_cylinder(scarf, 0.02)
    smooth_shading(scarf)
    set_weights(scarf, ctx["arm"], lambda co: {"spine_03": 0.75, "neck_01": 0.25} if co.z > 1.45 else {"spine_03": 1.0})
    return [scarf]


def g_belt(ctx, g):
    leather = material("belt", g.get("color", (0.12, 0.07, 0.04)), 0.7)
    z = g.get("z", 1.0)
    ex = waist_extent(ctx["shirt"], z)
    bm = bmesh.new()
    seg = 40
    rows = []
    for dz in (-0.025, 0.025):
        rows.append([bm.verts.new((math.sin(2 * math.pi * s / seg) * (ex[0] + 0.006), ex[2] - math.cos(2 * math.pi * s / seg) * (ex[1] + 0.006), z + dz)) for s in range(seg)])
    for s in range(seg):
        bm.faces.new((rows[0][s], rows[0][(s + 1) % seg], rows[1][(s + 1) % seg], rows[1][s]))
    bm.normal_update()
    belt = link("belt", bm, leather)
    solidify(belt, 0.008, 1.0)
    smooth_shading(belt)
    metal = material("belt_buckle", g.get("buckle", (0.6, 0.6, 0.62)), 0.35, 0.85)
    bm = bmesh.new()
    geom = bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, verts=geom["verts"], vec=(0.06, 0.012, 0.065))
    bmesh.ops.translate(bm, verts=geom["verts"], vec=(0, ex[2] - ex[1] - 0.012, z))
    buckle = link("belt_buckle", bm, metal)
    out = [belt, buckle]
    if g.get("scabbard"):
        dark = material("scabbard", (0.08, 0.05, 0.035), 0.6)
        trim = material("scabbard_fittings", (0.45, 0.4, 0.3), 0.4, 0.8)
        top = Vector((ex[0] + 0.005, ex[2] + 0.06, z - 0.02))
        bottom = Vector((ex[0] + 0.03, ex[2] + 0.38, z - 0.72))
        axis = bottom - top
        rot = axis.normalized().to_track_quat("-Z", "Y").to_matrix()
        bm = bmesh.new()
        geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.032, radius2=0.02, depth=axis.length)
        bmesh.ops.scale(bm, verts=geom["verts"], vec=(1, 0.42, 1))
        bmesh.ops.translate(bm, verts=geom["verts"], vec=(0, 0, -axis.length / 2))
        bmesh.ops.rotate(bm, verts=geom["verts"], cent=(0, 0, 0), matrix=rot)
        bmesh.ops.translate(bm, verts=geom["verts"], vec=top)
        scab = link("scabbard", bm, dark)
        bm = bmesh.new()
        for t, r in ((0.02, 0.036), (0.3, 0.031), (0.97, 0.023)):
            geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=r, radius2=r, depth=0.035)
            bmesh.ops.scale(bm, verts=geom["verts"], vec=(1, 0.5, 1))
            bmesh.ops.rotate(bm, verts=geom["verts"], cent=(0, 0, 0), matrix=rot)
            bmesh.ops.translate(bm, verts=geom["verts"], vec=top + axis * t)
        fit = link("scabbard_fittings", bm, trim)
        smooth_shading(fit)
        out.append(fit)
        smooth_shading(scab)
        out.append(scab)
    for o in out:
        set_weights(o, ctx["arm"], lambda co: {"pelvis": 0.7, "spine_01": 0.3})
    return out


GARMENTS = {
    "breastplate": g_breastplate,
    "pauldrons": g_pauldrons,
    "robe": g_robe,
    "cape": g_cape,
    "collar": g_collar,
    "cap": g_cap,
    "baldric": g_baldric,
    "scarf": g_scarf,
    "belt": g_belt,
}


# ---------------------------------------------------------------- weapons


def sword_mesh(g):
    steel = material("blade", g.get("blade", (0.72, 0.74, 0.78)), 0.25, 0.9)
    guard_m = material("guard", g.get("guard", (0.45, 0.4, 0.3)), 0.4, 0.8)
    grip_m = material("grip", g.get("grip", (0.12, 0.07, 0.04)), 0.7)
    L = g.get("length", 0.85)
    bm = bmesh.new()
    # Blade along +Z from the guard: diamond cross-section tapering to a point.
    rings = []
    for z, tip in [(0.0, 0.0), (L * 0.82, 0.0), (L, 1.0)]:
        w = 0.026 * (1 - tip * 0.97)
        t = 0.006 * (1 - tip * 0.9)
        rings.append([bm.verts.new(p) for p in ((w, 0, z), (0, t, z), (-w, 0, z), (0, -t, z))])
    for r in range(len(rings) - 1):
        for i in range(4):
            bm.faces.new((rings[r][i], rings[r][(i + 1) % 4], rings[r + 1][(i + 1) % 4], rings[r + 1][i]))
    bm.faces.new(rings[0][::-1])
    blade = link("blade", bm, steel)
    bm = bmesh.new()
    geom = bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, verts=geom["verts"], vec=(0.2, 0.03, 0.025))
    for v in geom["verts"]:
        v.co.z += 0.03 * (abs(v.co.x) / 0.1) ** 2
    bmesh.ops.translate(bm, verts=geom["verts"], vec=(0, 0, -0.012))
    for sx in (-1, 1):
        k = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.017)
        bmesh.ops.translate(bm, verts=k["verts"], vec=(sx * 0.1, 0, 0.018))
    guard = link("guard", bm, guard_m)
    bm = bmesh.new()
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.016, radius2=0.014, depth=0.17)
    bmesh.ops.translate(bm, verts=geom["verts"], vec=(0, 0, -0.11))
    for k in range(6):
        ring = bmesh.ops.create_cone(bm, cap_ends=False, segments=10, radius1=0.0175, radius2=0.0175, depth=0.008)
        bmesh.ops.translate(bm, verts=ring["verts"], vec=(0, 0, -0.035 - k * 0.025))
    grip = link("grip", bm, grip_m)
    bm = bmesh.new()
    geom = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=8, radius=0.026)
    bmesh.ops.translate(bm, verts=geom["verts"], vec=(0, 0, -0.21))
    pommel = link("pommel", bm, guard_m)
    for o in (blade, guard, grip, pommel):
        smooth_shading(o, 35)
    return [blade, guard, grip, pommel]


def staff_mesh(g):
    wood = material("staff", g.get("wood", (0.42, 0.28, 0.15)), 0.75)
    metal = material("staff_metal", g.get("metal", (0.3, 0.3, 0.32)), 0.4, 0.8)
    L = g.get("length", 1.75)
    grip_at = g.get("grip", 0.62)  # fraction of the staff below the hand
    bm = bmesh.new()
    rings = []
    n = 14
    for k in range(n + 1):
        t = k / n
        z = (t - grip_at) * L
        r = 0.02 + 0.004 * math.sin(t * 9.0) + 0.006 * t
        rings.append([bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)) for a in [2 * math.pi * s / 10 for s in range(10)]])
    for k in range(n):
        for s in range(10):
            bm.faces.new((rings[k][s], rings[k][(s + 1) % 10], rings[k + 1][(s + 1) % 10], rings[k + 1][s]))
    bm.faces.new(rings[0][::-1])
    top = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.04)
    bmesh.ops.translate(bm, verts=top["verts"], vec=(0, 0, (1 - grip_at) * L + 0.02))
    staff = link("staff", bm, wood)
    bm = bmesh.new()
    for z in ((1 - grip_at) * L - 0.05, -grip_at * L + 0.03):
        ring = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.029, radius2=0.029, depth=0.05)
        bmesh.ops.translate(bm, verts=ring["verts"], vec=(0, 0, z))
    bands = link("staff_bands", bm, metal)
    # A dark wrap where the hand holds it.
    bm = bmesh.new()
    wrap = bmesh.ops.create_cone(bm, cap_ends=False, segments=12, radius1=0.026, radius2=0.026, depth=0.2)
    bmesh.ops.translate(bm, verts=wrap["verts"], vec=(0, 0, 0))
    grip = link("staff_wrap", bm, material("staff_wrap", (0.1, 0.06, 0.04), 0.8))
    for o in (staff, bands, grip):
        smooth_shading(o)
    return [staff, bands, grip]


WEAPONS = {"sword": sword_mesh, "staff": staff_mesh}


def aim_in_rest(ctx, aim):
    """The rest-pose direction that the right hand turns to `aim["dir"]` (world) in `aim["clip"]` at `aim["frame"]`
    (0..1 of the clip): so the blade points where the stance wants it, e.g. forward and up in the sword idle."""
    arm = ctx["arm"]
    arm.data.pose_position = "POSE"
    bind_action(arm, ctx["actions"][ctx["clips"][aim.get("clip", "idle")]], aim.get("frame", 0.3))
    bpy.context.view_layer.update()
    pb = arm.pose.bones["hand_r"]
    posed = (arm.matrix_world @ pb.matrix).to_3x3()
    rest = (arm.matrix_world @ pb.bone.matrix_local).to_3x3()
    d = (rest @ posed.inverted()) @ Vector(aim["dir"]).normalized()
    arm.animation_data.action = None
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    return d.normalized()


def attach_weapon(ctx, w):
    """Build the weapon along +Z with the grip at the origin and parent it to the right hand bone. In the rest
    (T) pose the fist's hole runs front to back under the palm: `grip` is the grip's rest position and `dir` the
    direction the blade or staff head points (world, rest pose)."""
    arm = ctx["arm"]
    parts = WEAPONS[w["type"]](w)
    d = Vector(w.get("dir", (0.0, -1.0, 0.0))).normalized()
    if w.get("aim"):
        d = aim_in_rest(ctx, w["aim"])
    rot = d.to_track_quat("Z", "X").to_matrix().to_4x4()
    if w.get("spin"):
        rot = rot @ Matrix.Rotation(math.radians(w["spin"]), 4, "Z")
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    weapon = bpy.context.view_layer.objects.active
    weapon.name = "weapon"
    weapon.matrix_world = Matrix.Translation(Vector(w.get("grip", (-0.785, 0.072, 1.415)))) @ rot
    mw = weapon.matrix_world.copy()
    weapon.parent = arm
    weapon.parent_type = "BONE"
    weapon.parent_bone = "hand_r"
    weapon.matrix_world = mw
    return weapon


# ---------------------------------------------------------------- assembly


def adopt(objs, arm):
    """Re-target every skinned mesh in `objs` to `arm` and drop the other armatures and rig widgets."""
    for o in objs:
        if o.type == "MESH" and not o.name.startswith("Icosphere"):
            bind(o, arm)
    for o in objs:
        if (o.type == "ARMATURE" and o is not arm) or o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o, do_unlink=True)


def head_only(obj):
    """Keep the base character's head and neck (the outfit is the rest of the body)."""
    names = [g.name for g in obj.vertex_groups]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    layer = bm.verts.layers.deform.active
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not top_bone(v, layer, names).startswith(("Head", "neck"))], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def trim_beard(obj, style):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    mw = obj.matrix_world

    def keep(co):
        c = mw @ co
        if style == "moustache":
            return 1.618 < c.z < 1.66 and c.y < -0.06 and abs(c.x) < 0.05
        if style == "goatee":
            return c.z < 1.645 and abs(c.x) < 0.032 and c.y < -0.04
        return True

    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co)], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def keep_materials(tex_cap):
    """Base colour stays; normal maps stay when their image loaded; metal/roughness maps go."""
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        bypass_vertex_colour(mat)
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        keep = upstream(bsdf.inputs["Base Color"]) | upstream(bsdf.inputs["Alpha"])
        normal_ok = False
        for l in list(bsdf.inputs["Normal"].links):
            ups = upstream(bsdf.inputs["Normal"])
            texs = [n for n in ups if n.type == "TEX_IMAGE"]
            if texs and all(t.image is not None and t.image.size[0] > 0 for t in texs):
                keep |= ups
                normal_ok = True
            else:
                nt.links.remove(l)
        for name in ("Metallic", "Roughness"):
            for l in list(bsdf.inputs[name].links):
                nt.links.remove(l)
        if any(n.type == "TEX_IMAGE" for n in keep):
            bsdf.inputs["Metallic"].default_value = 0.0
            bsdf.inputs["Roughness"].default_value = 0.8
        for n in list(nt.nodes):
            if n.type == "TEX_IMAGE" and n not in keep:
                nt.nodes.remove(n)
            elif n.type == "NORMAL_MAP" and not normal_ok:
                nt.nodes.remove(n)
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > tex_cap:
            s = tex_cap / max(w, h)
            img.scale(max(1, int(w * s)), max(1, int(h * s)))


def load_actions(paths):
    actions = {}
    for p in paths:
        before = set(bpy.data.actions)
        objs = import_gltf(p)
        for a in set(bpy.data.actions) - before:
            a.use_fake_user = True
            actions.setdefault(a.name.split(".")[0], a)
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)
    return actions


def bind_action(arm, action, frame=None):
    arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(arm.animation_data, "action_slot") and action.slots:
        arm.animation_data.action_slot = action.slots[0]
    if frame is not None:
        lo, hi = action.frame_range
        bpy.context.scene.frame_set(int(lo + (hi - lo) * frame))


def add_clips(arm, actions, clips):
    """One NLA track per clip, named after the game state; the exporter writes each track as an animation."""
    arm.animation_data_create()
    arm.animation_data.action = None
    used = set()
    for state, src in clips.items():
        act = actions[src]
        if act in used:
            act = act.copy()
        used.add(act)
        act.name = state
        track = arm.animation_data.nla_tracks.new()
        track.name = state
        strip = track.strips.new(state, int(act.frame_range[0]), act)
        if hasattr(strip, "action_slot") and act.slots:
            strip.action_slot = act.slots[0]
        track.mute = False
    for a in list(bpy.data.actions):
        if a not in used:
            bpy.data.actions.remove(a)


def preview(job, arm, objs, actions, clips):
    scene = bpy.context.scene
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.data.lens = 50
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "SUN"))
    fill.data.energy = 1.2
    fill.rotation_euler = (math.radians(60), 0, math.radians(150))
    scene.collection.objects.link(fill)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.37, 0.42, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    scene.world = world
    scene.render.resolution_x, scene.render.resolution_y = 520, 720
    s = job.get("scale", 1.0)
    views = [("front", (0.35, -1, 0.12)), ("back", (-0.4, 1, 0.15)), ("side", (1, -0.15, 0.1))]
    shots = [("idle", 0.3, views), ("attack", 0.45, views[::2]), ("cast", 0.6, views[:1]), ("walk", 0.25, views[::2]), ("block", 0.5, views[::2])]
    for state, frame, vs in shots:
        if state not in clips:
            continue
        bind_action(arm, actions[clips[state]], frame)
        for tag, d in vs:
            centre = Vector((0, 0, 0.92 * s))
            cam.location = centre + Vector(d).normalized() * 3.3 * s
            cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = os.path.abspath(f"{job['preview']}_{state}_{tag}.png")
            bpy.ops.render.render(write_still=True)
    arm.animation_data.action = None


def build(job, roots):
    outfits_root, base_root, ual1, ual2 = roots
    scene = reset()
    scene.render.film_transparent = False
    actions = load_actions([ual1, ual2])
    clips = {**DEFAULT_CLIPS, **job.get("clips", {})}
    hair_dir = os.path.join(base_root, "Hairstyles", "Rigged to Head Bone", "glTF (Godot -Unreal)")
    outfit = import_gltf(os.path.join(outfits_root, "Outfits", job["outfit"] + ".gltf"))
    arm = next(o for o in outfit if o.type == "ARMATURE")
    arm.name = "Rig"
    for d in job.get("drop", []):
        for o in [o for o in outfit if o.type == "MESH" and d in o.name]:
            outfit.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
    objs = list(outfit)
    for e in job.get("extras", []):
        objs += import_gltf(os.path.join(outfits_root, "Modular Parts", e + ".gltf"))
    base = import_gltf(os.path.join(base_root, "Base Characters", "Godot - UE", job.get("base", "Superhero_Male_FullBody") + ".gltf"))
    for o in base:
        if o.type == "MESH" and o.name.startswith("SuperHero"):
            head_only(o)
            o.name = "Head"
        elif o.type == "MESH" and o.name.startswith("Eyebrows") and job.get("brow_color"):
            tint_object(o, {"color": job["brow_color"], "name": "brows"})
    objs += base
    for key in ("hair", "beard"):
        if not job.get(key):
            continue
        styles = job[key] if isinstance(job[key], list) else [job[key]]
        hs = [o for st in styles for o in import_gltf(os.path.join(hair_dir, st + ".gltf"))]
        for o in hs:
            if o.type != "MESH" or o.name.startswith("Icosphere"):
                continue
            if key == "beard" and job.get("trim"):
                trim_beard(o, job["trim"])
            colour = job.get(f"{key}_color")
            if colour:
                tint_object(o, {"color": colour, "name": key, "target": job.get(f"{key}_target", 1.0)})
        objs += hs
    adopt(objs, arm)
    objs = [o for o in bpy.data.objects if o.type == "MESH" and o.parent is arm]
    for o in objs:
        for key, spec in job.get("tints", {}).items():
            if key in o.name:
                tint_object(o, {**spec, "name": key.lower()})
        if job.get("gloves") and o.name.split(".")[0].endswith("_Arms"):
            from build_bodies import paint_gloves
            paint_gloves(o, [g.name for g in o.vertex_groups], job["gloves"])
        if job.get("skin"):
            for slot in o.material_slots:
                if slot.material and slot.material.name.startswith((SKIN_MATERIAL, "MI_Superhero")):
                    tint_skin(slot, job["skin"])
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    shirt = part_of(objs, "_Body")
    ctx = {"arm": arm, "shirt": shirt, "skin": Skinner([o for o in objs if o.vertex_groups]), "cloth": cloth_image("cloth"),
           "actions": actions, "clips": clips}
    for g in job.get("garments", []):
        objs += GARMENTS[g["type"]](ctx, g)
    if job.get("weapon"):
        objs.append(attach_weapon(ctx, job["weapon"]))
    if os.environ.get("PARTY_DEBUG"):
        for o in objs:
            if o.type == "MESH":
                cs = [o.matrix_world @ v.co for v in o.data.vertices]
                print("DBG", o.name, len(cs), [round(min(c[i] for c in cs), 3) for i in range(3)], [round(max(c[i] for c in cs), 3) for i in range(3)])
    keep_materials(job.get("tex", 512))
    arm.data.pose_position = "POSE"
    s = job.get("scale", 1.0)
    arm.scale = (s, s, s)
    bpy.context.view_layer.update()
    if job.get("preview"):
        os.makedirs(os.path.dirname(os.path.abspath(job["preview"])), exist_ok=True)
        preview(job, arm, objs, actions, clips)
    add_clips(arm, actions, clips)
    os.makedirs(os.path.dirname(os.path.abspath(job["out"])), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(o is arm or o.parent is arm)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(job["out"]), export_format="GLB", export_yup=True,
                              use_selection=True, export_image_format="WEBP", export_skins=True,
                              export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
                              export_def_bones=False, export_apply=False)
    tris = sum(len(p.vertices) - 2 for o in bpy.context.scene.objects if o.type == "MESH" for p in o.data.polygons)
    print(f"built {job['name']}: {len([o for o in bpy.context.scene.objects if o.type == 'MESH'])} meshes, {tris} tris, clips {sorted(clips)}")


def tint_skin(slot, rgb):
    """Shift a skin material's colour (e.g. paler, ruddier) by multiplying its base colour by `rgb`."""
    mat = slot.material.copy()
    slot.material = mat
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None or not bsdf.inputs["Base Color"].links:
        return
    src = bsdf.inputs["Base Color"].links[0].from_socket
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(src, mul.inputs[6])
    mul.inputs[7].default_value = (*rgb, 1.0)
    nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    roots, jobs_path, names = argv[:4], argv[4], set(argv[5:])
    with open(jobs_path, encoding="utf-8") as f:
        jobs = json.load(f)
    for job in jobs:
        if names and job["name"] not in names:
            continue
        build(job, roots)


if __name__ == "__main__":
    main()
