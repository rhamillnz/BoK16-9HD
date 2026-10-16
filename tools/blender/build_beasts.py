"""Build the non-human combat creatures (scorpion, spider, beasthound, wyvern, Nethermander, Servitor): a
procedural skeleton, a body of blended metaballs and tubes skinned to it, and keyframed animations for the game's
combat states (idle, walk, attack, block, cast, hit, death), exported as Draco-compressed GLBs.

Usage (headless):
  blender --background --factory-startup --python tools/blender/build_beasts.py -- <out_dir> <preview_dir> [name ...]

None of the art kits has these animals, so everything here is made from code. Models face -Y in Blender (+Z in
glTF, as the game expects), feet on z = 0, in metres. Each creature is a function that fills a Beast: bones, body
parts (metaball groups, tubes, rigid pieces), materials and animation functions. Animations are written as
rotations about the rest pose's world axes (X pitches the nose down, Z turns, Y rolls), carried down the bone
chains, so a creature's motion reads like a description of it.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_bodies import reset  # noqa: E402
from build_party import fur_image, link, material, own, skin_pattern, smooth_shading, smoothstep, textured, tube  # noqa: E402

FPS = 24


def v(*a):
    return Vector(a)


class Beast:
    def __init__(self, name):
        self.name = name
        self.bones = []  # (name, parent, head, tail)
        self.parts = []  # (kind, name, material, data, allowed bones)
        self.anims = {}  # clip -> (frames, loop, fn(t) -> {bone: (rx, ry, rz)}, root(t) -> Vector)
        self.mats = {}

    def bone(self, name, parent, head, tail):
        self.bones.append((name, parent, Vector(head), Vector(tail)))
        return name

    def chain(self, prefix, parent, pts):
        """Bones prefix1..n between consecutive points; returns their names."""
        names = []
        for k in range(len(pts) - 1):
            names.append(self.bone(f"{prefix}{k + 1}", parent, pts[k], pts[k + 1]))
            parent = names[-1]
        return names

    def balls(self, name, mat, elements, bones):
        """A metaball group: elements are (centre, radius, (sx, sy, sz)) ellipsoids; skinned to `bones`."""
        self.parts.append(("mball", name, mat, elements, bones))

    def tube(self, name, mat, pts, radii, bones, segs=10):
        self.parts.append(("tube", name, mat, (pts, radii, segs), bones))

    def rigid(self, name, mat, build, bone):
        """A piece built by build(bm) and fixed to one bone (claws, teeth, eyes, stingers)."""
        self.parts.append(("rigid", name, mat, build, [bone]))

    def sheet(self, name, mat, rows, bones):
        """A membrane (wings): rows of points, quads between neighbouring rows."""
        self.parts.append(("sheet", name, mat, rows, bones))

    def anim(self, clip, frames, loop, fn, root=None):
        self.anims[clip] = (frames, loop, fn, root)


# ---------------------------------------------------------------- shared shapes


def cone_to(bm, base, tip, r):
    """A cone from `base` to `tip` (claws, teeth, stingers)."""
    axis = tip - base
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=r, radius2=r * 0.05, depth=axis.length)
    rot = axis.normalized().to_track_quat("Z", "Y").to_matrix()
    bmesh.ops.translate(bm, verts=geom["verts"], vec=(0, 0, axis.length / 2))
    bmesh.ops.rotate(bm, verts=geom["verts"], cent=(0, 0, 0), matrix=rot)
    bmesh.ops.translate(bm, verts=geom["verts"], vec=base)


def sphere_at(bm, c, r, sub=2):
    geom = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    bmesh.ops.translate(bm, verts=geom["verts"], vec=c)


def leg_points(hip, knee, foot, ankle=None):
    return [hip, knee] + ([ankle] if ankle else []) + [foot]


def sine(t, cycles=1.0, phase=0.0):
    return math.sin(2 * math.pi * (t * cycles + phase))


def bump(t, a, b):
    """0 outside [a, b], rising to 1 in the middle (a smooth hump)."""
    if t <= a or t >= b:
        return 0.0
    x = (t - a) / (b - a)
    return math.sin(math.pi * x) ** 2


def strike(t, wind=0.3, hit=0.5, back=0.85):
    """Attack curve: wind up (negative), strike (positive peak at `hit`), recover to 0."""
    if t < wind:
        return -0.4 * smoothstep(0.0, wind, t)
    if t < hit:
        return -0.4 + 1.4 * smoothstep(wind, hit, t)
    return 1.0 * (1 - smoothstep(hit, back, t))


def limb(b, name, mat, pts, radii, bones, per=4, bulge=1.12, squash=(1, 1, 1)):
    """A metaball limb along a polyline: blends into its joints (and into the body where they overlap), with a
    slight bulge at each joint. Thin limbs are smooth tubes instead: metaballs below a few centimetres break up
    into beads."""
    if min(radii) < 0.05:
        fine, fr = [], []
        for k in range(len(pts) - 1):
            fine.append(pts[k])
            fr.append(radii[k] * (bulge if 0 < k else 1.0))
            for j in (1, 2):
                fine.append(pts[k].lerp(pts[k + 1], j / 3))
                fr.append(radii[k] + (radii[k + 1] - radii[k]) * j / 3)
        fine.append(pts[-1])
        fr.append(radii[-1])
        b.parts.append(("tube", name, mat, (fine, fr, 12), bones))
        return
    els = []
    for k in range(len(pts) - 1):
        for j in range(per):
            t = (j + 0.5) / per
            els.append((pts[k].lerp(pts[k + 1], t), radii[k] + (radii[k + 1] - radii[k]) * t, squash))
    for k in range(1, len(pts) - 1):
        els.append((pts[k], radii[k] * bulge, (1, 1, 1)))
    b.balls(name, mat, els, bones)


def teeth_arc(b, name, mat, centre, rx, ry, z, n, length, bone, up=False, r=0.008, span=(0.12, 0.88)):
    """A row of teeth round the front of a jaw: on the ellipse (rx, ry) about `centre` at height z, pointing
    down (upper teeth) or up (lower)."""
    def build(bm):
        for i in range(n):
            th = math.pi * (span[0] + (span[1] - span[0]) * i / max(n - 1, 1))
            p = Vector((centre.x + rx * math.cos(th), centre.y - ry * math.sin(th), z))
            # Canines (the outer pair either side of the front) are longer.
            k = 1.6 if i in (1, n - 2) else 1.0
            cone_to(bm, p, p + Vector((0, 0, (length if up else -length) * k)), r * (1.2 if k > 1 else 1.0))
    b.rigid(name, mat, build, bone)


def spikes(b, name, mat, pts, bone, length=0.08, r=0.02, lean=(0, 0.6, 1)):
    """Cones standing on the given points, leaning back (dorsal spines, frills)."""
    d = Vector(lean).normalized()
    b.rigid(name, mat, lambda bm: [cone_to(bm, p, p + d * length * (1 - 0.15 * i), r) for i, p in enumerate(pts)], bone)


def emissive(mat, colour, strength):
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Emission Color"].default_value = (*colour, 1)
    bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def lava_material():
    """Lava hide: a dark red crust broken by glowing orange-red cracks (the cracks also feed the emission)."""
    import numpy as np
    from build_party import pattern_image
    size = 512
    rnd = np.random.default_rng(21)
    y, x = np.mgrid[0:size, 0:size] / size
    pts = rnd.random((90, 2))
    d = np.full(x.shape, 9.0)
    d2 = np.full(x.shape, 9.0)
    for px_, py_ in pts:
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                dd = np.hypot(x - px_ - ox, y - py_ - oy)
                d2 = np.minimum(d2, np.maximum(dd, d))
                d = np.minimum(d, dd)
    crack = np.clip(1 - (d2 - d) * 70, 0, 1) ** 2
    noise = rnd.normal(0, 0.04, x.shape)
    base = [np.clip(0.16 + noise + crack * 0.75, 0, 1), np.clip(0.025 + noise * 0.3 + crack * 0.12, 0, 1), np.clip(0.015 + crack * 0.02, 0, 1)]
    glow = [crack * 1.0, crack * 0.16, crack * 0.01]
    img = pattern_image("lava_base", lambda xx, yy: base, size)
    gimg = pattern_image("lava_glow", lambda xx, yy: glow, size)
    mat = bpy.data.materials.new("lava")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    t1 = nt.nodes.new("ShaderNodeTexImage")
    t1.image = img
    t2 = nt.nodes.new("ShaderNodeTexImage")
    t2.image = gimg
    nt.links.new(t1.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(t2.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 2.2
    bsdf.inputs["Roughness"].default_value = 0.6
    return own(mat)


# ---------------------------------------------------------------- creatures


def scorpion():
    """Giant scorpion: an armoured body of overlapping dorsal plates over a paler belly, eyes on the head plate,
    mouthparts, two big serrated pincers, eight jointed legs ending in claws, and a keeled, segmented tail arched
    over the back to a bulb and barbed, hooked stinger (combat sprite SCP)."""
    b = Beast("scp")
    chitin = textured("chitin", skin_pattern("scales", (0.22, 0.14, 0.08)), 0.3, 0.2)
    plate = textured("plates", skin_pattern("hide", (0.17, 0.11, 0.07)), 0.25, 0.25)
    belly = textured("scp_belly", skin_pattern("hide", (0.42, 0.33, 0.2)), 0.5, 0.0)
    dark = own(material("chitin_dark", (0.05, 0.035, 0.03), 0.2, 0.3))
    eye = emissive(own(material("scp_eye", (0.02, 0.02, 0.02), 0.05, 0.5)), (0.3, 0.05, 0.02), 0.6)
    b.bone("pivot", None, v(0, 0, 0), v(0, 0, 0.15))
    b.bone("body", "pivot", v(0, 0.35, 0.42), v(0, -0.35, 0.42))
    tail_pts = [v(0, 0.4, 0.45), v(0, 0.66, 0.6), v(0, 0.8, 0.86), v(0, 0.77, 1.12), v(0, 0.6, 1.32), v(0, 0.38, 1.42), v(0, 0.16, 1.37)]
    tail = b.chain("tail", "body", tail_pts)
    b.bone("sting", tail[-1], tail_pts[-1], v(0, 0.04, 1.2))
    # Body: a belly, a head plate (prosoma) and seven overlapping dorsal plates, each with a raised rear edge.
    b.balls("belly", belly, [(v(0, -0.15, 0.38), 0.22, (1.15, 1.9, 0.45))], ["body"])
    b.balls("head", plate, [(v(0, -0.33, 0.46), 0.2, (1.15, 0.85, 0.5))], ["body"])
    els = []
    for k in range(7):
        y = -0.18 + k * 0.085
        w = 1.25 - 0.06 * abs(k - 3)
        els.append((v(0, y, 0.47), 0.19, (w, 0.42, 0.5)))
    b.balls("plates", plate, els, ["body"])
    b.balls("plate_rims", dark, [(v(0, -0.14 + k * 0.085, 0.52), 0.07, (2.6, 0.3, 0.3)) for k in range(7)], ["body"])
    b.rigid("eyes", eye, lambda bm: [sphere_at(bm, v(sx, -0.33, 0.56), 0.022, 1) for sx in (-0.03, 0.03)]
            + [sphere_at(bm, v(sx * (0.13 + 0.025 * j), -0.44 + 0.015 * j, 0.5), 0.012, 1) for sx in (-1, 1) for j in range(3)], "body")
    b.rigid("mouth", dark, lambda bm: [cone_to(bm, v(sx * 0.04, -0.47, 0.42), v(sx * 0.02, -0.56, 0.38), 0.02) for sx in (-1, 1)], "body")
    # Tail: five keeled segments that swell and pinch, a bulb and a barbed stinger.
    els, keel = [], []
    for k in range(len(tail_pts) - 1):
        for j in range(3):
            t = (j + 0.5) / 3
            c = tail_pts[k].lerp(tail_pts[k + 1], t)
            r = (0.11 - 0.01 * k) * (0.85 + 0.2 * math.sin(math.pi * t))
            els.append((c, r, (1, 1, 1)))
            # The keels: two ridges along the top of each segment.
            out = (c - v(0, 0.4, 0.75)).normalized()
            for sx in (-1, 1):
                keel.append((c + out * r * 0.75 + v(sx * r * 0.45, 0, 0), r * 0.32, (1, 1, 1)))
    b.balls("tail", chitin, els, ["body"] + tail)
    tip = tail_pts[-1]
    b.balls("bulb", chitin, [(tip + v(0, -0.02, -0.04), 0.095, (0.9, 1.2, 1))], ["sting"])
    b.rigid("stinger", dark, lambda bm: [cone_to(bm, tip + v(0, -0.08, -0.08), v(0, -0.02, 1.12), 0.035),
                                         cone_to(bm, tip + v(0, -0.07, -0.12), tip + v(0, -0.02, -0.2), 0.012)], "sting")
    for s, t in ((1, "l"), (-1, "r")):
        a1 = b.bone(f"arm1_{t}", "body", v(s * 0.16, -0.3, 0.42), v(s * 0.42, -0.55, 0.45))
        a2 = b.bone(f"arm2_{t}", a1, v(s * 0.42, -0.55, 0.45), v(s * 0.38, -0.84, 0.47))
        pin = b.bone(f"pincer_{t}", a2, v(s * 0.38, -0.84, 0.47), v(s * 0.3, -1.12, 0.46))
        fin = b.bone(f"finger_{t}", a2, v(s * 0.43, -0.92, 0.49), v(s * 0.42, -1.14, 0.47))
        limb(b, f"arm_{t}", chitin, [v(s * 0.16, -0.3, 0.42), v(s * 0.42, -0.55, 0.45), v(s * 0.38, -0.84, 0.47)], [0.055, 0.065, 0.07], ["body", a1, a2])
        # The hand: a swollen palm and the fixed finger, with a row of teeth on the inner edges.
        b.balls(f"claw_{t}", chitin, [(v(s * 0.37, -0.9, 0.47), 0.12, (0.85, 1.25, 0.75)), (v(s * 0.34, -1.04, 0.46), 0.065, (0.7, 1.6, 0.6)),
                                      (v(s * 0.32, -1.13, 0.455), 0.035, (0.7, 1.4, 0.6))], [pin])
        b.balls(f"finger_{t}", dark, [(v(s * 0.43, -0.98, 0.485), 0.045, (0.7, 1.7, 0.65)), (v(s * 0.425, -1.1, 0.475), 0.028, (0.7, 1.5, 0.6))], [fin])
        b.rigid(f"claw_teeth_{t}", dark, lambda bm, s=s: [cone_to(bm, v(s * 0.355, -0.98 - 0.04 * i, 0.47), v(s * 0.385, -0.985 - 0.04 * i, 0.47), 0.008)
                                                         for i in range(4)], pin)
        for k, (y, dy) in enumerate(zip((-0.2, -0.05, 0.1, 0.25), (-0.12, -0.04, 0.05, 0.14))):
            hip, knee, foot = v(s * 0.2, y, 0.4), v(s * 0.55, y + dy, 0.64), v(s * 0.86, y + dy * 1.7, 0.0)
            ankle = knee.lerp(foot, 0.62) + v(s * 0.03, 0, 0.04)
            l1 = b.bone(f"leg{k}a_{t}", "body", hip, knee)
            l2 = b.bone(f"leg{k}b_{t}", l1, knee, foot)
            limb(b, f"leg{k}_{t}", chitin, [hip, knee, ankle, foot + v(0, 0, 0.02)], [0.04, 0.034, 0.024, 0.014], ["body", l1, l2], per=3)
            b.rigid(f"toe{k}_{t}", dark, lambda bm, foot=foot, s=s: cone_to(bm, foot + v(0, 0, 0.02), foot + v(s * 0.04, 0, -0.005), 0.01), l2)
    _scorpion_anims(b)
    return b


def _scorpion_anims(b):
    def legs_walk(t, p):
        for k in range(4):
            for s, tg in ((1, "l"), (-1, "r")):
                ph = ((k + (s > 0)) % 2) * 0.5
                swing = 0.32 * sine(t, 1, ph)
                lift = max(0.0, sine(t, 1, ph + 0.25)) * 0.3
                p[f"leg{k}a_{tg}"] = (0, -s * lift, swing)

    def idle(t):
        p = {"body": (0.02 * sine(t), 0, 0)}
        for k, bn in enumerate(["tail1", "tail2", "tail3", "tail4", "tail5", "tail6"]):
            p[bn] = (0.03 * sine(t, 1, 0.1 * k), 0, 0.05 * sine(t, 1, -0.08 * k))
        for tg in ("l", "r"):
            p[f"finger_{tg}"] = (0, 0, (0.25 if tg == "l" else -0.25) * max(0.0, sine(t, 2)))
        return p

    def walk(t):
        p = {"body": (0, 0, 0.03 * sine(t))}
        legs_walk(t, p)
        for k, bn in enumerate(["tail1", "tail2", "tail3"]):
            p[bn] = (0, 0, 0.04 * sine(t, 1, 0.15 * k))
        return p

    def attack(t):
        a = strike(t)
        p = {"body": (0.1 * a, 0, 0)}
        for bn in ("tail2", "tail3", "tail4", "tail5"):
            p[bn] = (0.32 * a, 0, 0)
        p["sting"] = (0.4 * a, 0, 0)
        for tg, s in (("l", 1), ("r", -1)):
            p[f"arm1_{tg}"] = (-0.2 * bump(t, 0.1, 0.8), 0, 0)
            p[f"finger_{tg}"] = (0, 0, s * 0.35 * bump(t, 0.3, 0.7))
        return p

    def block(t):
        k = bump(t, 0, 1)
        p = {"body": (-0.15 * k, 0, 0)}
        for tg, s in (("l", 1), ("r", -1)):
            p[f"arm1_{tg}"] = (-0.6 * k, 0, -s * 0.3 * k)
        return p

    def hit(t):
        k = bump(t, 0, 0.7)
        return {"body": (-0.18 * k, 0, 0.1 * k), "tail2": (-0.2 * k, 0, 0), "tail4": (-0.2 * k, 0, 0)}

    def death(t):
        k = smoothstep(0.05, 0.6, t)
        p = {"pivot": (0, math.pi * k, 0)}
        for kk in range(4):
            for tg, s in (("l", 1), ("r", -1)):
                p[f"leg{kk}a_{tg}"] = (0, s * 0.7 * smoothstep(0.4, 1.0, t), 0)
                p[f"leg{kk}b_{tg}"] = (0, s * 0.9 * smoothstep(0.4, 1.0, t), 0)
        for bn in ("tail1", "tail2", "tail3"):
            p[bn] = (-0.25 * smoothstep(0.5, 1.0, t), 0, 0)
        return p

    b.anim("idle", 48, True, idle)
    b.anim("walk", 24, True, walk)
    b.anim("attack", 30, False, attack)
    b.anim("block", 20, False, block)
    b.anim("hit", 14, False, hit)
    b.anim("death", 36, False, death, root=lambda t: v(0, 0, 0.88 * smoothstep(0.05, 0.6, t)))


def arachnid(name, body_mat, belly_mat, legs_mat, eye_mat, scale=1.0, stalks=None):
    """Spider-shaped: a head and body, a big abdomen behind, eight long legs (spider), or six legs and four
    stalks with hooked claws rising from the back (`stalks`, the Servitor)."""
    b = Beast(name)
    S = scale
    b.bone("pivot", None, v(0, 0, 0), v(0, 0, 0.15))
    b.bone("body", "pivot", v(0, 0.2, 0.48 * S), v(0, -0.38 * S, 0.45 * S))
    b.bone("abdomen", "body", v(0, 0.12 * S, 0.5 * S), v(0, 0.75 * S, 0.62 * S))
    b.balls("body", body_mat, [(v(0, -0.18 * S, 0.47 * S), 0.21 * S, (1.05, 1.2, 0.75)), (v(0, -0.38 * S, 0.47 * S), 0.12 * S, (1, 1, 0.9))], ["body"])
    b.balls("abdomen", belly_mat, [(v(0, 0.38 * S, 0.62 * S), 0.32 * S, (1.0, 1.25, 0.9)), (v(0, 0.12 * S, 0.53 * S), 0.14 * S, (1, 1, 1))], ["abdomen", "body"])
    for s, t in ((1, "l"), (-1, "r")):
        f = b.bone(f"fang_{t}", "body", v(s * 0.05 * S, -0.45 * S, 0.45 * S), v(s * 0.04 * S, -0.52 * S, 0.33 * S))
        b.rigid(f"fang_{t}", eye_mat if stalks else legs_mat,
                lambda bm, s=s: cone_to(bm, v(s * 0.05 * S, -0.46 * S, 0.45 * S), v(s * 0.035 * S, -0.53 * S, 0.31 * S), 0.025 * S), f)
        for k in range(3):
            b.rigid(f"eye{k}_{t}", eye_mat, lambda bm, s=s, k=k: sphere_at(bm, v(s * (0.03 + 0.035 * k) * S, -0.46 * S, (0.56 - 0.02 * k) * S), 0.022 * S, 1), "body")
        ys = (-0.3, -0.22, -0.12, -0.03) if not stalks else (-0.28, -0.16, -0.04)
        dys = (-0.38, -0.12, 0.12, 0.34) if not stalks else (-0.3, 0.0, 0.3)
        for k, (y, dy) in enumerate(zip(ys, dys)):
            hip = v(s * 0.13 * S, y * S, 0.45 * S)
            knee = v(s * 0.5 * S, (y + dy) * S, 0.88 * S)
            ankle = v(s * 0.85 * S, (y + dy * 1.5) * S, 0.38 * S)
            foot = v(s * 1.0 * S, (y + dy * 1.8) * S, 0.0)
            l1 = b.bone(f"leg{k}a_{t}", "body", hip, knee)
            l2 = b.bone(f"leg{k}b_{t}", l1, knee, ankle)
            l3 = b.bone(f"leg{k}c_{t}", l2, ankle, foot)
            b.tube(f"leg{k}_{t}", legs_mat, [hip, knee, ankle, foot], [0.04 * S, 0.035 * S, 0.025 * S, 0.008 * S], ["body", l1, l2, l3], 8)
    nlegs = 4 if not stalks else 3
    if stalks:
        for k, (sx, sy) in enumerate(((0.12, 0.25), (-0.12, 0.25), (0.22, 0.45), (-0.22, 0.45))):
            base = v(sx * S, sy * S, 0.8 * S)
            pts = [base, base + v(sx * 0.6, 0.05, 0.35) * S, base + v(sx * 0.9, -0.15, 0.65) * S, base + v(sx * 0.9, -0.45, 0.8) * S,
                   base + v(sx * 0.7, -0.7, 0.68) * S]
            names = b.chain(f"stalk{k}_", "abdomen", pts)
            b.tube(f"stalk{k}", body_mat, pts, [0.06 * S, 0.05 * S, 0.04 * S, 0.03 * S, 0.02 * S], ["abdomen"] + names, 10)
            tip = pts[-1]
            b.rigid(f"hook{k}", eye_mat, lambda bm, tip=tip, sx=sx: cone_to(bm, tip, tip + v(sx * 0.1, -0.12, -0.2) * S, 0.035 * S), names[-1])

    def legs_walk(t, p, amp=0.3):
        for k in range(nlegs):
            for s, tg in ((1, "l"), (-1, "r")):
                ph = ((k + (s > 0)) % 2) * 0.5
                p[f"leg{k}a_{tg}"] = (0, -s * max(0.0, sine(t, 1, ph + 0.25)) * 0.3, amp * sine(t, 1, ph))

    def stalk_pose(p, t, amp, ph=0.0):
        if not stalks:
            return
        for k in range(4):
            for j in range(1, 5):
                p[f"stalk{k}_{j}"] = (amp * sine(t, 1, ph + 0.13 * k + 0.07 * j), 0, 0.5 * amp * sine(t, 1, 0.2 * k))

    def idle(t):
        p = {"body": (0.02 * sine(t), 0, 0), "abdomen": (0.04 * sine(t, 1, 0.2), 0, 0.03 * sine(t, 1, 0.5))}
        for tg in ("l", "r"):
            p[f"leg0a_{tg}"] = (-0.08 * max(0.0, sine(t, 2)), 0, 0)
            p[f"fang_{tg}"] = (0.15 * max(0.0, sine(t, 2, 0.3)), 0, 0)
        stalk_pose(p, t, 0.08)
        return p

    def walk(t):
        p = {"body": (0.03 * sine(t, 2), 0, 0)}
        legs_walk(t, p)
        stalk_pose(p, t, 0.06)
        return p

    def attack(t):
        a = strike(t)
        p = {"body": (-0.45 * bump(t, 0.05, 0.45) + 0.25 * max(0.0, a) * (t > 0.4), 0, 0)}
        for tg in ("l", "r"):
            p[f"leg0a_{tg}"] = (-0.9 * bump(t, 0.05, 0.6), 0, 0)
            p[f"leg1a_{tg}"] = (-0.5 * bump(t, 0.05, 0.6), 0, 0)
            p[f"fang_{tg}"] = (0.6 * bump(t, 0.35, 0.65), 0, 0)
        if stalks:
            for k in range(4):
                for j in range(1, 5):
                    p[f"stalk{k}_{j}"] = (0.35 * a, 0, 0)
        return p

    def block(t):
        k = bump(t, 0, 1)
        p = {"body": (-0.25 * k, 0, 0)}
        for tg in ("l", "r"):
            p[f"leg0a_{tg}"] = (-0.8 * k, 0, 0)
        return p

    def hit(t):
        k = bump(t, 0, 0.7)
        return {"body": (-0.2 * k, 0, 0.12 * k), "abdomen": (0.2 * k, 0, 0)}

    def death(t):
        k = smoothstep(0.05, 0.6, t)
        c = smoothstep(0.3, 1.0, t)
        p = {"pivot": (0, math.pi * k, 0)}
        # Legs curl in over the belly (they end up pointing at the sky once it has rolled onto its back).
        for kk in range(nlegs):
            for tg, s in (("l", 1), ("r", -1)):
                p[f"leg{kk}a_{tg}"] = (0, s * 0.3 * c, 0)
                p[f"leg{kk}b_{tg}"] = (0, s * 0.9 * c, 0)
                p[f"leg{kk}c_{tg}"] = (0, s * 1.0 * c, 0)
        if stalks:
            for j in range(1, 5):
                for kk in range(4):
                    p[f"stalk{kk}_{j}"] = (0.3 * k, 0, 0)
        return p

    b.anim("idle", 48, True, idle)
    b.anim("walk", 20, True, walk)
    b.anim("attack", 30, False, attack)
    b.anim("block", 20, False, block)
    b.anim("hit", 14, False, hit)
    b.anim("death", 36, False, death, root=lambda t: v(0, 0, 1.0 * S * smoothstep(0.05, 0.6, t)))
    return b


def spider():
    """Giant spider: hairy black body and legs, a red-blotched abdomen, red eyes, fangs (sprite SPI)."""
    fur = textured("spider_fur", fur_image((0.09, 0.07, 0.06)), 0.95, 0.0)
    belly = textured("spider_belly", spider_marks(), 0.7, 0.0)
    eye = own(material("spider_eye", (0.6, 0.03, 0.02), 0.15))
    eye.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (0.8, 0.05, 0.02, 1)
    eye.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 1.5
    return arachnid("spi", fur, belly, fur, eye)


def spider_marks():
    import numpy as np
    from build_party import pattern_image

    def fn(x, y):
        rnd = np.random.default_rng(3)
        base = 0.08 + rnd.normal(0, 0.02, x.shape)
        blot = (np.sin(x * 18 + np.sin(y * 9) * 2) * np.sin(y * 14 + 1.3) > 0.55)
        r = np.where(blot, 0.55, base)
        g = np.where(blot, 0.06, base * 0.8)
        return [r, g, g * 0.9]

    return pattern_image("spider_marks", fn, 256)


def servitor():
    """Servitor of Lims-Kragma: a death goddess's creature in the sprite's purple-black: a carapace on six legs
    with four stalks rising from its back, each ending in a hooked claw (sprite SER)."""
    shell = textured("servitor_shell", skin_pattern("scales", (0.22, 0.12, 0.3)), 0.4, 0.2)
    dark = own(material("servitor_dark", (0.08, 0.05, 0.12), 0.4, 0.2))
    claw = own(material("servitor_claw", (0.55, 0.5, 0.6), 0.3, 0.4))
    return arachnid("ser", shell, shell, dark, claw, scale=1.1, stalks=True)


def quadruped(name, kind):
    """Four-legged: `kind` "hound" (the beasthound as a huge Rottweiler: black with tan markings, a deep chest,
    heavy shoulders, a broad head, folded ears, a docked tail) or "lizard" (the Nethermander: a low lava-red
    salamander, glowing cracks in a dark crust, sprawling clawed legs, dorsal spines and a long tail)."""
    b = Beast(name)
    hound = kind == "hound"
    tooth = own(material(f"{name}_tooth", (0.9, 0.87, 0.78), 0.35))
    dark = own(material(f"{name}_claw", (0.05, 0.04, 0.04), 0.3, 0.2))
    if hound:
        black = textured("rott_black", skin_pattern("hide", (0.075, 0.065, 0.06)), 0.55, 0.0)
        tan = textured("rott_tan", skin_pattern("hide", (0.5, 0.27, 0.11)), 0.6, 0.0)
        eye = emissive(own(material("dog_eye", (0.35, 0.18, 0.05), 0.15)), (0.9, 0.5, 0.1), 0.8)
        nose = own(material("dog_nose", (0.02, 0.02, 0.02), 0.25))
    else:
        crust = lava_material()
        eye = emissive(own(material("nth_eye", (1.0, 0.8, 0.2), 0.2)), (1.0, 0.6, 0.05), 3.0)
    b.bone("pivot", None, v(0, 0, 0), v(0, 0, 0.15))
    if hound:
        b.bone("hips", "pivot", v(0, 0.42, 0.66), v(0, 0.0, 0.7))
        b.bone("chest", "hips", v(0, 0.0, 0.7), v(0, -0.36, 0.74))
        b.bone("neck", "chest", v(0, -0.36, 0.78), v(0, -0.5, 0.92))
        b.bone("head", "neck", v(0, -0.5, 0.92), v(0, -0.78, 0.88))
        b.bone("jaw", "head", v(0, -0.62, 0.85), v(0, -0.8, 0.8))
        tail = b.chain("tail", "hips", [v(0, 0.44, 0.72), v(0, 0.52, 0.8)])
        # Body: muscular rump, tucked waist, deep chest, heavy shoulders.
        b.balls("body", black, [(v(0, 0.36, 0.7), 0.16, (1.15, 1.15, 1.05)), (v(0, 0.12, 0.74), 0.13, (1.1, 1.3, 0.95)),
                                (v(0, -0.15, 0.72), 0.19, (1.05, 1.1, 1.25)), (v(0, -0.31, 0.8), 0.15, (1.25, 1.0, 1.05))], ["hips", "chest"])
        b.balls("chest_tan", tan, [(v(sx * 0.07, -0.42, 0.7), 0.06, (1, 0.6, 1.2)) for sx in (-1, 1)], ["chest"])
        b.balls("neck", black, [(v(0, -0.41, 0.86), 0.12, (1.1, 1, 1.05)), (v(0, -0.48, 0.94), 0.105, (1.05, 1, 1))], ["chest", "neck", "head"])
        # Skull, stop and muzzle in one blended piece; the tan markings sit on it.
        b.balls("head", black, [(v(0, -0.58, 0.98), 0.1, (1.15, 1.1, 0.85)), (v(0, -0.63, 0.93), 0.075, (1.45, 0.9, 0.85)),
                                (v(0, -0.7, 0.92), 0.065, (1.1, 1.0, 0.85)), (v(0, -0.77, 0.9), 0.058, (1.0, 1.4, 0.75))], ["head"])
        b.balls("ears", black, [(v(sx * 0.11, -0.57, 0.99), 0.05, (0.4, 0.75, 1.05)) for sx in (-1, 1)], ["head"])
        b.balls("cheeks", tan, [(v(sx * 0.04, -0.76, 0.875), 0.042, (0.9, 1.6, 0.75)) for sx in (-1, 1)], ["head"])
        b.balls("jaw", tan, [(v(0, -0.74, 0.84), 0.042, (1.0, 2.0, 0.55))], ["jaw"])
        b.rigid("nose", nose, lambda bm: sphere_at(bm, v(0, -0.835, 0.915), 0.026, 2), "head")
        b.rigid("brows", tan, lambda bm: [sphere_at(bm, v(sx * 0.045, -0.7, 0.99), 0.015, 1) for sx in (-1, 1)], "head")
        # Teeth seated on the muzzle's lower edge and the jaw's upper edge.
        teeth_arc(b, "teeth_top", tooth, v(0, -0.75, 0), 0.05, 0.075, 0.862, 8, 0.024, "head")
        teeth_arc(b, "teeth_low", tooth, v(0, -0.74, 0), 0.036, 0.07, 0.848, 7, 0.018, "jaw", up=True)
        for sx in (-1, 1):
            b.rigid(f"eye{sx}", eye, lambda bm, sx=sx: sphere_at(bm, v(sx * 0.055, -0.69, 0.965), 0.016, 1), "head")
        b.balls("tail", black, [(v(0, 0.47, 0.75), 0.05, (1, 1, 1)), (v(0, 0.51, 0.79), 0.04, (1, 1, 1))], ["hips"] + tail)
        H = 0.7
    else:
        H = 0.36
        b.bone("hips", "pivot", v(0, 0.5, H), v(0, 0.05, H + 0.02))
        b.bone("chest", "hips", v(0, 0.05, H + 0.02), v(0, -0.45, H + 0.04))
        b.bone("neck", "chest", v(0, -0.47, H + 0.05), v(0, -0.66, H + 0.08))
        b.bone("head", "neck", v(0, -0.66, H + 0.08), v(0, -0.98, H + 0.04))
        b.bone("jaw", "head", v(0, -0.72, H + 0.01), v(0, -0.97, H - 0.03))
        tail_pts = [v(0, 0.55, H), v(0, 0.88, H - 0.06), v(0, 1.22, H - 0.15), v(0, 1.55, H - 0.24), v(0, 1.85, H - 0.29), v(0, 2.1, H - 0.31)]
        tail = b.chain("tail", "hips", tail_pts)
        b.balls("body", crust, [(v(0, 0.42, H), 0.2, (1.2, 1.3, 0.8)), (v(0, 0.12, H + 0.02), 0.24, (1.3, 1.3, 0.8)),
                                (v(0, -0.2, H + 0.03), 0.23, (1.25, 1.3, 0.8)), (v(0, -0.46, H + 0.05), 0.16, (1.1, 1.2, 0.85))], ["hips", "chest"])
        b.balls("neck", crust, [(v(0, -0.58, H + 0.07), 0.13, (1.1, 1, 0.85))], ["chest", "neck", "head"])
        b.balls("head", crust, [(v(0, -0.76, H + 0.09), 0.12, (1.25, 1.1, 0.65)), (v(0, -0.91, H + 0.05), 0.08, (1.15, 1.45, 0.55)),
                                (v(0, -0.79, H + 0.13), 0.06, (1.6, 1, 0.5))],
                ["head"])
        b.balls("jaw", crust, [(v(0, -0.87, H - 0.01), 0.07, (1.15, 1.55, 0.42))], ["jaw"])
        teeth_arc(b, "teeth_top", tooth, v(0, -0.9, 0), 0.07, 0.1, H + 0.02, 9, 0.022, "head")
        teeth_arc(b, "teeth_low", tooth, v(0, -0.87, 0), 0.062, 0.095, H + 0.01, 8, 0.018, "jaw", up=True)
        for sx in (-1, 1):
            b.rigid(f"eye{sx}", eye, lambda bm, sx=sx: sphere_at(bm, v(sx * 0.085, -0.8, H + 0.12), 0.024, 1), "head")
        limb(b, "tail", crust, tail_pts, [0.15, 0.12, 0.09, 0.065, 0.04, 0.015], ["hips"] + tail, per=3)
        # Dorsal spines along the back and down the tail; a frill of spikes behind the head.
        spikes(b, "spines_back", dark, [v(0, y, H + 0.17) for y in (0.35, 0.18, 0.0, -0.18, -0.34)], "chest", 0.09, 0.025)
        spikes(b, "spines_tail", dark, [tail_pts[k].lerp(tail_pts[k + 1], 0.5) + v(0, 0, 0.12 - 0.02 * k) for k in range(3)], tail[1], 0.07, 0.02)
        spikes(b, "frill", dark, [v(sx * (0.08 + 0.03 * i), -0.68 + 0.02 * i, H + 0.14 - 0.02 * i) for sx in (-1, 1) for i in range(3)], "head",
               0.07, 0.015, (0, 1, 0.7))
    # Legs: metaball limbs, so the joints blend; claws on the toes.
    for s, t in ((1, "l"), (-1, "r")):
        for end in ("f", "b"):
            if hound:
                if end == "f":
                    pts = [v(s * 0.13, -0.3, 0.72), v(s * 0.15, -0.26, 0.42), v(s * 0.15, -0.3, 0.14), v(s * 0.15, -0.36, 0.035)]
                    radii = [0.09, 0.065, 0.048, 0.045]
                else:
                    pts = [v(s * 0.14, 0.38, 0.66), v(s * 0.16, 0.26, 0.42), v(s * 0.16, 0.44, 0.2), v(s * 0.16, 0.38, 0.035)]
                    radii = [0.12, 0.07, 0.05, 0.045]
            else:
                if end == "f":
                    pts = [v(s * 0.2, -0.32, H + 0.02), v(s * 0.46, -0.36, H + 0.12), v(s * 0.58, -0.42, 0.1), v(s * 0.64, -0.5, 0.03)]
                else:
                    pts = [v(s * 0.2, 0.4, H), v(s * 0.48, 0.46, H + 0.12), v(s * 0.6, 0.52, 0.1), v(s * 0.66, 0.45, 0.03)]
                radii = [0.1, 0.075, 0.055, 0.04]
            parent = "chest" if end == "f" else "hips"
            l1 = b.bone(f"{end}leg1_{t}", parent, pts[0], pts[1])
            l2 = b.bone(f"{end}leg2_{t}", l1, pts[1], pts[2])
            l3 = b.bone(f"{end}leg3_{t}", l2, pts[2], pts[3])
            if hound:
                limb(b, f"{end}leg_up_{t}", black, pts[:3], radii[:3], [parent, l1, l2], per=4)
                limb(b, f"{end}leg_low_{t}", tan, pts[2:], radii[2:], [l2, l3], per=3)
                b.balls(f"{end}paw_{t}", tan, [(pts[3] + v(0, -0.03, 0.0), 0.05, (1.1, 1.3, 0.65))], [l3])
                b.rigid(f"{end}nails_{t}", dark, lambda bm, p=pts[3]: [cone_to(bm, p + v(dx, -0.08, -0.005), p + v(dx, -0.1, -0.025), 0.008)
                                                                       for dx in (-0.03, -0.01, 0.01, 0.03)], l3)
            else:
                limb(b, f"{end}leg_{t}", crust, pts, radii, [parent, l1, l2, l3], per=4)
                foot = pts[3]
                dirs = [v(s * 0.6, -0.8, 0), v(s * 0.9, -0.4, 0), v(s * 1, 0.1, 0), v(-s * 0.2, 0.9, 0)]
                b.rigid(f"{end}claws_{t}", dark, lambda bm, foot=foot, dirs=dirs: [cone_to(bm, foot, foot + d.normalized() * 0.09 + v(0, 0, -0.025), 0.016)
                                                                                    for d in dirs], l3)
    _quad_anims(b, hound, tail)
    return b


def _quad_anims(b, hound, tail):
    def gait(t, p, amp):
        for s, tg in ((1, "l"), (-1, "r")):
            for end, ph in (("f", 0.0 if s > 0 else 0.5), ("b", 0.5 if s > 0 else 0.0)):
                sw = sine(t, 1, ph)
                lift = max(0.0, sine(t, 1, ph + 0.25))
                if hound:
                    p[f"{end}leg1_{tg}"] = (-amp * sw, 0, 0)
                    p[f"{end}leg2_{tg}"] = ((0.5 if end == "f" else -0.5) * lift, 0, 0)
                else:
                    p[f"{end}leg1_{tg}"] = (0, -s * 0.35 * lift, amp * sw)

    def idle(t):
        p = {"chest": (0.015 * sine(t), 0, 0), "head": (0.04 * sine(t, 1, 0.3), 0, 0.12 * sine(t, 0.5, 0.1)),
             "jaw": (0.06 * max(0.0, sine(t, 2)), 0, 0)}
        for k, bn in enumerate(tail):
            p[bn] = (0, 0, (0.25 if hound else 0.12) * sine(t, 2 if hound else 1, 0.1 * k))
        return p

    def walk(t):
        p = {"chest": (0.02 * sine(t, 2), 0, 0 if hound else 0.1 * sine(t)), "hips": (0, 0, 0 if hound else -0.1 * sine(t)),
             "head": (0.04 * sine(t, 2), 0, 0)}
        gait(t, p, 0.4 if hound else 0.45)
        for k, bn in enumerate(tail):
            p[bn] = (0, 0, 0.12 * sine(t, 1, 0.15 * k + 0.3))
        return p

    def attack(t):
        a = strike(t, 0.3, 0.5, 0.85)
        p = {"chest": (0.12 * a, 0, 0), "hips": (-0.05 * a, 0, 0), "neck": (0.25 * a, 0, 0), "head": (0.1 * a, 0, 0),
             "jaw": (0.7 * bump(t, 0.25, 0.6), 0, 0)}
        for tg in ("l", "r"):
            p[f"fleg1_{tg}"] = (-0.35 * max(0.0, a), 0, 0)
        return p

    def block(t):
        k = bump(t, 0, 1)
        return {"chest": (-0.2 * k, 0, 0), "neck": (-0.25 * k, 0, 0), "jaw": (0.3 * k, 0, 0)}

    def hit(t):
        k = bump(t, 0, 0.7)
        return {"chest": (-0.15 * k, 0, 0.12 * k), "neck": (-0.2 * k, 0, 0.15 * k)}

    def death(t):
        k = smoothstep(0.05, 0.6, t)
        p = {"pivot": (0, 1.5 * k, 0), "neck": (0.3 * k, 0, 0), "jaw": (0.4 * smoothstep(0.5, 1.0, t), 0, 0)}
        for s, tg in ((1, "l"), (-1, "r")):
            for end in ("f", "b"):
                p[f"{end}leg1_{tg}"] = ((-0.3 if end == "f" else 0.3) * k, 0, 0)
        return p

    b.anim("idle", 48, True, idle)
    b.anim("walk", 20, True, walk)
    b.anim("attack", 26, False, attack)
    b.anim("block", 18, False, block)
    b.anim("hit", 14, False, hit)
    b.anim("death", 36, False, death, root=lambda t: v(0, 0, (0.18 if hound else 0.1) * smoothstep(0.05, 0.6, t)))


def beasthound():
    return quadruped("dog", "hound")


def nethermander():
    return quadruped("nth", "lizard")


def wyvern():
    """Wyvern: a two-legged dragon. A muscular dark green body with a banded pale belly, a long neck and a
    horned head (brow ridges, nostrils, glowing eyes, toothed jaws), spines down the neck, back and tail, a
    spade at the tail's tip, heavy taloned legs, and leathery bat wings on four fingers with a hooked thumb and
    a scalloped trailing edge (sprites WYV; the three wyverns share it)."""
    from build_party import leather_image
    b = Beast("wyv")
    scales = textured("wyvern_scales", skin_pattern("scales", (0.15, 0.24, 0.11)), 0.4, 0.08)
    belly = textured("wyvern_belly", wyvern_belly_image(), 0.55, 0.0)
    membrane = textured("wyvern_wing", leather_image((0.2, 0.22, 0.12)), 0.6, 0.0)
    horn = own(material("wyvern_horn", (0.75, 0.7, 0.58), 0.4))
    dark = own(material("wyvern_dark", (0.06, 0.08, 0.05), 0.35, 0.1))
    tooth = own(material("wyvern_tooth", (0.88, 0.85, 0.75), 0.35))
    eye = emissive(own(material("wyvern_eye", (0.95, 0.6, 0.05), 0.2)), (1.0, 0.5, 0.0), 2.5)
    b.bone("pivot", None, v(0, 0, 0), v(0, 0, 0.15))
    b.bone("hips", "pivot", v(0, 0.2, 1.0), v(0, -0.1, 1.05))
    b.bone("chest", "hips", v(0, -0.1, 1.05), v(0, -0.45, 1.22))
    neck_pts = [v(0, -0.45, 1.25), v(0, -0.62, 1.45), v(0, -0.72, 1.65), v(0, -0.82, 1.78)]
    neck = b.chain("neck", "chest", neck_pts)
    b.bone("head", neck[-1], v(0, -0.82, 1.78), v(0, -1.15, 1.72))
    b.bone("jaw", "head", v(0, -0.86, 1.72), v(0, -1.12, 1.62))
    tail_pts = [v(0, 0.22, 1.0), v(0, 0.55, 0.92), v(0, 0.9, 0.78), v(0, 1.25, 0.62), v(0, 1.55, 0.5), v(0, 1.8, 0.42)]
    tail = b.chain("tail", "hips", tail_pts)
    # Body: chest and shoulders, a muscled back, the banded belly underneath.
    b.balls("body", scales, [(v(0, 0.16, 1.02), 0.28, (1.05, 1.15, 1)), (v(0, -0.12, 1.1), 0.31, (1.1, 1.1, 1.08)),
                             (v(0, -0.38, 1.24), 0.24, (1.2, 0.95, 1.05)),
                             (v(0, -0.36, 1.34), 0.15, (2.0, 0.8, 0.8))], ["hips", "chest"])
    b.balls("belly", belly, [(v(0, -0.12, 0.93), 0.22, (0.9, 1.6, 0.6)), (v(0, -0.42, 1.12), 0.16, (0.85, 0.9, 0.9))], ["hips", "chest"])
    limb(b, "neck", scales, neck_pts + [v(0, -0.86, 1.8)], [0.19, 0.15, 0.125, 0.11, 0.1], ["chest"] + neck, per=4)
    b.balls("throat", belly, [(neck_pts[k].lerp(neck_pts[k + 1], 0.5) + v(0, -0.07, -0.06), 0.1 - 0.015 * k, (0.8, 1, 1)) for k in range(3)],
            ["chest"] + neck)
    # Head: skull, snout, brow ridges over the eyes, nostrils, cheek spikes, two swept-back horns.
    b.balls("head", scales, [(v(0, -0.9, 1.79), 0.135, (1.05, 1.1, 0.9)), (v(0, -1.06, 1.75), 0.085, (0.9, 1.6, 0.7)),
                             (v(0, -0.94, 1.86), 0.05, (2.2, 1.0, 0.7))], ["head"])
    b.balls("brows", dark, [(v(sx * 0.07, -0.95, 1.87), 0.035, (1.2, 1.4, 0.7)) for sx in (-1, 1)], ["head"])
    b.balls("nostrils", dark, [(v(sx * 0.025, -1.17, 1.79), 0.018, (1, 1, 1)) for sx in (-1, 1)], ["head"])
    b.balls("jaw", scales, [(v(0, -1.0, 1.66), 0.06, (0.95, 1.9, 0.5))], ["jaw"])
    teeth_arc(b, "teeth_top", tooth, v(0, -1.06, 0), 0.06, 0.12, 1.705, 10, 0.03, "head")
    teeth_arc(b, "teeth_low", tooth, v(0, -1.0, 0), 0.05, 0.1, 1.675, 9, 0.025, "jaw", up=True)
    for sx in (-1, 1):
        b.rigid(f"eye{sx}", eye, lambda bm, sx=sx: sphere_at(bm, v(sx * 0.075, -0.97, 1.83), 0.024, 1), "head")
        b.rigid(f"horn{sx}", horn, lambda bm, sx=sx: [cone_to(bm, v(sx * 0.06, -0.86, 1.86), v(sx * 0.11, -0.72, 1.98), 0.035),
                                                       cone_to(bm, v(sx * 0.11, -0.73, 1.97), v(sx * 0.13, -0.58, 1.99), 0.018)], "head")
        b.rigid(f"cheek{sx}", horn, lambda bm, sx=sx: [cone_to(bm, v(sx * 0.1, -0.88, 1.74 - 0.03 * i), v(sx * 0.17, -0.8, 1.74 - 0.04 * i), 0.012)
                                                        for i in range(2)], "head")
    # Spines down the neck, back and tail.
    spikes(b, "spines_neck", dark, [neck_pts[k].lerp(neck_pts[k + 1], 0.5) + v(0, 0.09, 0.09) for k in range(3)], neck[1], 0.08, 0.022, (0, 1, 0.8))
    spikes(b, "spines_back", dark, [v(0, y, 1.37 - 0.25 * (y + 0.3)) for y in (-0.25, -0.05, 0.15)], "chest", 0.1, 0.03)
    limb(b, "tail", scales, tail_pts, [0.18, 0.14, 0.11, 0.08, 0.055, 0.03], ["hips"] + tail, per=4)
    spikes(b, "spines_tail", dark, [tail_pts[k].lerp(tail_pts[k + 1], 0.5) + v(0, 0, 0.13 - 0.025 * k) for k in range(4)], tail[2], 0.08, 0.022)
    b.balls("spade", dark, [(v(0, 1.92, 0.4), 0.09, (1.8, 1.3, 0.25))], [tail[-1]])
    for s, t in ((1, "l"), (-1, "r")):
        hip, knee, ank, foot = v(s * 0.2, 0.05, 0.95), v(s * 0.27, -0.12, 0.6), v(s * 0.26, 0.12, 0.26), v(s * 0.25, -0.1, 0.04)
        l1 = b.bone(f"thigh_{t}", "hips", hip, knee)
        l2 = b.bone(f"shin_{t}", l1, knee, ank)
        l3 = b.bone(f"foot_{t}", l2, ank, foot)
        limb(b, f"leg_{t}", scales, [hip, knee, ank, foot], [0.17, 0.1, 0.065, 0.05], ["hips", l1, l2, l3], per=4)
        b.balls(f"thighm_{t}", scales, [(v(s * 0.22, 0.02, 0.84), 0.15, (0.9, 1.05, 1.35))], ["hips", l1])
        b.balls(f"toes_{t}", scales, [(foot + v(dx, -0.09, -0.015), 0.03, (0.8, 1.8, 0.6)) for dx in (-0.06, 0.0, 0.06)], [l3])
        b.rigid(f"talons_{t}", horn, lambda bm, foot=foot: [cone_to(bm, foot + v(dx * 1.3, -0.15, -0.01), foot + v(dx * 1.5, -0.22, -0.04), 0.018)
                                                            for dx in (-0.05, 0.0, 0.05)] + [cone_to(bm, foot + v(0, 0.05, 0), foot + v(0, 0.13, -0.04), 0.016)], l3)
        # Wing: arm, forearm, four fingers, a hooked thumb at the wrist; leather membrane with a rolled edge.
        sh, el, wr = v(s * 0.15, -0.35, 1.3), v(s * 0.68, -0.2, 1.68), v(s * 1.25, 0.08, 1.88)
        tips = [v(s * 2.0, 0.45, 1.6), v(s * 1.95, 0.62, 1.3), v(s * 1.7, 0.85, 1.02), v(s * 1.28, 0.82, 0.88)]
        w1 = b.bone(f"warm_{t}", "chest", sh, el)
        w2 = b.bone(f"wfore_{t}", w1, el, wr)
        fingers = [b.bone(f"wfing{k}_{t}", w2, wr, tip) for k, tip in enumerate(tips)]
        limb(b, f"wingarm_{t}", scales, [sh, el, wr], [0.075, 0.055, 0.04], ["chest", w1, w2], per=4)
        for k, tip in enumerate(tips):
            b.tube(f"wingfinger{k}_{t}", dark, [wr, wr.lerp(tip, 0.5) + v(0, 0, 0.03), tip], [0.022, 0.015, 0.006], [w2, fingers[k]], 6)
        b.rigid(f"thumb_{t}", horn, lambda bm, wr=wr, s=s: cone_to(bm, wr + v(0, -0.03, 0.04), wr + v(s * 0.02, -0.12, 0.14), 0.02), w2)
        flank = v(s * 0.2, 0.32, 1.02)
        rim = [el, wr] + tips + [flank]
        rows = []
        n = 12
        for j in range(n + 1):
            u = j / n
            outer = rim_point(rim, u)
            inner = sh.lerp(flank, u)
            if u > 0.28:
                outer = outer.lerp(inner, 0.2 * abs(math.sin((u - 0.28) / 0.72 * math.pi * 4)))
            rows.append([inner.lerp(outer, k / 7) for k in range(8)])
        b.sheet(f"wing_{t}", membrane, rows, ["chest", w1, w2] + fingers)
    _wyvern_anims(b, tail)
    return b


def wyvern_belly_image():
    """Pale belly scutes: broad horizontal bands with darker seams."""
    import numpy as np
    from build_party import pattern_image

    def fn(x, y):
        band = np.abs(np.sin(y * np.pi * 26))
        lum = 0.55 + 0.4 * np.clip(band * 1.3, 0, 1) + np.random.default_rng(2).normal(0, 0.03, x.shape)
        return [np.clip(0.52 * lum, 0, 1), np.clip(0.47 * lum, 0, 1), np.clip(0.3 * lum, 0, 1)]

    return pattern_image("wyvern_belly", fn, 256)


def _wyvern_anims(b, tail):
    def idle(t):
        p = {"chest": (0.02 * sine(t), 0, 0), "head": (0.05 * sine(t, 1, 0.2), 0, 0.15 * sine(t, 0.5)),
             "neck2": (0.04 * sine(t, 1, 0.1), 0, 0.05 * sine(t, 0.5, 0.2))}
        for k, bn in enumerate(tail):
            p[bn] = (0, 0, 0.08 * sine(t, 1, 0.12 * k))
        for tg, s in (("l", 1), ("r", -1)):
            p[f"warm_{tg}"] = (0, s * 0.08 * sine(t, 1, 0.1), 0)
        return p

    def walk(t):
        p = {"hips": (0, 0, 0.06 * sine(t)), "chest": (0.03 * sine(t, 2), 0, -0.06 * sine(t))}
        for tg, ph in (("l", 0.0), ("r", 0.5)):
            p[f"thigh_{tg}"] = (-0.45 * sine(t, 1, ph), 0, 0)
            p[f"shin_{tg}"] = (-0.5 * max(0.0, sine(t, 1, ph + 0.25)), 0, 0)
        for k, bn in enumerate(tail):
            p[bn] = (0, 0, 0.1 * sine(t, 1, 0.12 * k + 0.25))
        for tg, s in (("l", 1), ("r", -1)):
            p[f"warm_{tg}"] = (0, s * 0.12 * sine(t, 2), 0)
        return p

    def attack(t):
        a = strike(t, 0.3, 0.5, 0.85)
        p = {"chest": (0.15 * a, 0, 0), "neck1": (0.25 * a, 0, 0), "neck2": (0.25 * a, 0, 0), "neck3": (0.15 * a, 0, 0),
             "jaw": (0.6 * bump(t, 0.25, 0.6), 0, 0)}
        flap = sine(t, 1.5)
        for tg, s in (("l", 1), ("r", -1)):
            p[f"warm_{tg}"] = (0, s * 0.5 * flap, 0)
            p[f"wfore_{tg}"] = (0, s * 0.25 * flap, 0)
        return p

    def block(t):
        k = bump(t, 0, 1)
        p = {"chest": (-0.15 * k, 0, 0), "neck1": (-0.3 * k, 0, 0)}
        for tg, s in (("l", 1), ("r", -1)):
            p[f"warm_{tg}"] = (0, -s * 0.2 * k, -s * 0.6 * k)
        return p

    def hit(t):
        k = bump(t, 0, 0.7)
        return {"chest": (-0.15 * k, 0, 0.1 * k), "neck1": (-0.25 * k, 0, 0.2 * k)}

    def death(t):
        k = smoothstep(0.05, 0.65, t)
        p = {"pivot": (0, 1.45 * k, 0), "neck1": (0.4 * k, 0, 0), "neck2": (0.3 * k, 0, 0)}
        for tg, s in (("l", 1), ("r", -1)):
            p[f"warm_{tg}"] = (0, -s * 0.5 * k, 0)
            p[f"thigh_{tg}"] = (-0.4 * k, 0, 0)
        return p

    b.anim("idle", 60, True, idle)
    b.anim("walk", 28, True, walk)
    b.anim("attack", 30, False, attack)
    b.anim("block", 20, False, block)
    b.anim("hit", 14, False, hit)
    b.anim("death", 40, False, death, root=lambda t: v(0, 0, 0.35 * smoothstep(0.05, 0.65, t)))


def rim_point(rim, u):
    """A point `u` (0..1) of the way along a polyline."""
    lens = [(rim[k + 1] - rim[k]).length for k in range(len(rim) - 1)]
    d = u * sum(lens)
    for k, L in enumerate(lens):
        if d <= L or k == len(lens) - 1:
            return rim[k].lerp(rim[k + 1], min(d / L, 1.0))
        d -= L
    return rim[-1]


BEASTS = {"scp": scorpion, "spi": spider, "ser": servitor, "dog": beasthound, "nth": nethermander, "wyv": wyvern}


# ---------------------------------------------------------------- building


def make_armature(beast):
    data = bpy.data.armatures.new("Rig")
    arm = bpy.data.objects.new("Rig", data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    for o in bpy.context.view_layer.objects:
        o.select_set(o is arm)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, parent, head, tail in beast.bones:
        eb = data.edit_bones.new(name)
        eb.head, eb.tail = head, tail
        if parent:
            eb.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length


def skin(obj, arm, bones):
    """Weights from the distance to each allowed bone's segment (inverse fourth power, best three)."""
    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones if b.name in bones}
    groups = {n: obj.vertex_groups.new(name=n) for n in segs}
    mw = obj.matrix_world
    for vtx in obj.data.vertices:
        p = mw @ vtx.co
        ds = sorted(((seg_dist(p, a, b), n) for n, (a, b) in segs.items()))[:3]
        ws = [(1.0 / (d + 0.01) ** 4, n) for d, n in ds]
        tot = sum(w for w, _ in ws)
        for w, n in ws:
            if w / tot > 0.02:
                groups[n].add([vtx.index], w / tot, "REPLACE")
    obj.parent = arm
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm


def uv_wrap(obj):
    me = obj.data
    uv = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        co = obj.matrix_world @ me.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (math.atan2(co.x, co.z - 0.5) / (2 * math.pi) * 2 + co.y * 0.8, co.y * 2 + co.z * 1.5)


def build_part(kind, name, mat, data):
    if kind == "mball":
        mb = bpy.data.metaballs.new(f"mb_{name}")
        mb.resolution = 0.018
        mb.render_resolution = 0.018
        mb.threshold = 0.6
        for c, r, sc in data:
            e = mb.elements.new(type="ELLIPSOID")
            e.co = c
            # The visible surface (threshold 0.6) sits well inside the radius: scale up so `r` is what shows.
            e.radius = r * 1.6
            e.size_x, e.size_y, e.size_z = sc
        ob = bpy.data.objects.new(f"mb_{name}", mb)
        bpy.context.scene.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        bpy.data.objects.remove(ob, do_unlink=True)
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        if not me.polygons:
            print("WARN empty metaball", name)
    else:
        bm = bmesh.new()
        if kind == "tube":
            pts, radii, segs = data
            # Rounder: more points along the tube.
            fine, fr = [], []
            for k in range(len(pts) - 1):
                for j in range(4):
                    fine.append(pts[k].lerp(pts[k + 1], j / 4))
                    fr.append(radii[k] + (radii[k + 1] - radii[k]) * j / 4)
            fine.append(pts[-1])
            fr.append(radii[-1])
            tube(bm, fine, fr, segs)
        elif kind == "rigid":
            data(bm)
        elif kind == "sheet":
            rows = data
            vs = [[bm.verts.new(p) for p in row] for row in rows]
            for j in range(len(vs) - 1):
                for k in range(len(vs[j]) - 1):
                    bm.faces.new((vs[j][k], vs[j][k + 1], vs[j + 1][k + 1], vs[j + 1][k]))
        obj = link(name, bm, None)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    uv_wrap(obj)
    smooth_shading(obj, 60)
    if kind == "sheet":
        mod = obj.modifiers.new("solid", "SOLIDIFY")
        mod.thickness = 0.01
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def make_actions(beast, arm):
    """One action per clip: every bone keyed every other frame (rest-space world-axis rotations made local)."""
    arm.animation_data_create()
    rest = {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}
    acts = {}
    for clip, (frames, loop, fn, root) in beast.anims.items():
        act = bpy.data.actions.new(clip)
        arm.animation_data.action = act
        for f in list(range(0, frames, 2)) + [frames]:
            t = f / frames
            pose = fn(t)
            for pb in arm.pose.bones:
                pb.rotation_mode = "QUATERNION"
                rx, ry, rz = pose.get(pb.name, (0, 0, 0))
                R = Euler((rx, ry, rz), "XYZ").to_matrix()
                B = rest[pb.name]
                pb.rotation_quaternion = (B.inverted() @ R @ B).to_quaternion()
                pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
            rb = arm.pose.bones["pivot"]
            off = root(t) if root else Vector()
            rb.location = rest["pivot"].inverted() @ off
            rb.keyframe_insert("location", frame=f, group="pivot")
        acts[clip] = act
    acts["cast"] = acts["attack"].copy()
    acts["cast"].name = "cast"
    arm.animation_data.action = None
    return acts


