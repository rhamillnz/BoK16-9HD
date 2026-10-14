"""Detailed prop builders (second art pass), registered into build_props.BUILDERS.

Every part here is textured: kit texture crops (stone, wood, bark) projected along the part's
dominant axis, plus generated images for carved or painted writing (pseudo-script, not legible),
tree rings and dirt. Stones and posts reach below z = 0 so they sit in the ground rather than on it;
jobs using these builders set "fit": "height" so the model keeps its proportions.
"""
import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

# ---------------------------------------------------------------------------------------------
# Images


def _find(kit, filename):
    for d in kit.dirs:
        p = os.path.join(d, filename)
        if os.path.exists(p):
            return os.path.abspath(p)
    raise FileNotFoundError(filename)


_SRC = {}


def _pixels(kit, filename):
    """Kit texture as an (h, w, 4) float array, row 0 at the top."""
    if filename not in _SRC:
        img = bpy.data.images.load(_find(kit, filename))
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        _SRC[filename] = px.reshape(h, w, 4)[::-1].copy()
        bpy.data.images.remove(img)
    return _SRC[filename]


def _resize(px, w, h):
    """Nearest-neighbour resample (enough for 256 px tiles)."""
    sh, sw = px.shape[:2]
    ys = (np.arange(h) * sh / h).astype(int)
    xs = (np.arange(w) * sw / w).astype(int)
    return px[ys][:, xs]


def _image(name, px):
    h, w = px.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.pixels.foreach_set(np.ascontiguousarray(px[::-1]).reshape(-1))
    img.pack()
    return img


# Named texture swatches: (file, crop rows as fractions top..bottom, crop cols, tint).
SWATCHES = {
    "stone": ("T_RockTrim_BaseColor.png", (0.34, 0.45), (0.0, 1.0), (1.0, 1.0, 1.0)),
    "stone_dark": ("T_RockTrim_BaseColor.png", (0.34, 0.45), (0.0, 1.0), (0.62, 0.64, 0.66)),
    "stone_blue": ("T_RockTrim_BaseColor.png", (0.34, 0.45), (0.0, 1.0), (0.62, 0.68, 0.86)),
    "bricks": ("T_RedBrick_BaseColor.png", (0.0, 1.0), (0.0, 1.0), (0.85, 0.8, 0.78)),
    "plank": ("T_WoodTrim_BaseColor.png", (0.0, 0.3), (0.0, 1.0), (1.0, 1.0, 1.0)),
    "plank_dark": ("T_WoodTrim_BaseColor.png", (0.32, 0.6), (0.0, 1.0), (1.0, 1.0, 1.0)),
    "bark": ("Bark_NormalTree.png", (0.0, 1.0), (0.0, 1.0), (0.85, 0.8, 0.75)),
    "bark_grey": ("Bark_DeadTree.png", (0.0, 1.0), (0.0, 1.0), (1.0, 1.0, 1.0)),
}


def swatch(kit, key, size=256):
    f, (r0, r1), (c0, c1), tint = SWATCHES[key]
    src = _pixels(kit, f)
    h, w = src.shape[:2]
    crop = src[int(r0 * h):max(int(r0 * h) + 1, int(r1 * h)), int(c0 * w):max(int(c0 * w) + 1, int(c1 * w))]
    px = _resize(crop, size, size).copy()
    px[..., :3] *= np.array(tint, dtype=np.float32)
    return px


def noise_tile(size, base, spread, seed, blobs=60):
    """Soft blotchy colour tile (dirt, sacking, hide): base colour +- spread, wrapping at the edges."""
    rnd = np.random.default_rng(seed)
    acc = np.zeros((size, size), dtype=np.float32)
    yy, xx = np.mgrid[0:size, 0:size]
    for _ in range(blobs):
        cx, cy = rnd.uniform(0, size, 2)
        r = rnd.uniform(size * 0.04, size * 0.16)
        dx = np.minimum(abs(xx - cx), size - abs(xx - cx))
        dy = np.minimum(abs(yy - cy), size - abs(yy - cy))
        acc += rnd.uniform(-1, 1) * np.exp(-(dx * dx + dy * dy) / (2 * r * r))
    acc += rnd.uniform(-0.35, 0.35, (size, size))
    acc /= max(1e-6, np.abs(acc).max())
    px = np.ones((size, size, 4), dtype=np.float32)
    for c in range(3):
        px[..., c] = np.clip(base[c] + spread * acc * (0.8 + 0.2 * c), 0, 1)
    return px


