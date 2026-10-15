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
        for n in (4, 32, 256):
            acc = {}
            for _, i, d in self.tree.find_n(co, n):
                k = 1.0 / (d + 0.01)
                for b, w in self.weights[i].items():
                    if only and not b.startswith(only):
                        continue
                    acc[b] = acc.get(b, 0) + w * k
            if acc:
                tot = sum(acc.values())
                return {b: w / tot for b, w in acc.items()}
        # Nothing nearby uses the allowed bones (e.g. a collar skinned to the head): an unweighted vertex would
        # stay put while the body moves, so pin it to the upper spine.
        return {"spine_03": 1.0}


def smoothstep(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- fitted surfaces
#
# Armour, belts, collars and hair are grids of rays cast from outside in, against the rest-pose body: each grid
# point lands on the outermost surface under it, so a garment follows the body's shape with an even gap instead of
# floating as a primitive. The hit distances are smoothed with an envelope (never sinking below a raw hit), which
# bridges laces, buttons and the hollows between the pectorals.


class Caster:
    """Outermost-surface ray casts against a set of meshes (world space, rest pose)."""

    def __init__(self, objs):
        from mathutils.bvhtree import BVHTree
        verts, polys = [], []
        for o in objs:
            base = len(verts)
            verts += [o.matrix_world @ v.co for v in o.data.vertices]
            polys += [[base + i for i in p.vertices] for p in o.data.polygons]
        self.tree = BVHTree.FromPolygons(verts, polys)

    def inward(self, centre, d, far=1.2):
        """Distance from `centre` along `d` to the outermost surface (cast from `far` back towards `centre`)."""
        hit = self.tree.ray_cast(centre + d * far, -d, far)
        return None if hit[0] is None else far - hit[3]


def envelope(rows, wrap=True, passes=6):
    """Smooth a grid of distances (list of rows) upward only: r = max(raw, mean of neighbours)."""
    raw = [r[:] for r in rows]
    cur = [r[:] for r in rows]
    n, m = len(cur), len(cur[0])
    for _ in range(passes):
        nxt = []
        for i in range(n):
            row = []
            for j in range(m):
                acc, k = 0.0, 0
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    a, b = i + di, j + dj
                    if wrap:
                        b %= m
                    if 0 <= a < n and 0 <= b < m:
                        acc += cur[a][b]
                        k += 1
                row.append(max(raw[i][j], acc / k))
            nxt.append(row)
        cur = nxt
    return cur


def grid_object(name, pts, mat, wrap=True, keep=None, centre=None):
    """Quad grid over `pts` (rows of points); `keep(i, j, p)` drops points (and their faces). With `centre`, the
    faces are turned to face away from it (so solidify and rims know which side is outside)."""
    bm = bmesh.new()
    vs = [[bm.verts.new(p) if p is not None and (keep is None or keep(i, j, p)) else None for j, p in enumerate(row)]
          for i, row in enumerate(pts)]
    m = len(pts[0])
    for i in range(len(pts) - 1):
        for j in range(m if wrap else m - 1):
            q = (vs[i][j], vs[i][(j + 1) % m], vs[i + 1][(j + 1) % m], vs[i + 1][j])
            if all(q) and len(set(q)) == 4:
                bm.faces.new(q)
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    if keep is not None:
        smooth_boundary(bm)
    bm.normal_update()
    if centre is not None and bm.faces:
        out = sum((f.normal.dot(f.calc_center_median() - centre) for f in bm.faces), 0.0)
        if out < 0:
            bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
            bm.normal_update()
    return link(name, bm, mat)


def smooth_boundary(bm, iters=30, factor=0.5):
    """Straighten the stair-steps a mask leaves along a grid's open edges: each boundary vertex moves towards the
    middle of its two boundary neighbours (corners of the grid stay put), then the next row in follows a little."""
    edge = [v for v in bm.verts if any(e.is_boundary for e in v.link_edges)]
    for _ in range(iters):
        moves = {}
        for v in edge:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                moves[v] = v.co.lerp((nb[0].co + nb[1].co) / 2, factor)
        for v, co in moves.items():
            v.co = co
    ring = {e.other_vert(v) for v in edge for e in v.link_edges} - set(edge)
    for _ in range(2):
        moves = {v: v.co.lerp(sum((e.other_vert(v).co for e in v.link_edges), Vector()) / len(v.link_edges), 0.4) for v in ring}
        for v, co in moves.items():
            v.co = co


def sphere_dir(e, a):
    """Unit direction at elevation `e` and azimuth `a` (0 = front, -Y; +pi/2 = the character's left, +X)."""
    return Vector((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e)))


def fit_shell(caster, centre, elevs, azims, offset, name, mat, keep=None, wrap=True, passes=6, dirfn=sphere_dir, bump=None,
              reach=None):
    """Grid over directions `dirfn(e, a)` from `centre`, each point on the outer surface plus `offset` (plus
    `bump(e, a, p)` if given)."""
    raw = [[caster.inward(centre, dirfn(e, a)) or 0.0 for a in azims] for e in elevs]
    if reach:
        # Hits further than `reach` are other limbs (the rest pose's outstretched arms): treat them as misses.
        raw = [[r if r <= reach else 0.0 for r in row] for row in raw]
    env = envelope(raw, wrap, passes)
    pts = []
    for i, e in enumerate(elevs):
        row = []
        for j, a in enumerate(azims):
            if raw[i][j] <= 0:
                row.append(None)
                continue
            d = dirfn(e, a)
            p = centre + d * (env[i][j] + offset)
            if bump:
                p = p + d * bump(e, a, p)
            row.append(p)
        pts.append(row)
    return grid_object(name, pts, mat, wrap, keep, centre)


def cone_dir(axis):
    """Directions around `axis`: e = angle from the axis, a = turn round it."""
    axis = Vector(axis).normalized()
    u = axis.cross(Vector((0, 1, 0))).normalized()
    w = axis.cross(u)
    return lambda e, a: (axis * math.cos(e) + (u * math.cos(a) + w * math.sin(a)) * math.sin(e)).normalized()


def soften(obj, passes=2, factor=0.5, below=None):
    """Laplacian smoothing; `below` limits it to vertices under that height (world)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    mw = obj.matrix_world
    verts = [v for v in bm.verts if below is None or (mw @ v.co).z < below]
    for _ in range(passes):
        bmesh.ops.smooth_vert(bm, verts=verts, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(obj.data)
    bm.free()


def cut(obj, planes):
    """Drop everything on the far side of each (point, normal) plane: clean straight edges."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for co, no in planes:
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_outer=True)
    bm.to_mesh(obj.data)
    bm.free()


def bone_rest(ctx, name, tail=False):
    b = ctx["arm"].data.bones[name]
    return ctx["arm"].matrix_world @ (b.tail_local if tail else b.head_local)


def own(mat):
    """Mark a material as built here, so keep_materials leaves its textures and metalness alone."""
    mat["own"] = True
    return mat


def pattern_image(name, fn, size=256):
    """RGB image from fn(x, y) arrays in 0..1 -> (r, g, b) arrays."""
    import numpy as np
    y, x = np.mgrid[0:size, 0:size] / size
    r, g, b = fn(x, y)
    img = bpy.data.images.new(name, size, size)
    px = np.ones((size, size, 4), dtype=np.float32)
    px[..., 0], px[..., 1], px[..., 2] = r, g, b
    img.pixels.foreach_set(px.reshape(-1))
    img.pack()
    return img


def textured(name, image, roughness, metallic):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return own(mat)


def planar_uv(obj, scale=2.0, axes=(0, 2)):
    me = obj.data
    uv = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        co = obj.matrix_world @ me.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (co[axes[0]] * scale + 0.5, co[axes[1]] * scale)


