"""Fit replacement models to original footprints and export override .glb files.

Usage (headless):
  blender --background --factory-startup --python tools/blender/fit_override.py -- <jobs.json>

jobs.json: [{"src": "path/to/model.gltf", "out": "public/models/x/name.glb",
             "height": 16.08, "preview": "optional/preview.png"}, ...]

Each model is imported, moved so its base centre sits at the origin, uniformly scaled
to `height` (render units: 1 = 100 BaK units), transforms applied, and exported as GLB
(Y up). This matches the override convention in art/README.md.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    engines = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.film_transparent = True
    return scene


def mesh_bounds(objs):
    corners = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    return lo, hi


def render_preview(scene, objs, path):
    lo, hi = mesh_bounds(objs)
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.01)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.location = centre + Vector((1.0, -1.4, 0.5)).normalized() * radius * 3.0
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = radius * 20
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    scene.collection.objects.link(sun)
    scene.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)


def fit(job):
    scene = reset()
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(job["src"]))
    meshes = [o for o in scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"no meshes in {job['src']}")
    roots = [o for o in scene.objects if o.parent is None]
    lo, hi = mesh_bounds(meshes)
    height = hi.z - lo.z
    s = job["height"] / height
    # Optional footprint cap for low, wide plants: never wider than `width`.
    if job.get("width"):
        s = min(s, job["width"] / max(hi.x - lo.x, hi.y - lo.y))
    base = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for r in roots:
        r.location = (r.location - base) * s
        r.scale = r.scale * s
    bpy.context.view_layer.update()
    for o in scene.objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Optional texture swaps: {"<image file name in the model>": "path/to/replacement.png"}.
    # Imported glTF images are packed, so load the replacement as a new image and
    # repoint every material texture node that used the old one.
    for name, path in job.get("textures", {}).items():
        stem = name.rsplit(".", 1)[0]
        old = [img for img in bpy.data.images if img.name.startswith(stem) or os.path.basename(img.filepath_raw) == name]
        if not old:
            print(f"warning: texture {name} not found in {job['src']}")
            continue
        new = bpy.data.images.load(os.path.abspath(path))
        new.pack()
        for mat in bpy.data.materials:
            if not mat.use_nodes:
                continue
            for node in mat.node_tree.nodes:
                if node.type == "TEX_IMAGE" and node.image in old:
                    node.image = new
                    print(f"swapped {node.image.name} into {mat.name}")
    # Keep browser downloads small: cap texture size and export as WebP.
    max_tex = int(job.get("max_texture", 512))
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > max_tex:
            k = max_tex / max(w, h)
            img.scale(max(1, int(w * k)), max(1, int(h * k)))
    os.makedirs(os.path.dirname(os.path.abspath(job["out"])), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(job["out"]),
        export_format="GLB",
        export_yup=True,
        export_image_format="WEBP",
    )
    lo2, hi2 = mesh_bounds(meshes)
    print(f"fitted {os.path.basename(job['src'])} -> {job['out']}: height {hi2.z - lo2.z:.2f}, footprint {hi2.x - lo2.x:.2f}x{hi2.y - lo2.y:.2f}")
    if job.get("preview"):
        render_preview(scene, meshes, job["preview"])


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        sys.exit("usage: ... -- <jobs.json>")
    with open(argv[0], encoding="utf-8") as f:
        jobs = json.load(f)
    for job in jobs:
        fit(job)


main()
