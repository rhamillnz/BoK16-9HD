"""Convert reference OBJ models to GLB and render a preview PNG for each.

Usage (headless):
  blender --background --factory-startup --python tools/blender/obj_to_glb.py -- <in_dir> [out_dir] [--only name,name]

For every <name>.obj in in_dir this writes <out_dir>/<name>.glb and <out_dir>/<name>.png
(a 3/4 view, flat shaded, framed to the model's bounds). out_dir defaults to in_dir.
"""
import math
import os
import sys

import bpy
from mathutils import Vector


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = None
    if "--only" in argv:
        i = argv.index("--only")
        only = set(argv[i + 1].split(","))
        argv = argv[:i] + argv[i + 2:]
    if not argv:
        sys.exit("usage: ... -- <in_dir> [out_dir] [--only a,b]")
    in_dir = os.path.abspath(argv[0])
    out_dir = os.path.abspath(argv[1]) if len(argv) > 1 else in_dir
    return in_dir, out_dir, only


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.film_transparent = True
    world = bpy.data.worlds.new("World")
    world.color = (0.18, 0.2, 0.24)
    scene.world = world
    return scene


def frame_and_render(scene, objs, png_path):
    corners = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.01)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    direction = Vector((1.0, -1.2, 0.8)).normalized()
    cam.location = centre + direction * radius * 3.2
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.clip_end = radius * 20
    scene.camera = cam

    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    scene.collection.objects.link(sun)

    scene.render.filepath = png_path
    bpy.ops.render.render(write_still=True)


def main():
    in_dir, out_dir, only = parse_args()
    os.makedirs(out_dir, exist_ok=True)
    names = sorted(f[:-4] for f in os.listdir(in_dir) if f.lower().endswith(".obj"))
    if only:
        names = [n for n in names if n in only]
    for name in names:
        scene = reset_scene()
        # OBJ is already Y-up; Blender's importer converts to Z-up for us.
        bpy.ops.wm.obj_import(filepath=os.path.join(in_dir, name + ".obj"))
        objs = [o for o in scene.objects if o.type == "MESH"]
        for o in objs:
            for poly in o.data.polygons:
                poly.use_smooth = False
            # The original engine draws faces double-sided.
            for mat in o.data.materials:
                if mat:
                    mat.use_backface_culling = False
        bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, name + ".glb"), export_format="GLB", export_yup=True)
        frame_and_render(scene, objs, os.path.join(out_dir, name + ".png"))
        print(f"converted {name}")


main()
