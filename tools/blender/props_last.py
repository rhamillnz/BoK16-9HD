"""Extra prop builders (crystal, corn, carcass, engine, beetle), registered into build_props.BUILDERS.

Imported by build_props.py; kept in its own file so the main builder stays readable.
"""
import math
import random

import bmesh
import bpy
from mathutils import Euler, Matrix


def build_crystal(kit, job, flat_material):
    """A cluster of hexagonal shards with pointed tips, leaning outwards; the colour glows."""
    col = job.get("color", [0.2, 0.4, 0.9])
    mat = flat_material(job["name"], col, 0.25, glow=0.55)
    rnd = random.Random(job.get("seed", 3))
    n = job.get("shards", 4)
    for i in range(n):
        a = i / n * math.tau + rnd.random() * 0.6
        r = 0.0 if i == 0 else 0.5 + rnd.random() * 0.4
        h = 1.0 if i == 0 else 0.45 + rnd.random() * 0.4
        w = 0.34 if i == 0 else 0.2 + rnd.random() * 0.12
        lean = 0 if i == 0 else 14 + rnd.random() * 16
        base = (math.cos(a) * r, math.sin(a) * r, 0)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.5, radius2=0.5, depth=1.0)
        # Pointed tip: poke the top cap into a pyramid.
        top = [f for f in bm.faces if f.normal.z > 0.9]
        bmesh.ops.poke(bm, faces=top, offset=0.55)
        mesh = bpy.data.meshes.new("shard")
        bm.to_mesh(mesh)
        bm.free()
        o = bpy.data.objects.new("shard", mesh)
        kit.scene.collection.objects.link(o)
        o.data.materials.append(mat)
        rot = Euler((math.radians(lean) * math.sin(a), -math.radians(lean) * math.cos(a), 0)).to_matrix().to_4x4()
        o.matrix_world = Matrix.Translation(base) @ rot @ Matrix.Translation((0, 0, h * 0.5)) @ Matrix.Diagonal((w * 2, w * 2, h / 1.05, 1.0))
        for p in o.data.polygons:
            p.use_smooth = False
        kit.parts.append(o)


def build_corn(kit, job, flat_material):
    stalk = flat_material("stalk", (0.45, 0.4, 0.1), 1.0)
    leaf = flat_material("leaf", (0.3, 0.38, 0.08), 1.0)
    cob = flat_material("cob", (0.85, 0.62, 0.12), 0.8)
    for i, (x, y, h) in enumerate([(0, 0, 1.0), (0.45, 0.2, 0.85), (-0.4, 0.3, 0.9), (0.15, -0.45, 0.8), (-0.3, -0.35, 0.7)]):
        kit.primitive("cylinder", (x, y, h * 0.5), (0.07, 0.07, h), stalk, segments=5)
        for k in range(3):
            a = i * 1.1 + k * 2.1
            kit.primitive("box", (x + math.cos(a) * 0.22, y + math.sin(a) * 0.22, h * (0.35 + 0.18 * k)), (0.5, 0.06, 0.05), leaf, rot_deg=(0, -25, math.degrees(a)))
        kit.primitive("cylinder", (x + 0.06, y, h * 0.62), (0.09, 0.09, 0.3), cob, rot_deg=(0, 12, 0), segments=5)


def build_carcass(kit, job, flat_material):
    hide = flat_material("hide", (0.34, 0.16, 0.08), 1.0)
    bone = flat_material("antler", (0.6, 0.55, 0.42), 0.8)
    iron = flat_material("iron", (0.08, 0.08, 0.09), 0.5)
    kit.primitive("mound", (0, 0, 0), (2.2, 1.0, 0.7), hide, segments=12)
    kit.primitive("mound", (-1.3, 0, 0), (0.8, 0.5, 0.45), hide, segments=10)
    for sy in (-1, 1):
        for k in range(3):
            kit.primitive("cylinder", (-1.5 - 0.1 * k, sy * 0.15, 0.4 + 0.15 * k), (0.05, 0.05, 0.5), bone, rot_deg=(sy * 30, 20 + 15 * k, 0), segments=5)
    for sx in (-0.5, 0.5):
        kit.primitive("cylinder", (sx, 0.55, 0.12), (0.08, 0.08, 0.7), hide, rot_deg=(90, 0, 15), segments=5)
    kit.primitive("cylinder", (1.5, 0.1, 0.06), (0.9, 0.9, 0.08), iron, segments=10)
    kit.primitive("box", (1.15, 0.1, 0.07), (0.5, 0.06, 0.06), iron)


def build_engine(kit, job, flat_material):
    wood = flat_material("beam", (0.3, 0.17, 0.08))
    hide = flat_material("hide", (0.62, 0.38, 0.28), 1.0)
    grey = flat_material("hide_grey", (0.5, 0.5, 0.5), 1.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            kit.primitive("box", (sx * 1.3, sy * 1.3, 2.3), (0.3, 0.3, 4.6), wood)
    kit.primitive("box", (0, 0, 4.7), (3.4, 3.4, 0.25), wood)
    kit.primitive("box", (0, 0, 5.7), (3.0, 3.0, 0.2), wood)
    for sx in (-1, 1):
        kit.primitive("box", (sx * 1.3, 0, 5.2), (0.2, 0.2, 1.0), wood)
    # Hanging hides around the lower frame.
    for i in range(12):
        a = i / 12 * math.tau
        c = hide if i % 3 else grey
        kit.primitive("box", (math.cos(a) * 1.7, math.sin(a) * 1.7, 2.6 - (i % 3) * 0.3), (0.9, 0.05, 2.2 - (i % 3) * 0.5), c, rot_deg=(0, 0, math.degrees(a) + 90))


def build_beetle(kit, job, flat_material):
    shell = flat_material("shell", (0.28, 0.1, 0.05), 0.35)
    dark = flat_material("limb", (0.17, 0.07, 0.04), 0.6)
    kit.primitive("mound", (0, 0, 0), (2.4, 1.6, 1.0), shell, segments=14)
    kit.primitive("mound", (1.35, 0, 0), (1.0, 0.9, 0.6), shell, segments=10)
    for side in (-1, 1):
        for k in range(3):
            x = -0.5 + k * 0.6
            kit.primitive("cylinder", (x, side * 1.1, 0.5), (0.1, 0.1, 1.2), dark, rot_deg=(side * -50, 0, 12 * (k - 1)), segments=5)
        kit.primitive("cylinder", (1.9, side * 0.35, 0.3), (0.12, 0.12, 0.9), dark, rot_deg=(side * -20, 70, 0), segments=5)


BUILDERS = {
    "crystal": build_crystal,
    "corn": build_corn,
    "carcass": build_carcass,
    "engine": build_engine,
    "beetle": build_beetle,
}
