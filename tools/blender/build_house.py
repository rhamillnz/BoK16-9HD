"""Assemble a building from Medieval Village MegaKit modules and fit it to an original footprint.

Usage (headless):
  blender --background --factory-startup --python tools/blender/build_house.py -- <kit_gltf_dir> <jobs.json> [<more kit dirs>...]
  (further kit dirs, e.g. the Fantasy Props and Nature kits, are searched for `extras` pieces and textures)

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
   "fit": "keep",                 # optional: scale uniformly so the long axis matches target[0] (proportions kept)
   "woodgrid_ground": true,       # optional: timber-framed panels on the ground floor too
   "windows": "thin",             # optional: tall narrow round-topped windows (default wide)
   "extras": [{"type": "forge", "at": [x, y], "rot": 0}, {"piece": "Anvil_Log", "at": [x, y], "rot": 30}],
                                  # optional props placed after fitting, in render units from the base centre;
                                  # kit pieces and built extras (forge, inn_sign, cross) scale with the building
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_detail as pd  # noqa: E402

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

    def __init__(self, dirs, scene):
        self.dirs = dirs
        self.scene = scene
        self.cache = {}
        self.parts = []

    def _load(self, name):
        if name not in self.cache:
            before = set(bpy.data.objects)
            path = next(os.path.join(d, name + ".gltf") for d in self.dirs if os.path.exists(os.path.join(d, name + ".gltf")))
            bpy.ops.import_scene.gltf(filepath=path)
            new = [o for o in bpy.data.objects if o not in before]
            meshes = [o for o in new if o.type == "MESH" and not o.name.startswith("Icosphere")]
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


def wall_name(family, kind, windows="wide"):
    w = "Thin" if windows == "thin" else "Wide"
    if family == "UnevenBrick":
        return {"plain": "Wall_UnevenBrick_Straight", "window": f"Wall_UnevenBrick_Window_{w}_Round", "door": "Wall_UnevenBrick_Door_Round"}[kind]
    return {"plain": "Wall_Plaster_Straight", "window": f"Wall_Plaster_Window_{w}_Round", "door": "Wall_Plaster_Door_Round", "grid": "Wall_Plaster_WoodGrid"}[kind]


def build_part(kit, part, ox=0.0, oy=0.0, primary=True):
    """Build one block centred at (ox, oy) in metres. Ridge runs along Y.

    part keys: modules [length, width], floors, ground/upper, woodgrid, chimney,
    kind "hall" (gabled roof) or "tower" (2x2 modules, pointed tower roof; "cross": true puts an iron cross on top),
    windows "wide" | "thin", woodgrid_ground (timber framing on the ground floor too),
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
                elif (f > 0 or part.get("woodgrid_ground")) and part.get("woodgrid") and family == "Plaster":
                    kind = "grid"
                else:
                    kind = "plain"
                x, y = (fixed, along) if axis == "x" else (along, fixed)
                x, y = x + ox, y + oy
                windows = part.get("windows", "wide")
                kit.place(wall_name(family, kind, windows), x, y, z, rot)
                if kind == "door":
                    # Door leaves are hinged at their left edge (x = 0..1.12): centre it in the opening.
                    kit.place("Door_4_Round", x, y, z, rot, local_dx=-0.5)
                elif kind == "window":
                    kit.place("Window_Thin_Round1" if windows == "thin" else "Window_Wide_Round1", x, y, z, rot)
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
        first = len(kit.parts)
        kit.place("Roof_Tower_RoundTiles", ox, oy, top)
        if part.get("cross"):
            peak = max((o.matrix_world @ Vector(c)).z for o in kit.parts[first:] for c in o.bound_box)
            first = len(kit.parts)
            build_cross(kit)
            for o in kit.parts[first:]:
                o.matrix_world = Matrix.Translation((ox, oy, peak - 0.3)) @ o.matrix_world
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