def filigree_image(base, gold, size=512):
    """Dark steel engraved with gold scrollwork: interlocking spirals and a border of running vines."""
    import numpy as np

    def fn(x, y):
        X, Y = x * 6, y * 6
        fx, fy = X % 1 - 0.5, Y % 1 - 0.5
        rr = np.sqrt(fx * fx + fy * fy)
        th = np.arctan2(fy, fx)
        spiral = np.abs(np.sin(th * 1 + rr * 26 * np.where((np.floor(X) + np.floor(Y)) % 2 == 0, 1, -1)))
        line = (spiral < 0.16) & (rr < 0.46) & (rr > 0.05)
        vine = np.abs(np.sin(Y * np.pi * 2 + np.sin(X * np.pi * 4) * 0.8)) < 0.07
        m = (line | vine).astype(np.float32)
        noise = np.random.default_rng(5).normal(0, 0.02, x.shape)
        return [base[k] + (gold[k] - base[k]) * m + noise for k in range(3)]

    return pattern_image("filigree", fn, size)


# ---------------------------------------------------------------- relief (raised gold emblems)


def wolf_heightmap(n=160):
    """A front-facing wolf's head as a height field (0..1): ears, brow, muzzle, ruff, sunken eyes."""
    import numpy as np
    y, x = np.mgrid[0:n, 0:n] / (n - 1)
    y = 1 - y

    def ell(cx, cy, rx, ry):
        return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1

    def tri(a, b, c):
        def side(p, q):
            return (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1])
        d1, d2, d3 = side(a, b), side(b, c), side(c, a)
        neg = (d1 < 0) | (d2 < 0) | (d3 < 0)
        pos = (d1 > 0) | (d2 > 0) | (d3 > 0)
        return ~(neg & pos)

    h = np.zeros_like(x)
    sil = ell(0.5, 0.5, 0.25, 0.27)
    for s in (-1, 1):
        sil |= tri((0.5 + s * 0.08, 0.66), (0.5 + s * 0.28, 0.98), (0.5 + s * 0.25, 0.58))
        sil |= tri((0.5 + s * 0.18, 0.5), (0.5 + s * 0.42, 0.28), (0.5 + s * 0.2, 0.3))
        sil |= tri((0.5 + s * 0.14, 0.36), (0.5 + s * 0.34, 0.14), (0.5 + s * 0.08, 0.24))
    muzzle = ell(0.5, 0.28, 0.12, 0.2)
    sil |= muzzle
    h[sil] = 0.55
    h += np.where(muzzle, 0.35 * np.clip(1 - ((x - 0.5) / 0.12) ** 2 - ((y - 0.28) / 0.2) ** 2, 0, 1), 0)
    h += np.where(ell(0.5, 0.52, 0.2, 0.18), 0.2 * np.clip(1 - ((x - 0.5) / 0.2) ** 2 - ((y - 0.52) / 0.18) ** 2, 0, 1), 0)
    for s in (-1, 1):
        inner = tri((0.5 + s * 0.12, 0.68), (0.5 + s * 0.255, 0.9), (0.5 + s * 0.22, 0.64))
        h[inner] -= 0.25
        eye = ell(0.5 + s * 0.1, 0.53, 0.05, 0.025)
        h[eye] = 0.25
        h[ell(0.5 + s * 0.1, 0.53, 0.018, 0.014)] = 0.7
    h[ell(0.5, 0.13, 0.05, 0.035)] = 1.0
    h[ell(0.5, 0.6, 0.012, 0.09)] -= 0.12
    h = np.clip(h, 0, 1)
    for _ in range(3):
        h = (h + np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1)) / 5
    return h


def relief(name, surface, centre, dirfn, e_range, a_range, hmap, height, mat, res=90):
    """A raised emblem laid on `surface`: a fine grid over directions from `centre` covering the emblem, each
    point on the surface lifted by the height map (bilinear) times `height`; flat parts are dropped."""
    caster = Caster([surface])
    n = hmap.shape[0]

    def sample(u, v):
        fx, fy = u * (n - 1), (1 - v) * (n - 1)
        x0, y0 = int(min(fx, n - 2)), int(min(fy, n - 2))
        tx, ty = fx - x0, fy - y0
        return (hmap[y0, x0] * (1 - tx) * (1 - ty) + hmap[y0, x0 + 1] * tx * (1 - ty)
                + hmap[y0 + 1, x0] * (1 - tx) * ty + hmap[y0 + 1, x0 + 1] * tx * ty)

    hs, pts = [], []
    for i in range(res):
        v = i / (res - 1)
        e = e_range[0] + (e_range[1] - e_range[0]) * v
        row, hrow = [], []
        for j in range(res):
            u = j / (res - 1)
            a = a_range[0] + (a_range[1] - a_range[0]) * u
            d = dirfn(e, a)
            r = caster.inward(centre, d)
            h = sample(u, v)
            hrow.append(h)
            row.append(None if r is None else centre + d * (r + 0.002 + h * height))
        pts.append(row)
        hs.append(hrow)
    return grid_object(name, pts, mat, wrap=False, centre=centre, keep=lambda i, j, p: max(
        hs[a][b] for a in range(max(i - 1, 0), min(i + 2, res)) for b in range(max(j - 1, 0), min(j + 2, res))) > 0.03)


def lin(a, b, n):
    return [a + (b - a) * k / (n - 1) for k in range(n)]


def body_parts(ctx, *suffixes):
    return [o for o in ctx["objs"] if o.type == "MESH" and o.name.split(".")[0].endswith(suffixes)]


def skin_from(ctx, obj, only):
    set_weights(obj, ctx["arm"], lambda co: ctx["skin"](co, only))


