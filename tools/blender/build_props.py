"""Build small prop models from Medieval Village / Stylised Nature kit pieces and primitives, fitted to a box.

Usage (headless):
  blender --background --factory-startup --python tools/blender/build_props.py -- <jobs.json> <gltf_dir> [<gltf_dir> ...]   (village, nature and fantasy-props kits)

jobs.json entries:
  {"name": "fence", "out": "public/models/props/fence.glb", "type": "fence",
   "box": [xmin, ymin, zmin, xmax, ymax, zmax],     # final bounds in render units (x east, y north, z up)
   "preview": "shots/prop-fence.png"}

Types: fence (row of wooden panels along X), crate (kit crate), well (brick ring, posts, tiled roof),
rocks (cluster of nature-kit rocks), slab (one tall rock), firepit (stone ring, ashes, logs),
marker (low rock),
chest (Fantasy Props Chest_Wood), tent (cloth A-frame);
crystal, corn (see props_last.py);
textured second-pass types (see props_detail.py): gravestone ("variant" 0-4), tomb, waymark ("variant" 0-2),
signboard ("boards", "lantern", "ink"), column, stump, molehill, ropepost, scarecrow, boxtrap, beetle,
catapult, siegeshed, temple.

Each type is built at a natural size, then scaled per axis to `box` and placed so the box minimum
is at (xmin, ymin, zmin). With "fit": "height" the model is scaled uniformly to the box height instead
(proportions kept) and centred on the box footprint; a negative zmin buries that much below ground. Coordinates match the game (Blender X/Y/Z = BaK x/y/z), so the glTF
export (Y up) lands on the usual render-space convention. Textures are capped at 512 px as WebP.
"""
import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    engines = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    scene.render.film_transparent = True
    return scene


class Kit:
    def __init__(self, dirs, scene):
        self.dirs = dirs
        self.scene = scene
        self.cache = {}
        self.parts = []

    def _load(self, name):
        if name not in self.cache:
            path = next(os.path.join(d, name + ".gltf") for d in self.dirs if os.path.exists(os.path.join(d, name + ".gltf")))
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=path)
            new = [o for o in bpy.data.objects if o not in before]
            # "Icosphere" is the bone-shape widget some rigged kit pieces ship with, not part of the prop.
            meshes = [o for o in new if o.type == "MESH" and not o.name.startswith("Icosphere")]
            for o in new:
                o.matrix_world = o.matrix_world.copy()
            for o in new:
                if o.type != "MESH":
                    bpy.data.objects.remove(o, do_unlink=True)
            for o in meshes:
                o.parent = None
                for c in list(o.users_collection):
                    c.objects.unlink(o)
            self.cache[name] = meshes
        return self.cache[name]

    def place(self, name, loc=(0, 0, 0), rot_deg=(0, 0, 0), scale=(1, 1, 1)):
        mat = Matrix.Translation(loc) @ Euler([math.radians(a) for a in rot_deg]).to_matrix().to_4x4() @ Matrix.Diagonal((*scale, 1.0))
        made = []
        for src in self._load(name):
            o = src.copy()
            self.scene.collection.objects.link(o)
            o.matrix_world = mat @ src.matrix_world
            self.parts.append(o)
            made.append(o)
        return made

    def material_of(self, name):
        return self._load(name)[0].active_material

    def primitive(self, kind, loc, size, material, rot_deg=(0, 0, 0), segments=16):
        """size = (x, y, z) full extents. kinds: box, cylinder, cone, mound."""
        bm = bmesh.new()
        if kind == "box":
            bmesh.ops.create_cube(bm, size=1.0)
        elif kind == "cylinder":
            bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=0.5, radius2=0.5, depth=1.0)
        elif kind == "cone":
            bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=0.5, radius2=0.18, depth=1.0)
        elif kind == "mound":
            bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=8, radius=0.5)
            for v in bm.verts:
                if v.co.z < 0:
                    v.co.z = 0
                else:
                    v.co.x *= 1.0 + 0.15 * math.sin(v.co.y * 13)
        mesh = bpy.data.meshes.new(kind)
        bm.to_mesh(mesh)
        bm.free()
        o = bpy.data.objects.new(kind, mesh)
        self.scene.collection.objects.link(o)
        o.data.materials.append(material)
        o.matrix_world = Matrix.Translation(loc) @ Euler([math.radians(a) for a in rot_deg]).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1.0))
        for p in o.data.polygons:
            p.use_smooth = kind == "mound"
        self.parts.append(o)
        return o