def _flat(name, rgb, rough, glow=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    if glow:
        b.inputs["Emission Color"].default_value = (*rgb, 1.0)
        b.inputs["Emission Strength"].default_value = glow
    return m


def build_forge(kit):
    """Open smithy hearth in metres: brick hearth with glowing coals, a hood and chimney, bellows beside it."""
    bricks = pd.swatch_material(kit, "bricks")
    dark = pd.swatch_material(kit, "stone_dark")
    wood = pd.swatch_material(kit, "plank_dark")
    coal = _flat("coals", (1.0, 0.36, 0.08), 0.6, glow=2.5)
    pd.part(kit, "box", (0, 0, 0.45), (1.6, 1.1, 0.9), bricks, bevel=0.02, uv=1.2)
    pd.part(kit, "box", (0, 0, 0.92), (1.3, 0.8, 0.06), coal)
    for sx in (-1, 1):
        pd.part(kit, "box", (sx * 0.72, 0.4, 1.5), (0.16, 0.16, 1.2), dark)
    pd.part(kit, "pyramid", (0, 0.15, 2.3), (1.7, 1.2, 0.6), bricks, uv=1.2)
    pd.part(kit, "box", (0, 0.25, 3.1), (0.6, 0.6, 1.4), bricks, uv=1.2)
    # Bellows on a little frame at the side.
    pd.part(kit, "box", (1.25, 0, 0.35), (0.6, 0.5, 0.7), wood)
    pd.part(kit, "cylinder", (1.25, 0, 0.82), (0.55, 0.45, 0.25), pd.noise_material("leather", (0.3, 0.17, 0.09), 0.06, 7), segments=10, rot_deg=(0, 90, 0))


def build_inn_sign(kit):
    """Wrought-iron wall bracket with a painted board on two chains (metres; wall at y = 0, sign out towards -y)."""
    iron = _flat("iron", (0.06, 0.06, 0.07), 0.5)
    pd.part(kit, "box", (0, -0.75, 0), (0.08, 1.5, 0.08), iron)
    pd.part(kit, "box", (0, -0.4, -0.35), (0.06, 0.06, 0.95), iron, rot_deg=(-48, 0, 0))
    for sy in (-0.35, -1.25):
        pd.part(kit, "box", (0, sy, -0.2), (0.03, 0.03, 0.4), iron)
    w, h = 1.15, 0.8
    pd.part(kit, "box", (0, -0.8, -0.8), (0.07, w + 0.1, h + 0.1), pd.swatch_material(kit, "plank_dark"), bevel=0.01)
    px = pd._resize(pd.swatch(kit, "plank", 256), 230, 160).copy()
    m = pd.writing_mask(230, 160, (20, 16, 210, 70), 1, 91)
    # A painted tankard under the name: body, rim and handle.
    m[86:146, 92:132] = True
    m[80:88, 88:136] = True
    for k in range(40):
        a = k / 40 * math.pi
        pd._stamp(m, 132 + 18 * math.sin(a), 116 - 18 * math.cos(a), 4)
    img = pd.paint(px, m, (0.92, 0.75, 0.3))
    for sx, rz in ((-1, -90), (1, 90)):
        pd.panel(kit, (sx * 0.04, -0.8, -0.8), w * 0.95, h * 0.95, img, f"innsign{sx}", rot_deg=(0, 0, rz))


def build_cross(kit):
    """Iron cross for a steeple top (metres)."""
    iron = _flat("cross_iron", (0.12, 0.11, 0.1), 0.4)
    pd.part(kit, "box", (0, 0, 0.9), (0.12, 0.12, 1.8), iron)
    pd.part(kit, "box", (0, 0, 1.25), (0.8, 0.12, 0.12), iron)


EXTRA_BUILDERS = {"forge": build_forge, "inn_sign": build_inn_sign, "cross": build_cross}


def add_extra(kit, ex, k):
    """Place one `extras` entry in final render units; built extras and kit pieces are in metres, scaled by k."""
    first = len(kit.parts)
    if "piece" in ex:
        mat = Matrix.Diagonal((ex.get("scale", 1.0),) * 3 + (1.0,))
        for src in kit._load(ex["piece"]):
            o = src.copy()
            kit.scene.collection.objects.link(o)
            o.matrix_world = mat @ src.matrix_world
            kit.parts.append(o)
    else:
        EXTRA_BUILDERS[ex["type"]](kit)
    at = ex["at"]
    place = Matrix.Translation((at[0], at[1], at[2] if len(at) > 2 else 0.0)) @ Matrix.Rotation(math.radians(ex.get("rot", 0)), 4, "Z") @ Matrix.Diagonal((k, k, k, 1.0))
    for o in kit.parts[first:]:
        o.matrix_world = place @ o.matrix_world


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
    if job.get("fit") == "keep":
        s = Vector((s.x, s.x, s.x))
    base = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    fit = Matrix.Diagonal((s.x, s.y, s.z, 1.0)) @ Matrix.Translation(-base)
    for o in parts:
        o.matrix_world = fit @ o.matrix_world
    for ex in job.get("extras", []):
        add_extra(kit, ex, (s.x + s.y) / 2)
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
    kit_dir, jobs_path, more_dirs = argv[0], argv[1], argv[2:]
    with open(jobs_path, encoding="utf-8") as f:
        jobs = json.load(f)
    for job in jobs:
        scene = reset()
        pd._MATS.clear()
        pd._SRC.clear()
        kit = Kit([kit_dir, *more_dirs], scene)
        build(kit, job)
        finish(scene, kit, job)


main()