def to_nla(arm, acts):
    for clip, act in acts.items():
        track = arm.animation_data.nla_tracks.new()
        track.name = clip
        strip = track.strips.new(clip, int(act.frame_range[0]), act)
        if hasattr(strip, "action_slot") and act.slots:
            strip.action_slot = act.slots[0]


def previews(beast, arm, acts, out_dir):
    scene = bpy.context.scene
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.data.lens = 45
    scene.camera = cam
    for rot, energy in (((50, 10, -35), 3.5), ((60, 0, 150), 1.2)):
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
        sun.data.energy = energy
        sun.rotation_euler = [math.radians(a) for a in rot]
        scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.37, 0.42, 1)
    scene.world = world
    scene.render.film_transparent = False
    scene.render.resolution_x, scene.render.resolution_y = 640, 480
    pts = [o.matrix_world @ Vector(c) for o in bpy.data.objects if o.type == "MESH" for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    centre = (lo + hi) / 2
    size = max(hi - lo)
    shots = [("idle", 0.3, (0.6, -1, 0.35)), ("idle", 0.3, (1, 0.1, 0.2)), ("walk", 0.25, (0.6, -1, 0.35)),
             ("attack", 0.5, (1, -0.3, 0.25)), ("block", 0.5, (0.6, -1, 0.3)), ("death", 1.0, (0.6, -1, 0.5))]
    for k, (clip, t, d) in enumerate(shots):
        act = acts[clip]
        arm.animation_data.action = act
        if hasattr(arm.animation_data, "action_slot") and act.slots:
            arm.animation_data.action_slot = act.slots[0]
        lo_f, hi_f = act.frame_range
        scene.frame_set(int(lo_f + (hi_f - lo_f) * t))
        cam.location = centre + Vector(d).normalized() * size * 1.7
        cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.abspath(os.path.join(out_dir, f"{beast.name}_{k}_{clip}.png"))
        bpy.ops.render.render(write_still=True)
    arm.animation_data.action = None


def build(name, out_dir, preview_dir):
    reset()
    beast = BEASTS[name]()
    arm = make_armature(beast)
    meshes = []
    for kind, pname, mat, data, bones in beast.parts:
        obj = build_part(kind, pname, mat, data)
        skin(obj, arm, bones)
        meshes.append(obj)
    pts = [o.matrix_world @ vtx.co for o in meshes for vtx in o.data.vertices]
    arm["height"] = max(p.z for p in pts)
    acts = make_actions(beast, arm)
    if preview_dir:
        os.makedirs(preview_dir, exist_ok=True)
        previews(beast, arm, acts, preview_dir)
    to_nla(arm, acts)
    for o in bpy.context.scene.objects:
        o.select_set(o is arm or o.parent is arm)
    out = os.path.abspath(os.path.join(out_dir, name + ".glb"))
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, use_selection=True,
                              export_image_format="WEBP", export_skins=True, export_animations=True,
                              export_animation_mode="NLA_TRACKS", export_force_sampling=True, export_def_bones=False,
                              export_apply=False, export_extras=True, export_draco_mesh_compression_enable=True)
    tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
    print(f"built {name}: {len(meshes)} meshes, {tris} tris, {len(beast.bones)} bones, height {arm['height']:.2f}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out_dir, preview_dir, names = argv[0], argv[1], argv[2:] or list(BEASTS)
    for n in names:
        build(n, out_dir, preview_dir)


if __name__ == "__main__":
    main()