def tube(bm, pts, radius, segs=8):
    """A closed tube along a polyline (radius may be a number or a per-point list)."""
    rad = radius if isinstance(radius, (list, tuple)) else [radius] * len(pts)
    rings = []
    for k, p in enumerate(pts):
        t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        u = t.orthogonal().normalized()
        w = t.cross(u)
        rings.append([bm.verts.new(p + (u * math.cos(2 * math.pi * s / segs) + w * math.sin(2 * math.pi * s / segs)) * rad[k])
                      for s in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for s in range(segs):
            bm.faces.new((a[s], a[(s + 1) % segs], b[(s + 1) % segs], b[s]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])


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


def boundary_loops(obj):
    """The open edges of `obj` as ordered loops (world points); a loop that does not close is returned open."""
    me = obj.data
    nb = {}
    bm = bmesh.new()
    bm.from_mesh(me)
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts[0].index, e.verts[1].index
            nb.setdefault(a, []).append(b)
            nb.setdefault(b, []).append(a)
    co = {v.index: obj.matrix_world @ v.co for v in bm.verts}
    bm.free()
    seen, loops = set(), []
    for start in nb:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nxt = [n for n in nb[cur] if n != prev and n not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen.add(cur)
            loop.append(cur)
        if len(loop) > 3:
            loops.append([co[i] for i in loop])
    return loops


def rim_tube(plate, name, mat, radius=0.006, lift=0.0, smooth=6):
    """A rolled edge: a smooth tube along each of `plate`'s open edges (lifted along the outward side by `lift`)."""
    bm = bmesh.new()
    for loop in boundary_loops(plate):
        pts = [p.copy() for p in loop]
        for _ in range(smooth):
            pts = [pts[0]] + [(pts[k - 1] + pts[k] * 2 + pts[k + 1]) / 4 for k in range(1, len(pts) - 1)] + [pts[-1]]
        closed = (pts[0] - pts[-1]).length < 0.03
        if closed:
            pts.append(pts[0])
        tube(bm, pts, radius, 8)
    obj = link(name, bm, mat)
    smooth_shading(obj, 60)
    return obj


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


def skirt(ctx, name, mat, zt, zb, flare, follow=0.65, trim=None, rings=16, seg=40):
    """A skirt from the waist (`zt`) to the hem (`zb`), flaring to `flare` (half widths), weighted from the pelvis
    to both legs (`follow` = how much the hem follows the legs). `trim` colours a band round the hem."""
    waist = waist_extent(ctx["shirt"], zt)
    bm = bmesh.new()
    grid = []
    for r in range(rings + 1):
        t = r / rings
        rx = waist[0] + (flare[0] - waist[0]) * t ** 0.8
        ry = waist[1] + (flare[1] - waist[1]) * t ** 0.8
        z = zt - (zt - zb) * t
        row = []
        for s in range(seg):
            a = 2 * math.pi * s / seg
            wob = 1 + 0.035 * math.sin(a * 7 + t * 2) * t
            row.append(bm.verts.new((math.sin(a) * rx * wob, waist[2] - math.cos(a) * ry * wob, z)))
        grid.append(row)
    for r in range(rings):
        for s in range(seg):
            f = bm.faces.new((grid[r][s], grid[r][(s + 1) % seg], grid[r + 1][(s + 1) % seg], grid[r + 1][s]))
            f.material_index = 1 if trim is not None and r >= rings - 1 else 0
    bm.normal_update()
    obj = link(name, bm, mat)
    if trim is not None:
        obj.data.materials.append(trim)
    bmesh_uv_cylinder(obj, waist[2])
    solidify(obj, 0.01, 1.0)
    smooth_shading(obj)

    def w(co):
        t = min(max((zt - co.z) / (zt - zb), 0.0), 1.0)
        legs = smoothstep(0.0, 0.55, t) * follow
        calf = smoothstep(0.5, 1.0, t) * 0.55 if zb < 0.5 else 0.0
        left = min(max(0.5 + co.x / (2 * 0.11), 0.0), 1.0)
        out = {"pelvis": 1 - legs}
        for tag, k in (("l", left), ("r", 1 - left)):
            out[f"thigh_{tag}"] = legs * (1 - calf) * k
            out[f"calf_{tag}"] = legs * calf * k
        return out

    set_weights(obj, ctx["arm"], w)
    ctx["layers"].append(obj)
    return obj


def g_robe(ctx, g):
    """Long robe: a smoothed shell over the shirt with an open V neck, an ankle-length skirt and wide cuffs.
    `trim` colours the neck edge, the hem and the cuffs."""
    cloth = material("robe", g.get("color", (0.85, 0.83, 0.78)), 0.9, 0.0, ctx["cloth"])
    trim = material("robe_trim", g["trim"], 0.85, 0.0, ctx["cloth"]) if g.get("trim") else None
    shirt = ctx["shirt"]
    vneck = g.get("vneck", 0.11)

    def keep(co, bone):
        if not bone.startswith(("spine", "pelvis", "clavicle", "neck")):
            return False
        # Open V neck: drop the front of the chest above the sternum.
        if co.y < -0.02 and co.z > 1.5 - vneck * 2.2 and abs(co.x) < (co.z - (1.5 - vneck * 2.2)) * 0.45:
            return False
        return co.z > 0.92

    top = shell(shirt, "robe_top", cloth, keep, g.get("offset", 0.014), smooth=6, thickness=0)
    out = [top]
    if trim is not None:
        band, _ = rim(top, "robe_neck_trim", trim, width=2, lift=0.003, thickness=0.006)
        planar_uv(band, 4.0)
        out.append(band)
    solidify(top, 0.008, -1.0)
    smooth_shading(top)
    top_uv(top)
    bind(top, ctx["arm"])
    ctx["layers"].append(top)
    if trim is not None:
        skin_from(ctx, band, ("spine", "pelvis", "clavicle", "neck"))
    out.append(skirt(ctx, "robe_skirt", cloth, g.get("waist", 1.0), g.get("hem", 0.07), g.get("flare", (0.25, 0.21)),
                     g.get("follow", 0.65), trim))
    # Wide cuffs at the ends of the sleeves.
    for side, tag in ((1, "l"), (-1, "r")):
        bm = bmesh.new()
        geom = bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=0.055, radius2=0.1, depth=0.16)
        bmesh.ops.rotate(bm, verts=geom["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90 * side), 3, "Y"))
        bmesh.ops.translate(bm, verts=geom["verts"], vec=(side * 0.6, 0.068, 1.452))
        cuff = link(f"robe_cuff_{tag}", bm, cloth)
        if trim is not None:
            cuff.data.materials.append(trim)
            for p in cuff.data.polygons:
                p.material_index = 1 if sum(abs(cuff.data.vertices[i].co.x) for i in p.vertices) / len(p.vertices) > 0.64 else 0
        bmesh_uv_cylinder(cuff, 0.07)
        solidify(cuff, 0.008, 1.0)
        smooth_shading(cuff)
        set_weights(cuff, ctx["arm"], lambda co, tag=tag: {f"lowerarm_{tag}": 1.0})
        out.append(cuff)
    return out


def g_tunic(ctx, g):
    """The skirt of a long tunic over the legs (the shirt is the tunic's body)."""
    cloth = material("tunic", g.get("color", (0.32, 0.24, 0.06)), 0.9, 0.0, ctx["cloth"])
    trim = material("tunic_hem", g["trim"], 0.85, 0.0, ctx["cloth"]) if g.get("trim") else None
    return [skirt(ctx, "tunic_skirt", cloth, g.get("waist", 1.0), g.get("hem", 0.62), g.get("flare", (0.22, 0.18)),
                  g.get("follow", 0.8), trim, rings=8)]


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


def plane_dir(axis):
    """Directions through a flat square round `axis`: e and a are angles up and across (for emblems)."""
    axis = Vector(axis).normalized()
    u = axis.cross(Vector((0, 0, 1))).normalized()
    w = u.cross(axis)
    return lambda e, a: (axis - u * math.tan(a) + w * math.tan(e)).normalized()


def torso_centre(ctx):
    return Vector((0, waist_extent(ctx["shirt"], 1.25)[2], 1.2))


def neck_axis(ctx):
    n = bone_rest(ctx, "neck_01")
    return Vector((0, n.y, 0))


def torso_fit(ctx, name, mat, offset, keep, rows=72, cols=128, bump=None, targets=None, passes=8):
    """A shell over the torso, front and back, up over the shoulders to the neck (rays from the chest centre)."""
    centre = torso_centre(ctx)
    elevs = lin(math.radians(-62), math.radians(86), rows)
    azims = [2 * math.pi * k / cols - math.pi for k in range(cols)]
    caster = Caster(targets or [ctx["shirt"]])
    return fit_shell(caster, centre, elevs, azims, offset, name, mat, keep=lambda i, j, p: keep(p), bump=bump, passes=passes)


def off_neck(ctx, p, r=0.092, z=1.4):
    n = neck_axis(ctx)
    return not (p.z > z and math.hypot(p.x, p.y - n.y) < r)


def g_breastplate(ctx, g):
    """Cuirass: breast and back plates joined over the shoulders, fitted to the torso with an even gap. A raised
    medial ridge, a rolled rim and rivets; `ornate` adds Gorath's engraving and a wolf's head in gold relief."""
    gold = g.get("trim", (0.42, 0.43, 0.46))
    if g.get("ornate"):
        steel = textured("plate", filigree_image(g.get("color", (0.16, 0.16, 0.2)), g.get("inlay", (0.55, 0.4, 0.13))), 0.35, 0.85)
    else:
        steel = own(material("plate", g.get("color", (0.62, 0.63, 0.66)), 0.3, 0.9))
    trim_mat = own(material("plate_trim", gold, 0.35, 0.9))
    zlo = g.get("z", (1.04, 1.47))[0]
    xw = g.get("half_width", 0.2)
    centre = torso_centre(ctx)

    def keep(p):
        return zlo - 0.03 < p.z < 1.56 and abs(p.x) < xw + 0.03 and off_neck(ctx, p)

    def ridge(e, a, p):
        front = p.y < centre.y - 0.03 and p.z < 1.42
        return 0.009 * math.exp(-(p.x / 0.03) ** 2) * smoothstep(1.42, 1.3, p.z) if front else 0.0

    plate = torso_fit(ctx, "breastplate", steel, g.get("offset", 0.022), keep, bump=ridge, passes=30)
    # A shallow point at the bottom front (peascod line), straight sides at the arm holes.
    cut(plate, [((0, centre.y, zlo), (0, 0.3, -1)), ((xw, 0, 0), (1, 0, 0)), ((-xw, 0, 0), (-1, 0, 0))])
    soften(plate, 8, 0.5)
    # The shirt bunches over the belt: smooth the belly harder so the plate reads as one hammered surface.
    if g.get("belly", True):
        soften(plate, 20, 0.5, below=zlo + 0.25)
    if g.get("ornate"):
        planar_uv(plate, 2.2)
    band = rim_tube(plate, "breastplate_trim", trim_mat, 0.0065)
    pts = boundary_points(plate, 0.05)
    solidify(plate, 0.01, -1.0)
    smooth_shading(plate, 40)
    out = [plate, band, studs(pts, "rivets", trim_mat, 0.0065, 0.008)]
    if g.get("ornate"):
        emblem = own(material("emblem", gold, 0.3, 0.95))
        wolf = relief("wolf", plate, centre, sphere_dir, (math.radians(-10), math.radians(44)), (math.radians(-33), math.radians(33)),
                      wolf_heightmap(), 0.022, emblem)
        smooth_shading(wolf, 60)
        out.append(wolf)
    for o in out:
        skin_from(ctx, o, ("spine", "pelvis", "clavicle", "neck"))
    ctx["layers"].append(plate)
    ctx["cuirass"] = plate
    return out


def g_pauldrons(ctx, g):
    """Three overlapping lames on each shoulder, each fitted over the shoulder and upper arm and shingled
    (the top lame outermost); they reach in over the cuirass so there is no gap at the shoulder."""
    steel = own(material("pauldron", g.get("color", (0.6, 0.61, 0.65)), 0.3, 0.9))
    trim_mat = own(material("pauldron_trim", g.get("trim", (0.42, 0.43, 0.46)), 0.35, 0.9))
    targets = body_parts(ctx, "_Arms", "_Body")
    if ctx.get("cuirass"):
        targets.append(ctx["cuirass"])
    caster = Caster(targets)
    out = []
    for side, tag in ((1, "l"), (-1, "r")):
        centre = bone_rest(ctx, f"upperarm_{tag}") + Vector((-side * 0.03, 0.0, -0.02))
        dirfn = cone_dir((side, 0.0, 0.85))
        lames = [(3, 40, 0.034), (34, 58, 0.026), (52, 74, 0.018)]
        for k, (e0, e1, off) in enumerate(lames):
            obj = fit_shell(caster, centre, lin(math.radians(e0), math.radians(e1), 9), [2 * math.pi * s / 64 for s in range(64)],
                            off, f"pauldron_{tag}{k}", steel, keep=lambda i, j, p: p.x * side > 0.11, dirfn=dirfn, passes=4,
                            reach=0.16)
            soften(obj, 1, 0.3)
            band = rim_tube(obj, f"pauldron_rim_{tag}{k}", trim_mat, 0.0045)
            pts = boundary_points(obj, 0.045) if k == 0 else []
            solidify(obj, 0.007, -1.0)
            smooth_shading(obj, 40)
            out += [obj, band]
            if pts:
                out.append(studs([p for p in pts if p[0].z < centre.z + 0.06], f"pauldron_rivets_{tag}", trim_mat, 0.006, 0.006))
        joint = bone_rest(ctx, f"upperarm_{tag}")

        def w(co, side=side, tag=tag, joint=joint):
            # The top of the shoulder stays with the collarbone; only what lies along the arm follows the arm
            # (skin weights here would swing the top lame up like a fin when the arm drops).
            u = smoothstep(-0.02, 0.1, side * (co.x - joint.x)) * (1 - smoothstep(0.02, 0.08, co.z - joint.z))
            return {f"clavicle_{tag}": 1 - u, f"upperarm_{tag}": u}

        for o in out[-7:]:
            set_weights(o, ctx["arm"], w)
    if g.get("emblem"):
        emblem = own(material("pauldron_emblem", g["emblem"], 0.3, 0.95))
        for side, tag in ((1, "l"), (-1, "r")):
            top = next(o for o in out if o.name.startswith(f"pauldron_{tag}0"))
            centre = bone_rest(ctx, f"upperarm_{tag}") + Vector((-side * 0.03, 0.0, -0.02))
            w = relief(f"wolf_{tag}", top, centre, plane_dir((side, -0.35, 0.55)), (math.radians(-16), math.radians(16)),
                       (math.radians(-16), math.radians(16)), wolf_heightmap(), 0.012, emblem, res=60)
            smooth_shading(w, 60)
            joint = bone_rest(ctx, f"upperarm_{tag}")
            set_weights(w, ctx["arm"], lambda co, side=side, tag=tag, joint=joint: {
                f"upperarm_{tag}": smoothstep(-0.02, 0.1, side * (co.x - joint.x)) * (1 - smoothstep(0.02, 0.08, co.z - joint.z)),
                f"clavicle_{tag}": 1 - smoothstep(-0.02, 0.1, side * (co.x - joint.x)) * (1 - smoothstep(0.02, 0.08, co.z - joint.z))})
            out.append(w)
    return out


def g_baldric(ctx, g):
    """Leather strap from the right hip over the left shoulder and down the back, fitted over whatever the
    torso wears; the top runs under the left pauldron."""
    leather = material("leather", g.get("color", (0.16, 0.09, 0.05)), 0.7)
    a = Vector((0.15, 1.52))
    b = Vector((-0.19, 0.96))
    d = (b - a).normalized()
    nrm = Vector((-d.y, d.x))
    half = g.get("width", 0.045) / 2

    def keep(p):
        return abs((Vector((p.x, p.z)) - a).dot(nrm)) < half and 0.94 < p.z < 1.54 and off_neck(ctx, p, 0.09)

    targets = [ctx["shirt"]] + [o for o in ctx["layers"]]
    strap = torso_fit(ctx, "baldric", leather, g.get("offset", 0.014), keep, targets=targets, passes=10)
    soften(strap, 2, 0.4)
    solidify(strap, 0.006, -1.0)
    smooth_shading(strap)
    skin_from(ctx, strap, ("spine", "pelvis", "clavicle"))
    metal = own(material("buckle", (0.6, 0.6, 0.62), 0.35, 0.85))
    # Buckle on the chest, a third of the way down the strap.
    p = a + d * 0.3
    caster = Caster([strap])
    centre = torso_centre(ctx)
    dirv = (Vector((p.x, -0.3, p.y)) - centre).normalized()
    r = caster.inward(centre, dirv) or 0.2
    bm = bmesh.new()
    geom = bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, verts=geom["verts"], vec=(0.055, 0.01, 0.045))
    bmesh.ops.rotate(bm, verts=geom["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(-math.atan2(d.y, d.x) - math.pi / 2, 3, "Y"))
    bmesh.ops.translate(bm, verts=geom["verts"], vec=centre + dirv * (r + 0.004))
    buckle = link("baldric_buckle", bm, metal)
    skin_from(ctx, buckle, ("spine",))
    return [strap, buckle]


def g_vcollar(ctx, g):
    """A flat collar lying on the shoulders and back that comes to a deep V on the chest (Owyn's red collar)."""
    cloth = material("vcollar", g.get("color", (0.42, 0.06, 0.04)), 0.85, 0.0, ctx["cloth"])
    trim = own(material("vcollar_edge", g.get("edge", (0.3, 0.04, 0.03)), 0.8))
    zv = g.get("point", 1.2)
    width = g.get("width", 0.08)
    n = neck_axis(ctx)
    centre = torso_centre(ctx)

    def keep(p):
        r = math.hypot(p.x, p.y - n.y)
        if p.z > 1.38 and 0.075 < r < 0.075 + width * 1.15 and not (p.y < n.y - 0.02 and abs(p.x) < 0.03):
            return True
        if p.y < centre.y and zv < p.z < 1.52:
            x_in = (p.z - zv) * 0.5
            return x_in < abs(p.x) < x_in + width
        return False

    collar = torso_fit(ctx, "vcollar", cloth, g.get("offset", 0.012), keep, targets=[ctx["shirt"]] + ctx["layers"], passes=10)
    soften(collar, 2, 0.4)
    planar_uv(collar, 4.0)
    band = rim_tube(collar, "vcollar_edge", trim, 0.0045)
    solidify(collar, 0.007, -1.0)
    smooth_shading(collar)
    for o in (collar, band):
        skin_from(ctx, o, ("spine", "clavicle", "neck"))
    ctx["layers"].append(collar)
    return [collar, band]


def g_belt(ctx, g):
    """Belt fitted round whatever is at the waist (shirt, robe, tunic, cuirass), with a buckle; `scabbard` hangs
    a scabbard on the left hip (`rapier` makes it long and slim)."""
    leather = material("belt", g.get("color", (0.12, 0.07, 0.04)), 0.7)
    z = g.get("z", 1.0)
    cy = waist_extent(ctx["shirt"], z)[2]
    targets = body_parts(ctx, "_Body", "_Legs") + ctx["layers"]
    caster = Caster(targets)
    cols = 96
    azims = [2 * math.pi * k / cols - math.pi for k in range(cols)]
    zs = lin(z - 0.026, z + 0.026, 5)
    raw = [[caster.inward(Vector((0, cy, zz)), sphere_dir(0, a)) or 0.0 for a in azims] for zz in zs]
    env = envelope(raw, True, 10)
    top_r = [max(env[i][j] for i in range(len(zs))) for j in range(cols)]
    pts = [[Vector((0, cy, zz)) + sphere_dir(0, a) * (top_r[j] + 0.006) for j, a in enumerate(azims)] for zz in zs]
    belt = grid_object("belt", pts, leather, True, None, Vector((0, cy, z)))
    solidify(belt, 0.008, 1.0)
    smooth_shading(belt)
    metal = own(material("belt_buckle", g.get("buckle", (0.6, 0.6, 0.62)), 0.35, 0.85))
    front = cols // 2
    p0 = pts[2][front]
    bm = bmesh.new()
    geom = bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, verts=geom["verts"], vec=(0.06, 0.01, 0.068))
    bmesh.ops.translate(bm, verts=geom["verts"], vec=p0 + Vector((0, -0.011, 0)))
    tongue = bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, verts=tongue["verts"], vec=(0.008, 0.006, 0.05))
    bmesh.ops.translate(bm, verts=tongue["verts"], vec=p0 + Vector((0, -0.018, 0)))
    buckle = link("belt_buckle", bm, metal)
    out = [belt, buckle]
    if g.get("pouch"):
        pouch_mat = material("pouch", g.get("pouch_color", (0.2, 0.12, 0.06)), 0.75)
        j = front + cols // 6
        pp = pts[1][j]
        bm = bmesh.new()
        geom = bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, verts=geom["verts"], vec=(0.075, 0.035, 0.09))
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.012, segments=2, affect="EDGES")
        dirp = sphere_dir(0, azims[j])
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-azims[j], 3, "Z"))
        bmesh.ops.translate(bm, verts=bm.verts, vec=pp + dirp * 0.03 + Vector((0, 0, -0.05)))
        pouch = link("pouch", bm, pouch_mat)
        smooth_shading(pouch)
        out.append(pouch)
    if g.get("scabbard"):
        rapier = g.get("rapier", False)
        dark = material("scabbard", g.get("scabbard_color", (0.08, 0.05, 0.035)), 0.55)
        fittings = own(material("scabbard_fittings", g.get("fittings", (0.5, 0.44, 0.3)), 0.35, 0.85))
        j = front + int(cols * 0.29)
        top = pts[2][j] + sphere_dir(0, azims[j]) * 0.03 + Vector((0, 0, -0.02))
        length = 0.92 if rapier else 0.74
        bottom = top + Vector((0.03, 0.14, -length))
        axis = bottom - top
        rot = axis.normalized().to_track_quat("-Z", "Y").to_matrix()
        r0, r1 = (0.017, 0.009) if rapier else (0.03, 0.018)
        bm = bmesh.new()
        n = 10
        rings = []
        for k in range(n + 1):
            t = k / n
            r = r0 + (r1 - r0) * t
            ring = []
            for s in range(16):
                a = 2 * math.pi * s / 16
                ring.append(bm.verts.new(rot @ Vector((math.cos(a) * r, math.sin(a) * r * (0.75 if rapier else 0.42), -length * t)) + top))
            rings.append(ring)
        for ra, rb in zip(rings, rings[1:]):
            for s in range(16):
                bm.faces.new((ra[s], ra[(s + 1) % 16], rb[(s + 1) % 16], rb[s]))
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
        scab = link("scabbard", bm, dark)
        smooth_shading(scab, 60)
        bm = bmesh.new()
        for t, r, h in ((0.0, r0 * 1.15, 0.05), (0.33, r0 * 1.05, 0.02), (0.96, r1 * 1.3, 0.07)):
            geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=r, radius2=r, depth=h)
            bmesh.ops.scale(bm, verts=geom["verts"], vec=(1, 0.75 if rapier else 0.5, 1))
            bmesh.ops.rotate(bm, verts=geom["verts"], cent=(0, 0, 0), matrix=rot)
            bmesh.ops.translate(bm, verts=geom["verts"], vec=top + axis * t)
        fit = link("scabbard_fittings", bm, fittings)
        smooth_shading(fit, 40)
        # The frog: a short strap from the belt to the scabbard's throat.
        bm = bmesh.new()
        geom = bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, verts=geom["verts"], vec=(0.03, 0.012, 0.07))
        bmesh.ops.rotate(bm, verts=geom["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(-azims[j], 3, "Z"))
        bmesh.ops.translate(bm, verts=geom["verts"], vec=pts[2][j] + sphere_dir(0, azims[j]) * 0.016 + Vector((0, 0, -0.03)))
        frog = link("scabbard_frog", bm, leather)
        out += [scab, fit, frog]
    for o in out:
        if o.name.startswith(("scabbard", "pouch")):
            set_weights(o, ctx["arm"], lambda co: {"pelvis": 1.0})
        else:
            skin_from(ctx, o, ("pelvis", "spine_01", "spine_02", "thigh"))
    ctx["layers"] += [o for o in out if o.name.startswith(("belt", "scabbard"))]
    return out


def g_cape(ctx, g):
    """Cape hung from the shoulders: each column is cast from behind onto the back, cuirass, belt and scabbard and
    then only falls or moves back (never forward), so it clears everything under it; the lower half also
    follows the thighs a little so striding legs stay behind it."""
    cloth = material("cape", g.get("color", (0.5, 0.04, 0.03)), 0.85, 0.0, ctx["cloth"])
    cols, rows = 24, 28
    top, bottom = g.get("top", 1.5), g.get("hem", 0.3)
    targets = body_parts(ctx, "_Body", "_Legs", "_Feet") + ctx["layers"]
    caster = Caster(targets)
    pts = []
    prev = None
    for r in range(rows + 1):
        v = r / rows
        z = top - (top - bottom) * v
        half = 0.2 + 0.2 * v
        row = []
        for c in range(cols + 1):
            u = c / cols * 2 - 1
            x = u * half
            hit = caster.tree.ray_cast(Vector((x, 1.5, z)), Vector((0, -1, 0)), 3.0)
            y = hit[0].y + 0.03 if hit[0] is not None else None
            if prev is not None:
                y = max(y if y is not None else -1, prev[c].y + 0.004 * (1 - abs(u)))
            elif y is None:
                y = 0.12
            y += 0.012 * math.sin(u * math.pi * 3) * v + g.get("sweep", 0.04) * smoothstep(0.35, 1.0, v)
            row.append(Vector((x, y, z)))
        pts.append(row)
        prev = row
    cape = grid_object("cape", pts, cloth, wrap=False, centre=Vector((0, -0.3, 0.9)))
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
        legs = smoothstep(0.45, 1.0, v) * 0.35
        left = min(max(0.5 + co.x / 0.3, 0.0), 1.0)
        out = {"spine_03": a, "spine_02": b * 0.6, "spine_01": b * 0.4 + c * 0.5 * (1 - legs), "pelvis": c * 0.5 * (1 - legs)}
        out["thigh_l"] = c * legs * left
        out["thigh_r"] = c * legs * (1 - left)
        return out

    set_weights(cape, ctx["arm"], w)
    gold = own(material("clasp", g.get("clasp", (0.75, 0.55, 0.18)), 0.3, 0.95))
    bm = bmesh.new()
    for c in (0, cols):
        p = pts[0][c]
        geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.026, radius2=0.026, depth=0.012)
        bmesh.ops.rotate(bm, verts=geom["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "Z") @ Matrix.Rotation(math.radians(60), 3, "Y"))
        bmesh.ops.translate(bm, verts=geom["verts"], vec=p + Vector((0, -0.02, 0.015)))
    clasps = link("cape_clasps", bm, gold)
    smooth_shading(clasps)
    set_weights(clasps, ctx["arm"], lambda co: {"spine_03": 1.0})
    return [cape, clasps]


def g_collar(ctx, g):
    """High collar standing round the back and sides of the neck, flaring outward and open at the front; its
    base sits on the cuirass (or shirt), so it never cuts into the armour or the shoulders."""
    cloth = material("collar", g.get("color", (0.5, 0.04, 0.03)), 0.85, 0.0, ctx["cloth"])
    n = neck_axis(ctx)
    targets = [ctx["shirt"]] + ctx["layers"] + [o for o in ctx["objs"] if o.name.startswith("Head")]
    caster = Caster(targets)
    gap = math.radians(g.get("gap", 52))
    seg, rows = 40, 9
    zb, h = g.get("base", 1.43), g.get("height", 0.15)
    azims = [gap + (2 * math.pi - 2 * gap) * s / seg for s in range(seg + 1)]
    base = None
    pts = []
    for r in range(rows + 1):
        t = r / rows
        z = zb + h * t
        c = Vector((0, n.y, z))
        row = []
        for j, a in enumerate(azims):
            d = sphere_dir(0, a)
            hit = min(caster.inward(c, d, 0.5) or 0.08, g.get("reach", 0.125))
            if base is not None:
                hit = max(hit, base[j])
            row.append(hit)
        if base is None:
            base = row
        pts.append([Vector((0, n.y, zb + h * t)) + sphere_dir(0, a) * (row[j] + 0.014 + 0.06 * t ** 1.4) for j, a in enumerate(azims)])
    collar = grid_object("collar", pts, cloth, wrap=False, centre=Vector((0, n.y, zb + h / 2)))
    bmesh_uv_cylinder(collar, n.y)
    solidify(collar, 0.012, 1.0)
    smooth_shading(collar)
    set_weights(collar, ctx["arm"], lambda co: {"spine_03": 1 - 0.45 * min(max((co.z - zb) / h, 0), 1),
                                                 "neck_01": 0.45 * min(max((co.z - zb) / h, 0), 1)})
    return [collar]


def g_chains(ctx, g):
    """Shackles: an iron manacle on each wrist with a few links of broken chain, and a chain worn across the
    body from the left shoulder to the right hip."""
    iron = own(material("iron", g.get("color", (0.2, 0.2, 0.22)), 0.45, 0.85))
    out = []

    def link_ring(bm, centre, axis, along, rx=0.018, rz=0.03, r=0.0055):
        axis = axis.normalized()
        along = along.normalized()
        side = axis.cross(along).normalized()
        pts = [centre + along * (math.cos(2 * math.pi * k / 14) * rz) + side * (math.sin(2 * math.pi * k / 14) * rx) for k in range(14)]
        segs = 6
        rings = []
        for k, p in enumerate(pts):
            t = (pts[(k + 1) % 14] - pts[k - 1]).normalized()
            u = axis
            w = t.cross(u).normalized()
            rings.append([bm.verts.new(p + (u * math.cos(2 * math.pi * s / segs) + w * math.sin(2 * math.pi * s / segs)) * r) for s in range(segs)])
        for k in range(14):
            a, b = rings[k], rings[(k + 1) % 14]
            for s in range(segs):
                bm.faces.new((a[s], a[(s + 1) % segs], b[(s + 1) % segs], b[s]))

    for side, tag in ((1, "l"), (-1, "r")):
        wrist = bone_rest(ctx, f"hand_{tag}") - Vector((side * 0.05, 0, 0))
        bm = bmesh.new()
        ring_pts = [wrist + Vector((0, math.cos(2 * math.pi * k / 24) * 0.05, math.sin(2 * math.pi * k / 24) * 0.047)) for k in range(24)]
        for k in range(2):
            off = Vector((side * (k * 0.03 - 0.015), 0, 0))
            seg_pts = [p + off for p in ring_pts] + [ring_pts[0] + off]
            tube(bm, seg_pts, 0.012, 8)
        # Broken chain hanging from the manacle (along -Z in the rest pose).
        p = wrist + Vector((0, 0, -0.06))
        for k in range(4):
            axis = Vector((1, 0, 0)) if k % 2 == 0 else Vector((0, 1, 0))
            link_ring(bm, p + Vector((0, 0, -0.045 * k)), axis, Vector((0, 0, 1)))
        man = link(f"manacle_{tag}", bm, iron)
        smooth_shading(man, 50)
        set_weights(man, ctx["arm"], lambda co, tag=tag: {f"hand_{tag}": 0.4, f"lowerarm_{tag}": 0.6})
        out.append(man)
    # The body chain: links along a strip fitted over the torso from the left shoulder to the right hip.
    a, b = Vector((0.13, 1.5)), Vector((-0.18, 1.0))
    centre = torso_centre(ctx)
    caster = Caster([ctx["shirt"]] + ctx["layers"])
    bm = bmesh.new()
    count = 0
    for side_y in (-1, 1):
        k = 0
        t = 0.0
        while t <= 1.0:
            q = a + (b - a) * t
            d = (Vector((q.x, side_y * 0.4, q.y)) - centre).normalized()
            r = caster.inward(centre, d)
            if r:
                p = centre + d * (r + 0.012)
                tangent = Vector((b.x - a.x, 0, b.y - a.y))
                axis = d if k % 2 == 0 else tangent.cross(d)
                link_ring(bm, p, axis, tangent, 0.016, 0.026, 0.005)
                count += 1
            k += 1
            t += 0.055 / (b - a).length
    body = link("body_chain", bm, iron)
    smooth_shading(body, 50)
    skin_from(ctx, body, ("spine", "pelvis", "clavicle"))
    out.append(body)
    return out


def g_hair(ctx, g):
    """Hair grown over the scalp and hung straight down from the widest part of the head (so long hair drapes
    instead of hugging the neck). `hairline` maps azimuth (degrees from the front) to the lowest elevation (degrees
    from the head centre) the hair reaches; -999 means down to `length` (a height). Strands are shallow grooves,
    the ends are ragged, and `ponytail` adds a tied tail at the nape."""
    head = next(o for o in ctx["objs"] if o.name.startswith("Head"))
    cs = [head.matrix_world @ v.co for v in head.data.vertices if (head.matrix_world @ v.co).z > 1.58]
    lo = Vector([min(c[i] for c in cs) for i in range(3)])
    hi = Vector([max(c[i] for c in cs) for i in range(3)])
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2 + g.get("back", 0.0), lo.z + (hi.z - lo.z) * 0.55))
    colour = Vector(g.get("color", (0.2, 0.12, 0.05)))
    tip = Vector(g.get("tip", colour))
    grey = g.get("grey")

    def strands(colour, tip):
        return lambda x, y: strand_rgb(x, y, colour, tip)

    def strand_rgb(x, y, colour, tip):
        import numpy as np
        rnd = np.random.default_rng(11)
        strands = rnd.normal(0, 1, 256)
        s = np.interp(x * 255, np.arange(256), strands)
        s2 = np.interp((x * 255 * 3) % 255, np.arange(256), rnd.normal(0, 1, 256))
        lum = np.clip(0.85 + 0.12 * s + 0.06 * s2 + 0.03 * np.sin(y * 40 + s * 3), 0.45, 1.15)
        out = []
        for k in range(3):
            base = colour[k] + (tip[k] - colour[k]) * y
            out.append(np.clip(base * lum, 0, 1))
        return out

    mat = textured("hair_gen", pattern_image("hair_strands", strands(colour, tip), 256), 0.55, 0.0)
    caster = Caster([head])
    rows, cols = 44, 120
    elevs = lin(math.radians(89), math.radians(-48), rows)
    azims = [2 * math.pi * k / cols - math.pi for k in range(cols)]
    raw = [[caster.inward(centre, sphere_dir(e, a), 0.5) or 0.0 for a in azims] for e in elevs]
    env = envelope(raw, True, 4)
    table = g.get("hairline", [[0, 30], [40, 22], [70, -10], [80, -999], [180, -999]])
    length = g.get("length", 1.5)
    vol = g.get("volume", 0.014)
    ext = 10

    def hairline(a):
        a = abs(math.degrees(a))
        for (a0, h0), (a1, h1) in zip(table, table[1:]):
            if a0 <= a <= a1:
                return h0 + (h1 - h0) * (a - a0) / (a1 - a0)
        return table[-1][1]

    pts, noms = [], []
    for i in range(rows + ext):
        pts.append([None] * cols)
        noms.append(math.degrees(elevs[i]) if i < rows else -100 - i)
    for j, a in enumerate(azims):
        groove = 0.0035 * (math.sin(a * 23) + 0.6 * math.sin(a * 41 + 1.3)) + 0.002 * math.sin(a * 7)
        hd = Vector((math.sin(a), -math.cos(a), 0))
        hr_max, last = 0.0, None
        for i, e in enumerate(elevs):
            if raw[i][j] <= 0:
                continue
            p = centre + sphere_dir(e, a) * (env[i][j] + vol + groove * (1 - max(e, 0) / 1.6))
            hr = (p - centre).dot(hd)
            if hr >= hr_max:
                hr_max = hr
            elif e < 0:
                p = Vector((centre.x, centre.y, p.z)) + hd * hr_max
            pts[i][j] = p
            last = p
        if last is None:
            continue
        end = length + 0.02 * math.sin(a * 7) + 0.012 * math.sin(a * 17 + 1)
        for k in range(ext):
            t = (k + 1) / ext
            z = last.z + (end - last.z) * t
            if z > last.z:
                z = last.z - 0.001 * (k + 1)
            pts[rows + k][j] = Vector((centre.x, centre.y, z)) + hd * (hr_max + g.get("flare", 0.03) * t ** 1.5)

    def keep(i, j, p):
        a = azims[j]
        ragged = 2.5 * math.sin(a * 19) + 1.5 * math.sin(a * 31 + 2) if abs(a) < 1.3 else 0.0
        return noms[i] >= hairline(a) + ragged

    hair = grid_object("hair_gen", pts, mat, True, keep, centre)
    me = hair.data
    uv = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        a = math.atan2(co.x - centre.x, -(co.y - centre.y))
        uv.data[loop.index].uv = (a / (2 * math.pi) * 4 + 0.5, min(max((centre.z + 0.2 - co.z) / 0.5, 0), 1))
    soften(hair, 1, 0.25)
    solidify(hair, g.get("thickness", 0.012), -1.0)
    smooth_shading(hair, 70)
    out = [hair]
    if g.get("ponytail"):
        back = centre + sphere_dir(math.radians(-12), math.pi) * ((caster.inward(centre, sphere_dir(math.radians(-12), math.pi), 0.5) or 0.09) + vol)
        path = [back + Vector((0, -0.02, 0.0)), back + Vector((0, 0.012, -0.03)), back + Vector((0, 0.02, -0.08)),
                back + Vector((0, 0.018, -0.13)), back + Vector((0, 0.012, -0.17)), back + Vector((0, 0.008, -0.2))]
        bm = bmesh.new()
        tube(bm, path, [0.017, 0.016, 0.015, 0.013, 0.01, 0.004], 12)
        tail = link("ponytail", bm, mat)
        planar_uv(tail, 3.0, (0, 2))
        smooth_shading(tail, 70)
        bm = bmesh.new()
        tube(bm, [path[1] + Vector((0, -0.006, 0.008)), path[1] + Vector((0, 0.004, -0.006))], 0.019, 12)
        tie = link("ponytail_tie", bm, own(material("hair_tie", g.get("tie", (0.1, 0.06, 0.03)), 0.7)))
        smooth_shading(tie)
        out += [tail, tie]
    if grey:
        # Grey at the temples: a second material on the side faces above the ears.
        gmat = textured("hair_grey", pattern_image("hair_grey_strands", strands(Vector(grey), Vector(grey)), 256), 0.6, 0.0)
        me.materials.append(gmat)
        for poly in me.polygons:
            c = hair.matrix_world @ poly.center
            a = abs(math.degrees(math.atan2(c.x - centre.x, -(c.y - centre.y))))
            if 50 < a < 110 and centre.z - 0.06 < c.z < centre.z + 0.06:
                poly.material_index = 1
    for o in out:
        set_weights(o, ctx["arm"], lambda co: {"Head": 1.0})
    return out


GARMENTS = {
    "breastplate": g_breastplate,
    "pauldrons": g_pauldrons,
    "robe": g_robe,
    "tunic": g_tunic,
    "cape": g_cape,
    "collar": g_collar,
    "vcollar": g_vcollar,
    "cap": g_cap,
    "baldric": g_baldric,
    "belt": g_belt,
    "chains": g_chains,
    "hair": g_hair,
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


def fist_grip(ctx, clip="idle", frame=0.3):
    """Where the right fist's hole is, as a rest-pose world matrix: Z runs through the fist from the little finger
    to the index finger (where a blade or staff head comes out) and X points to the knuckles. Measured in a
    clip with the hand closed, then carried back to the rest pose through the hand bone, so the weapon parented
    to `hand_r` sits in the closed hand whatever the clip."""
    arm = ctx["arm"]
    arm.data.pose_position = "POSE"
    bind_action(arm, ctx["actions"][ctx["clips"][clip]], frame)
    bpy.context.view_layer.update()
    pose = {b.name: (arm.matrix_world @ b.head, arm.matrix_world @ b.tail) for b in arm.pose.bones}
    fingers = ("index", "middle", "ring", "pinky")
    loops = []
    for f in fingers:
        pts = [pose[f"{f}_01_r"][0], pose[f"{f}_02_r"][0], pose[f"{f}_03_r"][0], pose[f"{f}_03_r"][1]]
        loops.append(sum(pts, Vector()) / 4)
    centre = sum(loops, Vector()) / 4
    axis = (loops[3] - loops[0]).normalized()
    knuckles = sum((pose[f"{f}_02_r"][0] for f in fingers), Vector()) / 4
    x = (knuckles - centre)
    x = (x - axis * x.dot(axis)).normalized()
    y = axis.cross(x)
    posed = Matrix((x, y, axis)).transposed().to_4x4()
    posed.translation = centre
    pb = arm.pose.bones["hand_r"]
    hand_posed = arm.matrix_world @ pb.matrix
    hand_rest = arm.matrix_world @ pb.bone.matrix_local
    arm.animation_data.action = None
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    return hand_rest @ hand_posed.inverted() @ posed


def rapier_mesh(g):
    """Rapier: a long slim diamond blade, straight quillons, a knuckle bow from the front quillon to the pommel,
    a side ring, a wire-bound grip and a round pommel. Built along +Z with the knuckles towards +X."""
    steel = own(material("blade", g.get("blade", (0.74, 0.76, 0.8)), 0.22, 0.95))
    hilt = own(material("hilt", g.get("guard", (0.5, 0.44, 0.3)), 0.32, 0.9))
    grip_m = own(material("grip", g.get("grip", (0.1, 0.06, 0.04)), 0.6))
    L = g.get("length", 0.98)
    bm = bmesh.new()
    rings = []
    for z, w, t in [(0.0, 0.009, 0.006), (0.06, 0.009, 0.006), (0.08, 0.0115, 0.0045), (L * 0.85, 0.006, 0.003), (L, 0.0004, 0.0004)]:
        rings.append([bm.verts.new(p) for p in ((w, 0, z), (0, t, z), (-w, 0, z), (0, -t, z))])
    for r in range(len(rings) - 1):
        for i in range(4):
            bm.faces.new((rings[r][i], rings[r][(i + 1) % 4], rings[r + 1][(i + 1) % 4], rings[r + 1][i]))
    bm.faces.new(rings[0][::-1])
    blade = link("blade", bm, steel)
    smooth_shading(blade, 25)
    bm = bmesh.new()
    tube(bm, [Vector((-0.11, 0, 0.0)), Vector((0, 0, 0.0)), Vector((0.11, 0, 0.0))], 0.0065, 8)
    for sx in (-1, 1):
        k = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=8, radius=0.012)
        bmesh.ops.translate(bm, verts=k["verts"], vec=(sx * 0.115, 0, 0.0))
    # Knuckle bow: from the front quillon round in front of the fingers down to the pommel.
    bow = [Vector((0.07, 0, -0.01))] + [Vector((0.075 - 0.06 * t ** 2, 0, -0.03 - 0.16 * t)) for t in lin(0.0, 1.0, 9)]
    tube(bm, bow, 0.0055, 8)
    ring = [Vector((0.03 * math.cos(t), -0.038 + 0.03 * math.sin(t), 0.008)) for t in lin(0, 2 * math.pi, 20)]
    tube(bm, ring, 0.0045, 6)
    guard = link("guard", bm, hilt)
    smooth_shading(guard, 50)
    bm = bmesh.new()
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.015, radius2=0.013, depth=0.15)
    bmesh.ops.translate(bm, verts=geom["verts"], vec=(0, 0, -0.09))
    for k in range(9):
        r = bmesh.ops.create_cone(bm, cap_ends=False, segments=12, radius1=0.0158, radius2=0.0158, depth=0.006)
        bmesh.ops.translate(bm, verts=r["verts"], vec=(0, 0, -0.025 - k * 0.0145))
    grip = link("grip", bm, grip_m)
    bm = bmesh.new()
    geom = bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=0.024)
    bmesh.ops.scale(bm, verts=geom["verts"], vec=(1, 1, 0.85))
    bmesh.ops.translate(bm, verts=geom["verts"], vec=(0, 0, -0.185))
    pommel = link("pommel", bm, hilt)
    for o in (grip, pommel):
        smooth_shading(o, 40)
    return [blade, guard, grip, pommel]


