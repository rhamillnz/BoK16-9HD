"""Extra prop builders (crystal, corn), registered into build_props.BUILDERS.

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








BUILDERS = {
    "crystal": build_crystal,
    "corn": build_corn,
}