def weave(px, period=6, depth=0.12):
    """Criss-cross weave shading for sacking and cloth."""
    h, w = px.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    m = 1 - depth * (((xx // period) + (yy // period)) % 2)
    px[..., :3] *= m[..., None]
    return px


# --- writing -----------------------------------------------------------------------------------

_GRID = [(x / 2, y / 3) for x in range(3) for y in range(4)]


def _alphabet(seed, n=22):
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        strokes = []
        for _ in range(rnd.choice((1, 2, 2, 3))):
            pts = rnd.sample(_GRID, rnd.choice((2, 2, 3)))
            strokes.append(pts)
        out.append(strokes)
    return out


def _stamp(mask, x, y, r):
    h, w = mask.shape
    x0, x1 = max(0, int(x - r)), min(w, int(x + r) + 1)
    y0, y1 = max(0, int(y - r)), min(h, int(y + r) + 1)
    if x0 >= x1 or y0 >= y1:
        return
    yy, xx = np.mgrid[y0:y1, x0:x1]
    mask[y0:y1, x0:x1] |= (xx - x) ** 2 + (yy - y) ** 2 <= r * r


def writing_mask(w, h, rect, lines, seed, slant=0.0, centred=True):
    """Boolean mask of pseudo-script in rect (x0, y0, x1, y1, pixels, row 0 at the top)."""
    rnd = random.Random(seed)
    alpha = _alphabet(seed)
    mask = np.zeros((h, w), dtype=bool)
    x0, y0, x1, y1 = rect
    lh = (y1 - y0) / lines
    gh = lh * 0.62
    gw = gh * 0.62
    r = max(1.0, gh * 0.075)
    for li in range(lines):
        # A line is a few words; short last lines and centred layout read like an inscription.
        n = int((x1 - x0) / (gw * 1.3))
        n = max(2, n - (rnd.randint(0, n // 2) if centred else rnd.randint(0, 2)))
        words = []
        while sum(words) + len(words) < n - 1:
            words.append(rnd.randint(2, 5))
        total = (sum(words) + len(words) - 1) * gw * 1.3
        cx = x0 + ((x1 - x0) - total) / 2 if centred else x0
        cy = y0 + li * lh + (lh - gh) / 2
        for wi, wl in enumerate(words):
            for _ in range(wl):
                for stroke in alpha[rnd.randrange(len(alpha))]:
                    for (ax, ay), (bx, by) in zip(stroke, stroke[1:]):
                        steps = int(max(abs(bx - ax) * gw, abs(by - ay) * gh) / (r * 0.6)) + 2
                        for k in range(steps):
                            t = k / (steps - 1)
                            gx = ax + (bx - ax) * t
                            gy = ay + (by - ay) * t
                            _stamp(mask, cx + gx * gw * 0.8 + (1 - gy) * slant * gh, cy + gy * gh, r)
                cx += gw * 1.3
            cx += gw * 1.3
    return mask


def engrave(px, mask, depth=0.42):
    """Cut the mask into the surface: dark groove, light lower-right lip."""
    out = px.copy()
    lip = np.zeros_like(mask)
    lip[2:, 2:] = mask[:-2, :-2]
    lip &= ~mask
    out[..., :3][mask] *= depth
    out[..., :3][lip] = np.clip(out[..., :3][lip] * 1.25, 0, 1)
    return out


def paint(px, mask, rgb):
    out = px.copy()
    out[..., :3][mask] = np.array(rgb, dtype=np.float32) * (0.9 + 0.1 * out[..., :3][mask] / max(1e-3, out[..., :3].max()))
    return out


def border(mask_shape, inset, r):
    """Mask of a rectangular frame `inset` pixels from the edge."""
    h, w = mask_shape
    m = np.zeros((h, w), dtype=bool)
    m[inset:inset + r, inset:w - inset] = True
    m[h - inset - r:h - inset, inset:w - inset] = True
    m[inset:h - inset, inset:inset + r] = True
    m[inset:h - inset, w - inset - r:w - inset] = True
    return m


# ---------------------------------------------------------------------------------------------
# Materials and meshes

_MATS = {}


def tex_material(name, img, roughness=0.9, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return m


def swatch_material(kit, key, roughness=0.9):
    if key not in _MATS:
        _MATS[key] = tex_material(key, _image(key, swatch(kit, key)), roughness)
    return _MATS[key]


def noise_material(key, base, spread, seed, roughness=0.95, woven=False):
    if key not in _MATS:
        px = noise_tile(128, base, spread, seed)
        if woven:
            px = weave(px)
        _MATS[key] = tex_material(key, _image(key, px), roughness)
    return _MATS[key]


def project_uvs(obj, scale):
    """Box-project UVs from world coordinates: `scale` texture repeats per render unit."""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    mw = obj.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    for p in me.polygons:
        n = (nm @ p.normal).normalized()
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                u, v = co.y * math.copysign(1, n.x), co.z
            elif ax == 1:
                u, v = -co.x * math.copysign(1, n.y), co.z
            else:
                u, v = co.x, co.y
            uv[li].uv = (u * scale, v * scale)


def _link(kit, name, bm, material, mat_world, smooth=False):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new(name, mesh)
    kit.scene.collection.objects.link(o)
    o.data.materials.append(material)
    o.matrix_world = mat_world
    for p in o.data.polygons:
        p.use_smooth = smooth
    kit.parts.append(o)
    return o


def _xf(loc, rot_deg=(0, 0, 0), size=(1, 1, 1)):
    return Matrix.Translation(loc) @ Euler([math.radians(a) for a in rot_deg]).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1.0))


def part(kit, kind, loc, size, material, rot_deg=(0, 0, 0), segments=16, uv=1.0, smooth=False, taper=1.0, bevel=0.0):
    """Textured primitive. kinds: box, cylinder (taper = top/bottom radius), sphere, roundtop
    (box whose top is a half-cylinder across X), pyramid. Sizes are full extents."""
    bm = bmesh.new()
    if kind == "box":
        bmesh.ops.create_cube(bm, size=1.0)
    elif kind == "cylinder":
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=0.5, radius2=0.5 * taper, depth=1.0)
    elif kind == "sphere":
        bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=max(6, segments // 2), radius=0.5)
    elif kind == "pyramid":
        bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.5 * math.sqrt(2), radius2=0.0, depth=1.0)
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(45), 3, "Z"))
    elif kind == "roundtop":
        # Profile in XZ: rectangle 1 wide from z=-0.5 up to z=0, then a half circle of radius 0.5; extruded along Y.
        prof = [(-0.5, -0.5), (0.5, -0.5)]
        for i in range(segments + 1):
            a = i / segments * math.pi
            prof.append((0.5 * math.cos(a), 0.5 * math.sin(a) * 1.0))
        front = [bm.verts.new((x, -0.5, z)) for x, z in prof]
        back = [bm.verts.new((x, 0.5, z)) for x, z in prof]
        n = len(prof)
        bm.faces.new(front[::-1])
        bm.faces.new(back)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((front[i], front[j], back[j], back[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel > 0 and kind in ("box", "roundtop"):
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect="EDGES", clamp_overlap=True)
    o = _link(kit, kind, bm, material, _xf(loc, rot_deg, size), smooth)
    project_uvs(o, uv)
    return o


def panel(kit, loc, w, h, img_px, name, rot_deg=(0, 0, 0), roughness=0.9):
    """Flat quad facing -Y (before rotation) showing `img_px` once across it; for writing on faces."""
    bm = bmesh.new()
    vs = [bm.verts.new((x * w / 2, 0, z * h / 2)) for x, z in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bm.faces.new(vs)
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            lp[uvl].uv = (u, v)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bm.faces[0].normal.y > 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    mat = tex_material(name, _image(name, img_px), roughness)
    return _link(kit, name, bm, mat, _xf(loc, rot_deg))


def inscription(kit, key, w_units, h_units, seed, lines, mode="engrave", ink=(0.92, 0.88, 0.75), frame=True, px_per_unit=110):
    """Swatch `key` resized to the face's aspect with pseudo-script on it."""
    w = int(max(32, min(512, w_units * px_per_unit)))
    h = int(max(32, min(512, h_units * px_per_unit)))
    base = _resize(swatch(kit, key, 256), w, h).copy()
    pad = int(min(w, h) * 0.12)
    m = writing_mask(w, h, (pad, pad, w - pad, h - pad), lines, seed)
    if frame and min(w, h) > 60:
        m |= border((h, w), max(3, pad // 3), max(1, pad // 8))
    return engrave(base, m) if mode == "engrave" else paint(base, m, ink)


def curve_tube(kit, points, radius, material, name="tube", resolution=6):
    """A tube along a polyline (rope, string, wire)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 1
    cu.resolution_u = 2
    sp = cu.splines.new("POLY")
    sp.points.add(len(points) - 1)
    for p, c in zip(sp.points, points):
        p.co = (*c, 1.0)
    ob = bpy.data.objects.new(name, cu)
    kit.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob, do_unlink=True)
    o = bpy.data.objects.new(name, me)
    kit.scene.collection.objects.link(o)
    o.data.materials.clear()
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = True
    project_uvs(o, 4.0)
    kit.parts.append(o)
    return o


def helix(cx, cy, z0, z1, r, turns, n_per_turn=14):
    pts = []
    n = max(2, int(turns * n_per_turn))
    for i in range(n + 1):
        t = i / n
        a = t * turns * math.tau
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a), z0 + (z1 - z0) * t))
    return pts


def lumpy(o, amount, seed, flat_bottom=None):
    """Jitter vertices outward/inward for a hand-made look; optionally clamp the bottom flat."""
    rnd = random.Random(seed)
    for v in o.data.vertices:
        k = 1 + rnd.uniform(-amount, amount)
        v.co.x *= k
        v.co.y *= k
        if flat_bottom is not None and v.co.z < flat_bottom:
            v.co.z = flat_bottom
    o.data.update()


# ---------------------------------------------------------------------------------------------
# Builders


def build_gravestone(kit, job, flat_material):
    """Textured headstones with a carved inscription front and back; all reach 0.35 below ground."""
    v = job.get("variant", 0)
    key = job.get("stone", "stone")
    stone = swatch_material(kit, key)
    dark = swatch_material(kit, "stone_dark")
    seed = 11 + v * 7
    bury = 0.35
    W, D, H = {0: (1.5, 0.3, 2.2), 1: (1.4, 0.3, 2.5), 2: (1.6, 0.42, 1.7), 3: (1.0, 0.28, 2.6), 4: (1.5, 0.3, 1.9)}[v]
    grp = []
    if v == 0:  # rounded headstone
        body = H - W / 2
        grp.append(part(kit, "box", (0, 0, (body - bury) / 2), (W, D, body + bury), stone, bevel=0.03))
        grp.append(part(kit, "roundtop", (0, 0, body), (W, D, W), stone, segments=20, bevel=0.02))
        face = (W * 0.78, body * 0.8, body * 0.55)
    elif v == 1:  # Celtic-style cross with a ring
        grp.append(part(kit, "box", (0, 0, (H * 0.95 - bury) / 2), (0.36, D, H * 0.95 + bury), stone, bevel=0.03))
        grp.append(part(kit, "box", (0, 0, H * 0.68), (W, D, 0.34), stone, bevel=0.03))
        for a in range(0, 360, 30):
            ra = math.radians(a)
            grp.append(part(kit, "box", (math.cos(ra) * 0.42, 0, H * 0.68 + math.sin(ra) * 0.42), (0.24, D * 0.8, 0.11), stone, rot_deg=(0, -a + 90, 0)))
        grp.append(part(kit, "box", (0, 0, 0.12), (0.9, D * 1.8, 0.24 + bury), dark, bevel=0.03))
        face = (0.3, H * 0.4, H * 0.3)
    elif v == 2:  # chest-high block with a sloped cap
        grp.append(part(kit, "box", (0, 0, (H * 0.85 - bury) / 2), (W, D, H * 0.85 + bury), stone, bevel=0.04))
        grp.append(part(kit, "box", (0, 0, H * 0.9), (W * 1.1, D * 1.2, H * 0.12), dark, bevel=0.04))
        grp.append(part(kit, "pyramid", (0, 0, H * 0.98), (W * 1.0, D * 1.05, H * 0.08), dark))
        face = (W * 0.82, H * 0.62, H * 0.45)
    elif v == 3:  # tall slab with a pointed arch
        body = H - W * 0.6
        grp.append(part(kit, "box", (0, 0, (body - bury) / 2), (W, D, body + bury), stone, bevel=0.03))
        grp.append(part(kit, "pyramid", (0, 0, body + W * 0.3), (W, D, W * 0.6), stone))
        face = (W * 0.75, body * 0.75, body * 0.5)
    else:  # old leaning stone with a chipped corner; its whole foot stays underground
        body = H - W / 2
        lean = []
        lean.append(part(kit, "box", (0, 0, (body - 0.7) / 2), (W, D, body + 0.7), stone, bevel=0.03))
        lean.append(part(kit, "roundtop", (0, 0, body), (W, D, W), stone, segments=20, bevel=0.02))
        lean.append(part(kit, "box", (W * 0.45, 0, body + W * 0.3), (0.4, D * 1.2, 0.3), dark, rot_deg=(0, 30, 0)))
        txt = inscription(kit, key, W * 0.78, body * 0.8, seed, 4)
        for sy, ry in ((-1, 0), (1, 180)):
            lean.append(panel(kit, (0, sy * (D / 2 + 0.004), body * 0.55), W * 0.78, body * 0.8, txt, f"txt{v}{sy}", rot_deg=(0, 0, ry)))
        tilt = _xf((0, 0, 0), (0, 10, 4))
        for o in lean:
            o.matrix_world = tilt @ o.matrix_world
        # Heaped earth around the foot hides the gap a tilted stone leaves.
        earth = noise_material("earth", (0.2, 0.13, 0.07), 0.07, 5)
        part(kit, "sphere", (0, 0, -0.18), (W * 1.3, D * 3.2, 0.5), earth, segments=14, smooth=True)
        return
    txt = inscription(kit, key, face[0], face[1], seed, 4 if v != 1 else 5)
    for sy, ry in ((-1, 0), (1, 180)):
        panel(kit, (0, sy * (D / 2 + 0.004), face[2]), face[0], face[1], txt, f"txt{v}{sy}", rot_deg=(0, 0, ry))
    earth = noise_material("earth", (0.2, 0.13, 0.07), 0.07, 5)
    part(kit, "sphere", (0, -D * 0.2, -0.12), (W * 1.2, D * 2.6, 0.36), earth, segments=14, smooth=True)


def build_tomb(kit, job, flat_material):
    """Box tomb: plinth, carved chest with a lid, and a headstone standing on the lid."""
    stone = swatch_material(kit, "stone")
    dark = swatch_material(kit, "stone_dark")
    L, W, H = 2.3, 1.1, 0.95
    part(kit, "box", (0, 0, 0.0), (L + 0.25, W + 0.25, 0.3), dark, bevel=0.04)
    part(kit, "box", (0, 0, 0.15 + H / 2), (L, W, H), stone, bevel=0.03)
    part(kit, "box", (0, 0, 0.15 + H + 0.08), (L + 0.18, W + 0.18, 0.16), dark, bevel=0.04)
    side = inscription(kit, "stone", L * 0.85, H * 0.7, 41, 2)
    for sy, ry in ((-1, 0), (1, 180)):
        panel(kit, (0, sy * (W / 2 + 0.004), 0.15 + H / 2), L * 0.85, H * 0.7, side, f"tombside{sy}", rot_deg=(0, 0, ry))
    end = inscription(kit, "stone", W * 0.75, H * 0.6, 43, 2)
    for sx, rz in ((-1, -90), (1, 90)):
        panel(kit, (sx * (L / 2 + 0.004), 0, 0.15 + H / 2), W * 0.75, H * 0.6, end, f"tombend{sx}", rot_deg=(0, 0, rz))
    # Headstone at the +X end of the lid.
    top = 0.15 + H + 0.16
    hw, hh, hd = 0.9, 0.9, 0.2
    part(kit, "box", (L / 2 - 0.3, 0, top + (hh - hw / 2) / 2), (hd, hw, hh - hw / 2), stone, bevel=0.02)
    part(kit, "roundtop", (L / 2 - 0.3, 0, top + hh - hw / 2), (hw, hd, hw), stone, rot_deg=(0, 0, 90), segments=16, bevel=0.02)
    head = inscription(kit, "stone", hw * 0.75, (hh - hw / 2) * 0.9 + 0.2, 47, 3)
    panel(kit, (L / 2 - 0.3 - hd / 2 - 0.004, 0, top + (hh - hw / 2) / 2 + 0.08), hw * 0.75, (hh - hw / 2) * 0.9 + 0.2, head, "tombhead", rot_deg=(0, 0, -90))


def build_waymark(kit, job, flat_material):
    """Three distinct carved waystones, writing on two faces: obelisk, milestone, wayside shrine."""
    v = job.get("variant", 0)
    stone = swatch_material(kit, "stone")
    dark = swatch_material(kit, "stone_dark")
    bury = 0.3
    if v == 0:  # obelisk on two steps
        part(kit, "box", (0, 0, 0.1 - bury / 2), (1.6, 1.6, 0.2 + bury), dark, bevel=0.04)
        part(kit, "box", (0, 0, 0.3), (1.25, 1.25, 0.2), dark, bevel=0.04)
        part(kit, "cylinder", (0, 0, 1.55), (0.85, 0.85, 2.3), stone, segments=4, taper=0.78, rot_deg=(0, 0, 45))
        part(kit, "pyramid", (0, 0, 2.95), (0.66, 0.66, 0.5), stone)
        txt = inscription(kit, "stone", 0.42, 1.4, 61, 6)
        # Shaft faces sit 0.30 out at the foot and 0.234 at the top: lean the panels with them.
        for k in range(4):
            a = k * 90
            d = 0.272
            panel(kit, (math.sin(math.radians(a)) * d, -math.cos(math.radians(a)) * d, 1.5), 0.42, 1.4, txt, f"ob{k}", rot_deg=(-1.65, 0, a))
    elif v == 1:  # milestone: squat rounded block with an arrow and a line of text
        part(kit, "box", (0, 0, (1.7 - bury) / 2), (1.5, 0.75, 1.7 + bury), stone, bevel=0.05)
        part(kit, "roundtop", (0, 0, 1.7), (1.5, 0.75, 1.5), stone, segments=18, bevel=0.03)
        w, h = 1.2, 1.7
        px = _resize(swatch(kit, "stone"), int(w * 140), int(h * 140)).copy()
        m = writing_mask(px.shape[1], px.shape[0], (16, 16, px.shape[1] - 16, int(px.shape[0] * 0.55)), 3, 63)
        # Carved arrow under the text.
        H_, W_ = px.shape[:2]
        ay = int(H_ * 0.75)
        for x in range(int(W_ * 0.18), int(W_ * 0.8)):
            _stamp(m, x, ay, 4)
        for k in range(26):
            _stamp(m, W_ * 0.8 - k, ay - k, 4)
            _stamp(m, W_ * 0.8 - k, ay + k, 4)
        img = engrave(px, m)
        for sy, ry in ((-1, 0), (1, 180)):
            panel(kit, (0, sy * 0.379, 1.45), w, h, img, f"mile{sy}", rot_deg=(0, 0, ry))
    else:  # wayside shrine: square pillar with a little gabled stone roof and a niche
        part(kit, "box", (0, 0, 0.12 - bury / 2), (1.4, 1.4, 0.24 + bury), dark, bevel=0.04)
        part(kit, "box", (0, 0, 1.3), (0.9, 0.9, 2.2), stone, bevel=0.04)
        part(kit, "box", (0, 0, 2.5), (1.15, 1.15, 0.2), dark, bevel=0.03)
        part(kit, "cylinder", (0, 0, 2.85), (1.5, 1.2, 0.5), dark, segments=3, rot_deg=(90, 0, 90))
        part(kit, "box", (0, -0.42, 2.0), (0.5, 0.1, 0.55), swatch_material(kit, "plank_dark"))
        part(kit, "sphere", (0, -0.47, 2.0), (0.16, 0.16, 0.22), flat_material("candle", (0.9, 0.75, 0.4), 0.6, glow=0.5), segments=8)
        txt = inscription(kit, "stone", 0.75, 1.15, 67, 5)
        for k, a in enumerate((0, 90, 180, 270)):
            d = 0.454
            z = 1.05 if a == 0 else 1.3
            panel(kit, (math.sin(math.radians(a)) * d, -math.cos(math.radians(a)) * d, z), 0.72, 1.1 if a == 0 else 1.6, txt, f"shr{k}", rot_deg=(0, 0, a))


def build_signboard(kit, job, flat_material):
    """Wooden signpost: textured post, pointing boards with painted writing on both sides."""
    post = swatch_material(kit, "bark_grey" if job.get("grey") else "plank_dark")
    n = job.get("boards", 1)
    H = 3.2
    bury = 0.35
    part(kit, "box", (0, 0, (H - bury) / 2), (0.22, 0.22, H + bury), post, bevel=0.02, uv=1.5)
    part(kit, "pyramid", (0, 0, H + 0.06), (0.22, 0.22, 0.12), post)
    ink = job.get("ink", (0.95, 0.92, 0.82))
    for i in range(n):
        z = H - 0.45 - i * 0.62
        side = 1 if i % 2 == 0 else -1
        bw, bh = 1.5, 0.45
        cx = side * (bw / 2 + 0.05)
        part(kit, "box", (cx, 0, z), (bw, 0.08, bh), swatch_material(kit, "plank"), rot_deg=(0, 0, 2 * side), bevel=0.01, uv=1.2)
        # Pointed end.
        part(kit, "cylinder", (cx + side * (bw / 2 + 0.16), 0, z), (0.36, bh * 1.05, 0.08), swatch_material(kit, "plank"), segments=3, rot_deg=(90, 0, 0 if side > 0 else 180))
        px = _resize(swatch(kit, "plank", 256), 300, 90).copy()
        m = writing_mask(300, 90, (18, 14, 282, 76), 1, 70 + i, centred=True)
        img = paint(px, m, ink)
        for sy, ry in ((-1, 0), (1, 180)):
            panel(kit, (cx, sy * 0.045, z), bw * 0.92, bh * 0.82, img, f"sign{i}{sy}", rot_deg=(0, 0, ry))
    if job.get("lantern"):
        glow = flat_material("lantern_glow", (1.0, 0.75, 0.35), 0.4, glow=1.6)
        iron = flat_material("iron", (0.07, 0.07, 0.08), 0.5)
        part(kit, "box", (0, -0.36, H - 0.15), (0.06, 0.6, 0.06), iron)
        part(kit, "box", (0, -0.62, H - 0.42), (0.26, 0.26, 0.36), glow)
        part(kit, "pyramid", (0, -0.62, H - 0.18), (0.3, 0.3, 0.14), iron)


def build_column(kit, job, flat_material):
    """Fluted column: stepped base, torus mouldings, entasis, capital, a few chips and moss."""
    key = job.get("stone", "stone_blue")
    stone = swatch_material(kit, key)
    dark = swatch_material(kit, "stone_dark")
    H = 6.8
    part(kit, "box", (0, 0, 0.0), (1.9, 1.9, 0.5), dark, bevel=0.05)
    part(kit, "box", (0, 0, 0.35), (1.6, 1.6, 0.2), stone, bevel=0.04)
    part(kit, "cylinder", (0, 0, 0.55), (1.4, 1.4, 0.2), stone, segments=24)
    part(kit, "cylinder", (0, 0, 0.7), (1.22, 1.22, 0.12), stone, segments=24)
    # Shaft: 20 flutes as alternating inner/outer vertices, gently narrower at the top.
    bm = bmesh.new()
    flutes, rings = 20, 8
    z0, z1 = 0.76, H - 0.95
    loops = []
    for r in range(rings + 1):
        t = r / rings
        z = z0 + (z1 - z0) * t
        rad = 0.55 * (1 - 0.1 * t) * (1 + 0.04 * math.sin(math.pi * t))
        ring = []
        for k in range(flutes * 2):
            a = k / (flutes * 2) * math.tau
            rr = rad * (0.93 if k % 2 else 1.0)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        loops.append(ring)
    for r in range(rings):
        a_, b_ = loops[r], loops[r + 1]
        n = len(a_)
        for k in range(n):
            bm.faces.new((a_[k], a_[(k + 1) % n], b_[(k + 1) % n], b_[k]))
    o = _link(kit, "shaft", bm, stone, Matrix.Identity(4))
    project_uvs(o, 1.0)
    part(kit, "cylinder", (0, 0, z1 + 0.06), (1.12, 1.12, 0.12), stone, segments=24)
    part(kit, "cylinder", (0, 0, z1 + 0.32), (1.4, 1.4, 0.4), stone, segments=24, taper=1.25)
    part(kit, "box", (0, 0, H - 0.22), (1.8, 1.8, 0.44), dark, bevel=0.04)
    # Weathering: a chipped corner on the capital and moss at the foot.
    part(kit, "box", (0.85, 0.85, H - 0.1), (0.4, 0.4, 0.3), dark, rot_deg=(20, -15, 45))
    moss = noise_material("moss", (0.14, 0.22, 0.07), 0.06, 9)
    for a in (30, 150, 260):
        ra = math.radians(a)
        part(kit, "sphere", (math.cos(ra) * 0.9, math.sin(ra) * 0.9, 0.2), (0.7, 0.45, 0.25), moss, segments=10, smooth=True)


def rings_image(size=256, seed=3):
    yy, xx = np.mgrid[0:size, 0:size]
    c = size / 2
    rnd = np.random.default_rng(seed)
    ang = np.arctan2(yy - c, xx - c)
    r = np.hypot(xx - c, yy - c) / c * (1 + 0.04 * np.sin(ang * 5 + 1.3))
    ring = 0.5 + 0.5 * np.sin(r * 38)
    px = np.ones((size, size, 4), dtype=np.float32)
    base = np.array((0.62, 0.44, 0.26))
    for k in range(3):
        px[..., k] = base[k] * (0.82 + 0.18 * ring) + rnd.uniform(-0.03, 0.03, (size, size))
    px[r > 0.92, :3] = (0.24, 0.15, 0.09)
    crack = (abs(ang - 0.6) < 0.025) & (r < 0.7)
    px[crack, :3] *= 0.45
    return np.clip(px, 0, 1)


def build_stump(kit, job, flat_material):
    """Low, round tree stump: bark sides, ringed top with a bevelled edge, roots spreading into the ground."""
    bark = swatch_material(kit, "bark")
    R, H = 0.85, 0.75
    s = part(kit, "cylinder", (0, 0, (H - 0.3) / 2), (2 * R, 2 * R, H + 0.3), bark, segments=18, taper=0.92, uv=1.2)
    lumpy(s, 0.05, 3)
    top = tex_material("rings", _image("rings", rings_image()), 0.85)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=18, radius=R * 0.9)
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            lp[uvl].uv = (lp.vert.co.x / (2 * R * 0.9) + 0.5, lp.vert.co.y / (2 * R * 0.9) + 0.5)
    _link(kit, "rings", bm, top, Matrix.Translation((0, 0, H + 0.005)))
    # Rounded rim between bark and rings.
    part(kit, "cylinder", (0, 0, H - 0.04), (2 * R * 0.97, 2 * R * 0.97, 0.1), bark, segments=18, taper=0.94)
    # Root flares: long, half-buried swellings hugging the ground, merging into the trunk.
    for k in range(6):
        a = k / 6 * math.tau + 0.3
        ln = 1.0 + 0.25 * math.sin(k * 2.1)
        part(kit, "sphere", (math.cos(a) * R * 0.95, math.sin(a) * R * 0.95, 0.0), (ln * 1.25, 0.42, 0.42), bark,
             segments=10, rot_deg=(0, 14, math.degrees(a)), uv=1.2, smooth=True)


def build_molehill(kit, job, flat_material):
    """Conical heap of loose earth with clods around the foot (a big molehill)."""
    dirt = noise_material("dirt", (0.24, 0.15, 0.08), 0.08, 13)
    dirt2 = noise_material("dirt2", (0.3, 0.2, 0.11), 0.07, 17)
    bm = bmesh.new()
    rings, seg = 7, 24
    rnd = random.Random(5)
    verts = []
    for r in range(rings + 1):
        t = r / rings
        z = 1.2 * (1 - t) ** 1.25 - 0.15
        rad = 1.55 * t
        ring = []
        for k in range(seg):
            a = k / seg * math.tau
            j = 1 + rnd.uniform(-0.08, 0.08) if 0 < r < rings else 1
            ring.append(bm.verts.new((rad * j * math.cos(a), rad * j * math.sin(a), z + (rnd.uniform(-0.04, 0.04) if r else 0))))
        verts.append(ring)
    for r in range(rings):
        a_, b_ = verts[r], verts[r + 1]
        for k in range(seg):
            bm.faces.new((a_[k], b_[k], b_[(k + 1) % seg], a_[(k + 1) % seg]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    o = _link(kit, "heap", bm, dirt, Matrix.Identity(4), smooth=True)
    project_uvs(o, 1.5)
    for k in range(9):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(1.0, 1.7)
        sz = rnd.uniform(0.18, 0.34)
        part(kit, "sphere", (math.cos(a) * d, math.sin(a) * d, sz * 0.15), (sz * 1.3, sz, sz * 0.8), dirt2 if k % 2 else dirt, segments=8, smooth=True, uv=1.5)


def build_ropepost(kit, job, flat_material):
    """Stout post with rope wound round it, a loose end and a coil lying at its foot."""
    wood = swatch_material(kit, "bark")
    rope = noise_material("rope", (0.55, 0.45, 0.28), 0.06, 21)
    H, R = 3.6, 0.22
    part(kit, "cylinder", (0, 0, (H - 0.4) / 2), (2 * R, 2 * R, H + 0.4), wood, segments=12, taper=0.9, uv=1.5)
    part(kit, "cylinder", (0, 0, H + 0.04), (2 * R * 0.9, 2 * R * 0.9, 0.08), swatch_material(kit, "plank"), segments=12)
    curve_tube(kit, helix(0, 0, H * 0.62, H * 0.82, R * 0.96, 4.5), 0.05, rope, "wrap")
    curve_tube(kit, helix(0, 0, H * 0.18, H * 0.3, R * 1.0, 2.5), 0.05, rope, "wrap2")
    # Loose end hanging from the upper wrap down to the coil.
    curve_tube(kit, [(R, 0, H * 0.62), (R + 0.12, -0.05, H * 0.45), (R + 0.2, -0.1, H * 0.2), (R + 0.35, -0.2, 0.08)], 0.05, rope, "end")
    coil = []
    for i in range(4):
        coil += helix(R + 0.75, -0.35, 0.05 + i * 0.07, 0.05 + i * 0.07 + 0.001, 0.45 - i * 0.03, 1.0, 16)
    curve_tube(kit, coil, 0.05, rope, "coil")


def build_scarecrow(kit, job, flat_material):
    """Post and crossbar, stuffed shirt with patches and straw cuffs, sack head with a stitched face, straw hat."""
    wood = swatch_material(kit, "bark_grey")
    shirt = noise_material("shirt", (0.42, 0.22, 0.14), 0.06, 31, woven=True)
    patch = noise_material("patch", (0.26, 0.32, 0.45), 0.05, 33, woven=True)
    trousers = noise_material("trousers", (0.3, 0.27, 0.2), 0.05, 35, woven=True)
    sack = noise_material("sack", (0.66, 0.55, 0.36), 0.05, 37, woven=True)
    straw = noise_material("straw", (0.78, 0.64, 0.28), 0.1, 39)
    black = flat_material("stitch", (0.05, 0.04, 0.03), 0.9)
    rope = noise_material("rope", (0.55, 0.45, 0.28), 0.06, 21)
    # Post into the ground and crossbar.
    part(kit, "cylinder", (0, 0, 1.5), (0.16, 0.16, 3.6), wood, segments=8, uv=1.5)
    part(kit, "cylinder", (0, 0, 3.0), (0.12, 0.12, 3.5), wood, segments=8, rot_deg=(0, 90, 0), uv=1.5)
    # Torso: tapered shirt, sleeves along the bar, belt.
    part(kit, "cylinder", (0, 0, 2.6), (0.85, 0.5, 1.15), shirt, segments=10, taper=1.18, smooth=True)
    for sx in (-1, 1):
        part(kit, "cylinder", (sx * 0.95, 0, 3.0), (0.32, 0.32, 1.1), shirt, segments=8, rot_deg=(0, 90, 0), taper=0.85, smooth=True)
        for k in range(5):
            a = k / 5 * math.tau
            part(kit, "cylinder", (sx * (1.58 + 0.1), math.cos(a) * 0.06, 3.0 + math.sin(a) * 0.06), (0.04, 0.04, 0.42), straw, segments=4, rot_deg=(math.degrees(a) * 0.15, 90 + sx * (8 + k * 5), 0))
    part(kit, "box", (-0.18, -0.26, 2.75), (0.3, 0.03, 0.3), patch, rot_deg=(0, 8, 0))
    part(kit, "box", (0.22, 0.26, 2.45), (0.26, 0.03, 0.26), patch, rot_deg=(0, -12, 0))
    part(kit, "cylinder", (0, 0, 2.08), (0.88, 0.56, 0.08), rope, segments=10)
    # Trousers hanging from the waist, with straw poking from the hems.
    for sx in (-1, 1):
        part(kit, "cylinder", (sx * 0.2, 0, 1.55), (0.34, 0.34, 1.0), trousers, segments=8, taper=0.85, rot_deg=(0, sx * 6, 0), smooth=True)
        for k in range(4):
            part(kit, "cylinder", (sx * 0.25 + (k - 1.5) * 0.05, 0, 0.98), (0.035, 0.035, 0.3), straw, segments=4, rot_deg=(0, (k - 1.5) * 12, 0))
    # Sack head with a stitched face, a tied neck and a straw hat.
    part(kit, "sphere", (0, 0, 3.55), (0.6, 0.55, 0.62), sack, segments=14, smooth=True)
    part(kit, "cylinder", (0, 0, 3.22), (0.3, 0.3, 0.12), rope, segments=8)
    for sx in (-1, 1):
        part(kit, "box", (sx * 0.14, -0.255, 3.6), (0.16, 0.04, 0.035), black, rot_deg=(0, 45, 0))
        part(kit, "box", (sx * 0.14, -0.255, 3.6), (0.16, 0.04, 0.035), black, rot_deg=(0, -45, 0))
    part(kit, "box", (0, -0.262, 3.42), (0.3, 0.04, 0.035), black, rot_deg=(0, 4, 0))
    for k in range(5):
        part(kit, "box", (-0.12 + k * 0.06, -0.265, 3.42), (0.02, 0.04, 0.1), black)
    part(kit, "cylinder", (0, 0, 3.82), (1.2, 1.2, 0.05), straw, segments=16)
    part(kit, "cylinder", (0, 0, 3.98), (0.66, 0.66, 0.32), straw, segments=12, taper=0.82)
    part(kit, "cylinder", (0, 0, 3.87), (0.64, 0.64, 0.06), rope, segments=12)


def build_boxtrap(kit, job, flat_material):
    """Box trap: a crate propped up on a stick over bait, a string from the stick to a peg."""
    wood = swatch_material(kit, "plank")
    dark = swatch_material(kit, "plank_dark")
    string = flat_material("string", (0.75, 0.68, 0.5), 0.9)
    # Crate made of slats, open underneath, its -X edge on the ground and the +X edge lifted.
    lift = 12
    crate = []
    S = 1.2
    for k in range(4):
        y = -S / 2 + 0.15 + k * (S - 0.3) / 3
        crate.append(part(kit, "box", (0, y, S), (S, 0.22, 0.06), wood, uv=1.5))
    for sx in (-1, 1):
        crate.append(part(kit, "box", (sx * S / 2, 0, S / 2), (0.06, S, S), wood, uv=1.5))
    for sy in (-1, 1):
        for k in range(3):
            crate.append(part(kit, "box", (0, sy * S / 2, 0.2 + k * 0.4), (S, 0.06, 0.2), wood, uv=1.5))
    for sx in (-1, 1):
        for sy in (-1, 1):
            crate.append(part(kit, "box", (sx * (S / 2 - 0.05), sy * (S / 2 - 0.05), S / 2), (0.1, 0.1, S), dark))
    hinge = Matrix.Translation((-S / 2, 0, 0)) @ Matrix.Rotation(math.radians(-lift), 4, "Y") @ Matrix.Translation((S / 2, 0, 0))
    for o in crate:
        o.matrix_world = hinge @ o.matrix_world
    # The prop stick under the lifted edge and the string to a peg off to the side.
    lx = -S / 2 + S * math.cos(math.radians(lift))
    lz = S * math.sin(math.radians(lift))
    part(kit, "cylinder", (lx - 0.05, 0, lz / 2), (0.06, 0.06, lz + 0.05), dark, segments=6, rot_deg=(0, -8, 0))
    part(kit, "box", (lx - 0.05, 0, 0.02), (0.06, 0.06, 0.06), dark)
    curve_tube(kit, [(lx - 0.04, 0, lz * 0.4), (lx + 0.6, 0.05, 0.1), (lx + 1.9, 0.1, 0.06), (lx + 2.3, 0.12, 0.25)], 0.018, string, "string")
    part(kit, "cylinder", (lx + 2.3, 0.12, 0.15), (0.07, 0.07, 0.5), dark, segments=6)
    # Bait under the crate.
    for name in ("Carrot",):
        try:
            kit.place(name, (-0.1, 0.1, 0.02), (0, 0, 40), (1.4, 1.4, 1.4))
        except StopIteration:
            pass


def build_beetle(kit, job, flat_material):
    """Dead giant beetle on its back: ringed belly, wing cases, head with mandibles, spiny legs curled over it."""
    shell = flat_material("chitin", (0.1, 0.06, 0.045), 0.25)
    shell.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.4
    belly = flat_material("belly", (0.3, 0.19, 0.1), 0.45)
    seam = flat_material("seam", (0.12, 0.07, 0.04), 0.5)
    leg = flat_material("legs", (0.08, 0.045, 0.03), 0.35)
    goo = flat_material("goo", (0.38, 0.45, 0.12), 0.2)
    # Wing cases lying on the ground (a split dome), belly facing the sky with segment rings.
    for sy in (-1, 1):
        part(kit, "sphere", (-0.25, sy * 0.38, 0.4), (1.95, 0.85, 0.9), shell, segments=20, smooth=True)
    part(kit, "sphere", (-0.25, 0, 0.62), (1.85, 1.35, 0.55), belly, segments=20, smooth=True)
    for k in range(6):
        x = -1.05 + k * 0.3
        w = 1.25 * math.sqrt(max(0.05, 1 - ((x + 0.25) / 0.95) ** 2))
        part(kit, "cylinder", (x, 0, 0.62 + 0.24 * math.sqrt(max(0, 1 - ((x + 0.25) / 0.95) ** 2))), (0.05, w, 0.08), seam, segments=8, rot_deg=(0, 0, 0))
    # Thorax plate and head with mandibles and antennae.
    part(kit, "sphere", (0.85, 0, 0.5), (0.8, 1.1, 0.6), shell, segments=16, smooth=True)
    part(kit, "sphere", (0.85, 0, 0.72), (0.6, 0.8, 0.3), belly, segments=14, smooth=True)
    part(kit, "sphere", (1.4, 0, 0.42), (0.55, 0.62, 0.42), shell, segments=14, smooth=True)
    for sy in (-1, 1):
        curve_tube(kit, [(1.55, sy * 0.15, 0.35), (1.85, sy * 0.3, 0.35), (2.0, sy * 0.15, 0.32), (1.95, sy * 0.02, 0.3)], 0.045, leg, "mandible")
        curve_tube(kit, [(1.55, sy * 0.22, 0.55), (1.85, sy * 0.45, 0.8), (2.15, sy * 0.75, 0.85), (2.35, sy * 0.95, 0.7)], 0.02, leg, "antenna")
    # Six legs: femur up and out, tibia folding back over the belly, a hooked foot; spines on the tibia.
    for side in (-1, 1):
        for k, x in enumerate((1.0, 0.65, 0.25)):
            spread = (1 - k) * 0.3
            p0 = Vector((x, side * 0.45, 0.8))
            p1 = p0 + Vector((spread, side * 0.55, 0.75))
            p2 = p1 + Vector((spread * 0.4 - 0.15, -side * 0.35, 0.45))
            p3 = p2 + Vector((-0.1, -side * 0.25, -0.12))
            curve_tube(kit, [tuple(p0), tuple(p0 + (p1 - p0) * 0.5 + Vector((0, 0, 0.05))), tuple(p1)], 0.07, leg, "femur")
            curve_tube(kit, [tuple(p1), tuple(p2)], 0.045, leg, "tibia")
            curve_tube(kit, [tuple(p2), tuple(p3), tuple(p3 + Vector((0.05, side * 0.05, -0.08)))], 0.025, leg, "tarsus")
            for t in (0.3, 0.6):
                b = p1 + (p2 - p1) * t
                curve_tube(kit, [tuple(b), tuple(b + Vector((0.08, side * 0.1, 0.1)))], 0.015, leg, "spine")
    part(kit, "sphere", (-1.55, 0.35, 0.0), (0.9, 0.6, 0.05), goo, segments=10, smooth=True)


def _fresh(fn):
    """Each job starts from factory settings, so drop images and materials cached by an earlier job."""
    def run(kit, job, flat_material):
        _MATS.clear()
        _SRC.clear()
        fn(kit, job, flat_material)
    return run


BUILDERS = {k: _fresh(f) for k, f in {
    "gravestone": build_gravestone,
    "tomb": build_tomb,
    "waymark": build_waymark,
    "signboard": build_signboard,
    "column": build_column,
    "stump": build_stump,
    "molehill": build_molehill,
    "ropepost": build_ropepost,
    "scarecrow": build_scarecrow,
    "boxtrap": build_boxtrap,
    "beetle": build_beetle,
}.items()}