WEAPONS = {"sword": sword_mesh, "staff": staff_mesh, "rapier": rapier_mesh}
# How far along the weapon (from the guard, or the staff's wrap) the fist closes.
HOLD = {"sword": 0.1, "staff": 0.0, "rapier": 0.085}


def attach_weapon(ctx, w):
    """Build the weapon along +Z with its grip at the origin, put it in the closed right fist (see fist_grip)
    and parent it to the right hand bone."""
    arm = ctx["arm"]
    parts = WEAPONS[w["type"]](w)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    weapon = bpy.context.view_layer.objects.active
    weapon.name = "weapon"
    grip = fist_grip(ctx, w.get("grip_clip", "idle"), w.get("grip_frame", 0.3))
    # Slide the weapon so the middle of its grip, not the guard, is in the fist.
    grip = grip @ Matrix.Translation((0, 0, w.get("hold", HOLD[w["type"]])))
    if w.get("spin"):
        grip = grip @ Matrix.Rotation(math.radians(w["spin"]), 4, "Z")
    if w.get("slide"):
        grip = grip @ Matrix.Translation((0, 0, w["slide"]))
    weapon.matrix_world = grip
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


def scale_brows(obj, f):
    """Thin each eyebrow (the kit's are heavy): squash it towards its own centre line, keeping its length."""
    me = obj.data
    mw = obj.matrix_world
    inv = mw.inverted()
    for side in (-1, 1):
        vs = [(v, mw @ v.co) for v in me.vertices if (mw @ v.co).x * side > 0]
        if not vs:
            continue
        c = sum((w for _, w in vs), Vector()) / len(vs)
        for v, w in vs:
            w = Vector((w.x, c.y + (w.y - c.y) * (0.5 + f / 2), c.z + (w.z - c.z) * f))
            v.co = inv @ w