def flat_material(name, rgb, roughness=0.9, glow=0.0):
    """Plain colour material; `glow` > 0 also emits the same colour (strength 1) scaled by `glow`."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if glow > 0:
        bsdf.inputs["Emission Color"].default_value = (*[c * glow for c in rgb], 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    return m


def build_fence(kit, job):
    n = job.get("panels", 5)
    for i in range(n):
        kit.place("Prop_WoodenFence_Single", (-(n - 1) * 1.0 + i * 2.0, 0, 0.03))


def build_crate(kit, job):
    kit.place("Prop_Crate", (0, 0, 0))


def build_well(kit, job):
    # Primitives have no UVs, so posts and roof use flat colours rather than the kit's textures.
    wood = flat_material("beam", (0.2, 0.11, 0.055))
    # Brick ring: 4 courses of bricks around a 1.6 m radius.
    courses, per = 3, 22
    names = ["Prop_Brick1", "Prop_Brick2", "Prop_Brick3", "Prop_Brick4"]
    for c in range(courses):
        for i in range(per):
            a = (i + 0.5 * (c % 2)) / per * math.tau
            kit.place(names[(i + c) % 4], (math.cos(a) * 1.6, math.sin(a) * 1.6, 0.11 + c * 0.22), (0, 0, math.degrees(a) + 90), (1.3, 1.3, 1.0))
    # Dark water disc.
    kit.primitive("cylinder", (0, 0, 0.5), (3.0, 3.0, 0.04), flat_material("water", (0.03, 0.05, 0.07), 0.2), segments=24)
    # Two posts, a crossbeam and a small gabled roof.
    for sx in (-1, 1):
        kit.primitive("box", (sx * 1.7, 0, 1.25), (0.2, 0.2, 2.5), wood)
    kit.primitive("box", (0, 0, 2.45), (3.8, 0.18, 0.18), wood)
    tile = flat_material("roof", (0.38, 0.13, 0.07))
    for sy in (-1, 1):
        kit.primitive("box", (0, sy * 0.65, 2.85), (4.2, 1.5, 0.1), tile, rot_deg=(sy * 32, 0, 0))


def build_rocks(kit, job):
    rnd = random.Random(7)
    for name, x, y, s, r in [("Rock_Medium_1", 0, 0, 1.0, 20), ("Rock_Medium_2", 1.1, 0.35, 0.8, 140), ("Rock_Medium_3", -1.0, 0.25, 0.7, 260), ("Rock_Medium_1", 0.2, -0.5, 0.5, 70)]:
        kit.place(name, (x, y, -0.1 * s), (0, 0, r + rnd.random() * 10), (s, s, s))


def build_slab(kit, job):
    kit.place("Rock_Medium_2", (0, 0, 0), (0, 0, 30))


def build_firepit(kit, job):
    ash = flat_material("ash", (0.05, 0.045, 0.04))
    n = 12
    stones = ["Pebble_Round_1", "Pebble_Square_2", "Pebble_Round_3", "Pebble_Square_4"]
    for i in range(n):
        a = i / n * math.tau
        kit.place(stones[i % 4], (math.cos(a) * 1.5, math.sin(a) * 1.5, 0.0), (0, 0, math.degrees(a) * 2.3), (2.4, 2.4, 2.4))
    kit.primitive("cylinder", (0, 0, 0.02), (2.8, 2.8, 0.05), ash, segments=20)
    char = flat_material("charcoal", (0.03, 0.025, 0.02))
    for r in (10, 70, 130):
        kit.primitive("cylinder", (0, 0, 0.15), (0.22, 0.22, 1.6), char, rot_deg=(90, 0, r), segments=8)






def build_chest(kit, job):
    kit.place("Chest_Wood", (0, 0, 0))


def build_tent(kit, job):
    """Canvas A-frame: ridge pole, two slopes and a closed back; the front (-X) stays open and dark."""
    cloth = flat_material("canvas", (0.5, 0.42, 0.28), 1.0)
    inside = flat_material("canvas_inside", (0.16, 0.13, 0.08), 1.0)
    wood = flat_material("pole", (0.18, 0.1, 0.05))
    L, W, H = 3.0, 2.4, 1.8
    verts = [(-L / 2, 0, H), (L / 2, 0, H), (-L / 2, -W / 2, 0), (L / 2, -W / 2, 0), (-L / 2, W / 2, 0), (L / 2, W / 2, 0)]
    faces = [(0, 1, 3, 2), (1, 0, 4, 5), (1, 5, 3), (0, 2, 4)]
    mesh = bpy.data.meshes.new("tent")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("tent", mesh)
    kit.scene.collection.objects.link(obj)
    mesh.materials.append(cloth)
    mesh.materials.append(inside)
    mesh.polygons[3].material_index = 1  # front opening shows the dark inside
    kit.parts.append(obj)
    for sx in (-1, 1):
        kit.primitive("box", (sx * L / 2, 0, H / 2), (0.08, 0.08, H + 0.2), wood)
    kit.primitive("box", (0, 0, H + 0.06), (L + 0.4, 0.08, 0.08), wood)














def build_marker(kit, job):
    kit.place("Rock_Medium_1", (0, 0, 0), (0, 0, 40))
    kit.place("Rock_Medium_2", (0.9, 0.3, 0), (0, 0, 120), (0.5, 0.5, 0.5))




# Extra types live in props_last.py (crystal, corn) and props_detail.py (textured second pass).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_detail  # noqa: E402
import props_last  # noqa: E402

BUILDERS = {"marker": build_marker, "chest": build_chest, "tent": build_tent, "fence": build_fence, "crate": build_crate,
            "well": build_well, "rocks": build_rocks, "slab": build_slab, "firepit": build_firepit}


def bounds(objs):
    # True vertex bounds (bound_box would over-estimate rotated parts).
    cs = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    return (Vector((min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs))),
            Vector((max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs))))


def finish(scene, kit, job):
    parts = kit.parts
    bpy.context.view_layer.update()
    # Bake every part's transform into its mesh and join first: scaling rotated parts per axis through
    # matrix_world would shear them (Blender drops the shear), so the footprint came out too wide.
    for o in bpy.context.scene.objects:
        o.select_set(o in parts)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    lo, hi = bounds([joined])
    bx = job["box"]
    size = Vector((bx[3] - bx[0], bx[4] - bx[1], bx[5] - bx[2]))
    s = Vector([size[i] / max(1e-6, (hi - lo)[i]) for i in range(3)])
    if job.get("fit") == "height":
        # Keep the builder's proportions: scale uniformly to the box height, centred on the box footprint.
        s = Vector((s.z, s.z, s.z))
        lo = Vector(((lo.x + hi.x) / 2 - (bx[0] + bx[3]) / 2 / s.z, (lo.y + hi.y) / 2 - (bx[1] + bx[4]) / 2 / s.z, lo.z))
        fit = Matrix.Translation((0, 0, bx[2])) @ Matrix.Diagonal((s.x, s.y, s.z, 1.0)) @ Matrix.Translation(-lo)
    else:
        fit = Matrix.Translation((bx[0], bx[1], bx[2])) @ Matrix.Diagonal((s.x, s.y, s.z, 1.0)) @ Matrix.Translation(-lo)
    joined.data.transform(fit)
    joined.data.update()
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > 512:
            k = 512 / max(w, h)
            img.scale(max(1, int(w * k)), max(1, int(h * k)))
    os.makedirs(os.path.dirname(os.path.abspath(job["out"])), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(job["out"]), export_format="GLB", export_yup=True,
                              export_image_format="WEBP", use_selection=True)
    obj = bpy.context.view_layer.objects.active
    lo, hi = bounds([obj])
    print(f"built {job['name']}: {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f} x {hi.z - lo.z:.2f} polys {len(obj.data.polygons)}")
    if job.get("preview"):
        centre = (lo + hi) / 2
        radius = (hi - lo).length / 2
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        scene.collection.objects.link(cam)
        cam.location = centre + Vector((-1.2, -1.4, 0.7)).normalized() * radius * 2.8
        cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.camera = cam
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
        sun.data.energy = 3.0
        sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
        scene.collection.objects.link(sun)
        scene.render.filepath = os.path.abspath(job["preview"])
        bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    jobs_path, kit_dirs = argv[0], argv[1:]
    with open(jobs_path, encoding="utf-8") as f:
        jobs = json.load(f)
    for job in jobs:
        scene = reset()
        kit = Kit(kit_dirs, scene)
        if job["type"] in props_detail.BUILDERS:
            props_detail.BUILDERS[job["type"]](kit, job, flat_material)
        elif job["type"] in props_last.BUILDERS:
            props_last.BUILDERS[job["type"]](kit, job, flat_material)
        else:
            BUILDERS[job["type"]](kit, job)
        finish(scene, kit, job)


main()
