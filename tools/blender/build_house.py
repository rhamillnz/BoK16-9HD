"""Assemble a building from Medieval Village MegaKit modules and fit it to an original footprint.

Usage (headless):
  blender --background --factory-startup --python tools/blender/build_house.py -- <kit_gltf_dir> <jobs.json>

jobs.json entries:
  {"name": "inn", "out": "public/models/buildings/inn.glb",
   "modules": [7, 4],            # length (along the ridge) x width, in 2 m wall modules
   "floors": 2,
   "ground": "UnevenBrick",       # wall family for the ground floor: UnevenBrick | Plaster
   "upper": "Plaster",            # wall family for upper floors
   "woodgrid": true,              # use timber-framed plaster panels on upper floors
   "chimney": true,
   "roof": "terracotta",          # roof tint: terracotta (default) | slate | greygreen | thatch
   "target": [16.6, 9.3, 12.2],   # final size in render units: x (long axis), depth, height
   "preview": "shots/build-inn.png"}

A job may instead list "parts" (shared keys at job level are defaults): a main hall plus annexes
and towers, e.g. {"modules": [7, 3], "offset": [x, y]} / {"kind": "tower", "modules": [2, 2], ...}.
See build_part() for the per-part keys. Offsets are in metres before the final 90 degree turn.

The building is assembled with its ridge along Blender Y, rotated so the long axis is X
(the original models' long axis), then scaled per-axis to `target` with its base centre at
the origin. Textures are capped at 512 px and exported as WebP.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector

MODULE = 2.0
STOREY = 3.12


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
    """Imports each kit piece once and hands out linked duplicates."""

    def __init__(self, directory, scene):
        self.dir = directory
        self.scene = scene
        self.cache = {}
        self.parts = []

    def _load(self, name):
        if name not in self.cache:
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=os.path.join(self.dir, name + ".gltf"))
            new = [o for o in bpy.data.objects if o not in before]
            meshes = [o for o in new if o.type == "MESH"]
            for o in new:
                o.matrix_world = o.matrix_world.copy()
            for o in new:
                if o.type != "MESH":
                    bpy.data.objects.remove(o, do_unlink=True)
            for o in meshes:
                o.parent = None
                self.scene.collection.objects.unlink(o) if o.name in self.scene.collection.objects else None
                for c in list(o.users_collection):
                    c.objects.unlink(o)
            self.cache[name] = meshes
        return self.cache[name]

    def place(self, name, x, y, z, rot_deg=0.0, local_dx=0.0):
        """Place a piece at (x, y, z) rotated about Z; `local_dx` shifts it along its own X axis."""
        rot = Euler((0, 0, math.radians(rot_deg))).to_matrix().to_4x4()
        mat = Matrix.Translation((x, y, z)) @ rot @ Matrix.Translation((local_dx, 0, 0))
        for src in self._load(name):
            o = src.copy()
            self.scene.collection.objects.link(o)
            o.matrix_world = mat @ src.matrix_world
            self.parts.append(o)


def wall_name(family, kind):
    if family == "UnevenBrick":
        return {"plain": "Wall_UnevenBrick_Straight", "window": "Wall_UnevenBrick_Window_Wide_Round", "door": "Wall_UnevenBrick_Door_Round"}[kind]
    return {"plain": "Wall_Plaster_Straight", "window": "Wall_Plaster_Window_Wide_Round", "door": "Wall_Plaster_Door_Round", "grid": "Wall_Plaster_WoodGrid"}[kind]


def build_part(kit, part, ox=0.0, oy=0.0, primary=True):
    """Build one block centred at (ox, oy) in metres. Ridge runs along Y.

    part keys: modules [length, width], floors, ground/upper, woodgrid, chimney,
    kind "hall" (gabled roof) or "tower" (2x2 modules, pointed tower roof),
    skip: wall sides to omit where another block abuts ("-x", "+x", "-y", "+y"),
    door: put the entrance on this block (default: primary block only), on face `door_side` (default "-x").
    """
    length, width = part["modules"]  # length along Y (ridge), width along X
    hx, hy = width * MODULE / 2, length * MODULE / 2
    floors = part.get("floors", 1)
    skip = set(part.get("skip", []))
    tower = part.get("kind") == "tower"
    door = part.get("door", primary)
    door_side = part.get("door_side", "-x")
    for f in range(floors):
        z = f * STOREY
        family = part.get("ground", "UnevenBrick") if f == 0 else part.get("upper", "Plaster")
        # Walls alternate plain/window; the ground floor gets the door on `door_side`.
        sides = [
            # (name, axis, fixed coordinate, count, rotation)
            ("-x", "x", -hx, length, -90.0),
            ("+x", "x", hx, length, 90.0),
            ("-y", "y", -hy, width, 0.0),
            ("+y", "y", hy, width, 180.0),
        ]
        for name, axis, fixed, count, rot in sides:
            if name in skip:
                continue
            for i in range(count):
                along = -count * MODULE / 2 + MODULE / 2 + i * MODULE
                mid = i == count // 2
                if f == 0 and name == door_side and mid and door:
                    kind = "door"
                elif i % 2 == 1:
                    kind = "window"
                elif f > 0 and part.get("woodgrid") and family == "Plaster":
                    kind = "grid"
                else:
                    kind = "plain"
                x, y = (fixed, along) if axis == "x" else (along, fixed)
                x, y = x + ox, y + oy
                kit.place(wall_name(family, kind), x, y, z, rot)
                if kind == "door":
                    # Door leaves are hinged at their left edge (x = 0..1.12): centre it in the opening.
                    kit.place("Door_4_Round", x, y, z, rot, local_dx=-0.5)
                elif kind == "window":
                    kit.place("Window_Wide_Round1", x, y, z, rot)
        # Wooden floor on every storey so windows and doorways don't show a hollow shell.
        for gx in range(width):
            for gy in range(length):
                kit.place("Floor_WoodDark", ox - hx + MODULE / 2 + gx * MODULE, oy - hy + MODULE / 2 + gy * MODULE, z + 0.02)
        corner = "Corner_Exterior_Brick" if family == "UnevenBrick" else "Corner_Exterior_Wood"
        for cx, cy in ((-hx, -hy), (hx, -hy), (-hx, hy), (hx, hy)):
            kit.place(corner, cx + ox, cy + oy, z)
    top = floors * STOREY
    # Ceiling under the roof space.
    for gx in range(width):
        for gy in range(length):
            kit.place("Floor_WoodDark", ox - hx + MODULE / 2 + gx * MODULE, oy - hy + MODULE / 2 + gy * MODULE, top - 0.02)
    if tower:
        kit.place("Roof_Tower_RoundTiles", ox, oy, top)
        return
    kit.place(f"Roof_RoundTiles_{width * 2}x{length * 2}", ox, oy, top)
    gable = f"Roof_Front_Brick{width * 2}"
    if "-y" not in skip:
        kit.place(gable, ox, oy - hy, top, 0.0)
    if "+y" not in skip:
        kit.place(gable, ox, oy + hy, top, 180.0)
    if part.get("chimney"):
        kit.place("Prop_Chimney", ox + hx * 0.45, oy + hy * 0.5, top)


def build(kit, job):
    """A job is either a single block or {"parts": [{..., "offset": [x, y]}, ...]} (first part = main)."""
    for i, part in enumerate(job.get("parts", [job])):
        merged = {**job, **part} if "parts" in job else part
        ox, oy = part.get("offset", (0.0, 0.0))
        build_part(kit, merged, ox, oy, primary=(i == 0))


def bounds(objs):
    cs = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs)))
    hi = Vector((max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs)))
    return lo, hi


ROOF_TINTS = {
    # name: (r, g, b) multiplier applied to the roof tile texture's luminance
    "terracotta": None,
    "slate": (0.8, 0.86, 0.96),
    "greygreen": (0.74, 0.84, 0.76),
    "thatch": (1.0, 0.88, 0.62),
}


def tint_roof(name):
    """Recolour the round-tile roof texture: keep its luminance, replace hue with the tint."""
    import numpy as np
    tint = ROOF_TINTS[name]
    if tint is None:
        return
    for img in bpy.data.images:
        if "RoundTiles_BaseColor" not in img.name:
            continue
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        lum = (px[:, 0] * 0.3 + px[:, 1] * 0.55 + px[:, 2] * 0.15)[:, None]
        px[:, :3] = np.clip(lum * 1.6 * np.array(tint, dtype=np.float32), 0, 1)
        img.pixels.foreach_set(px.reshape(-1))
        img.pack()


def finish(scene, kit, job):
    parts = kit.parts
    # Long axis to X, base centre to origin, per-axis scale to the original's bounding box.
    rot = Matrix.Rotation(math.radians(90), 4, "Z")
    for o in parts:
        o.matrix_world = rot @ o.matrix_world
    bpy.context.view_layer.update()
    lo, hi = bounds(parts)
    tx, ty, tz = job["target"]
    s = Vector((tx / (hi.x - lo.x), ty / (hi.y - lo.y), tz / (hi.z - lo.z)))
    base = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    fit = Matrix.Diagonal((s.x, s.y, s.z, 1.0)) @ Matrix.Translation(-base)
    for o in parts:
        o.matrix_world = fit @ o.matrix_world
    bpy.context.view_layer.update()
    for o in bpy.context.scene.objects:
        o.select_set(o in parts)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > 512:
            k = 512 / max(w, h)
            img.scale(max(1, int(w * k)), max(1, int(h * k)))
    tint_roof(job.get("roof", "terracotta"))
    os.makedirs(os.path.dirname(os.path.abspath(job["out"])), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(job["out"]), export_format="GLB", export_yup=True,
                              export_image_format="WEBP", use_selection=True)
    lo, hi = bounds([bpy.context.view_layer.objects.active])
    print(f"built {job['name']}: {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f} x {hi.z - lo.z:.2f}")
    if job.get("preview"):
        obj = bpy.context.view_layer.objects.active
        centre = (lo + hi) / 2
        radius = (hi - lo).length / 2
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        scene.collection.objects.link(cam)
        cam.location = centre + Vector((-1.3, -1.0, 0.6)).normalized() * radius * 2.6
        cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.camera = cam
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
        sun.data.energy = 3.0
        sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
        scene.collection.objects.link(sun)
        scene.render.filepath = os.path.abspath(job["preview"])
        bpy.ops.render.render(write_still=True)
        _ = obj


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    kit_dir, jobs_path = argv[0], argv[1]
    with open(jobs_path, encoding="utf-8") as f:
        jobs = json.load(f)
    for job in jobs:
        scene = reset()
        kit = Kit(kit_dir, scene)
        build(kit, job)
        finish(scene, kit, job)


main()