def head_only(obj):
    """Keep the base character's head and neck (the outfit is the rest of the body)."""
    names = [g.name for g in obj.vertex_groups]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    layer = bm.verts.layers.deform.active
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not top_bone(v, layer, names).startswith(("Head", "neck"))], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def clear_face(obj):
    """Drop hair that hangs in front of the face (the kit's long hair has locks over the brows)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    mw = obj.matrix_world
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if (lambda c: c.y < -0.06 and abs(c.x) < 0.075 and 1.6 < c.z < 1.8)(mw @ v.co)], context="VERTS")
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
    if style == "stubble":
        # Close-cropped: pull every beard vertex most of the way back to the face.
        pts = [mw @ v.co for v in bm.verts]
        c = sum(pts, Vector()) / len(pts) + Vector((0, 0.07, 0.03))
        inv = mw.inverted()
        for v, p in zip(bm.verts, pts):
            v.co = inv @ (c + (p - c) * 0.9)
    bm.to_mesh(obj.data)
    bm.free()


def keep_materials(tex_cap):
    """Base colour stays; normal maps stay when their image loaded; metal/roughness maps go."""
    for mat in bpy.data.materials:
        if not mat.use_nodes or mat.get("own"):
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
    if os.environ.get("PARTY_CLOSE"):
        closeups(job, arm, actions, clips, s)


def closeups(job, arm, actions, clips, s):
    """Close renders of the right hand in the sword stances and of the head (PARTY_CLOSE=1): checks the grip."""
    scene = bpy.context.scene
    cam = scene.camera
    cam.data.lens = 85
    scene.render.resolution_x, scene.render.resolution_y = 420, 420
    shots = [("hand", "idle", 0.3, "hand_r", 0.75, (0.6, -1, 0.3)), ("hand", "idle", 0.3, "hand_r", 0.75, (-0.3, -0.2, 1)),
             ("hand", "attack", 0.45, "hand_r", 0.8, (0.5, -1, 0.2)), ("hand", "walk", 0.25, "hand_r", 0.8, (1, -0.5, 0.2)),
             ("head", "idle", 0.3, "Head", 0.9, (0.2, -1, 0.05)), ("head", "idle", 0.3, "Head", 0.9, (1, -0.1, 0.05)),
             ("head", "idle", 0.3, "Head", 0.9, (-0.3, 1, 0.1)), ("waist", "idle", 0.3, "pelvis", 1.6, (0.3, -1, 0.1)),
             ("chest", "idle", 0.3, "spine_03", 1.4, (0.4, -1, 0.3)), ("chest", "attack", 0.45, "spine_03", 1.6, (-0.6, -1, 0.3))]
    for k, (tag, state, frame, bone, dist, d) in enumerate(shots):
        bind_action(arm, actions[clips[state]], frame)
        bpy.context.view_layer.update()
        centre = arm.matrix_world @ arm.pose.bones[bone].head
        cam.location = centre + Vector(d).normalized() * dist * s
        cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.abspath(f"{job['preview']}_close_{k}_{tag}_{state}.png")
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
        elif o.type == "MESH" and o.name.startswith("Eyebrows"):
            scale_brows(o, job.get("brow_scale", 0.6))
            if job.get("brow_color"):
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
            if key == "hair" and job.get("face_clear"):
                clear_face(o)
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
           "objs": list(objs), "layers": [],
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
