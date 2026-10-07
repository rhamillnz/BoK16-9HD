"""Bake posed corpses: a Modular Outfits character in the last frame of the Universal Animation Library's death animation.

Usage (headless):
  blender --background --factory-startup --python tools/blender/build_bodies.py -- <outfits_root> <base_characters_root> <ual_glb> <jobs.json>
    outfits_root: ".../Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)"
    base_characters_root: ".../Universal Base Characters[Standard]"

jobs.json entries:
  {"name": "dbody2", "out": "public/models/props/dbody2.glb", "outfit": "Male_Ranger",
   "extras": ["Male_Ranger_Head_Hood"],          # modular parts added to the outfit
   "base": "Superhero_Male_FullBody", "hair": "Hair_SimpleParted", "eyebrows": "Eyebrows_Regular",
   "action": "Death01", "length": 3.91,          # long axis of the lying figure in render units
   "mirror": false, "yaw": 0.0, "ratio": 0.2, "preview": "shots/body-dbody2.png"}

The outfit, base character, hair and the animation library share one 65-bone skeleton, so the action is
assigned to every imported armature, the meshes are evaluated at the action's last frame (armature modifier applied),
then laid along X, scaled uniformly so its length matches `length`, centred on the origin with its
lowest point at z = 0, and exported as a static GLB (no armature). Textures are capped at 512 px.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    engines = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    scene.render.film_transparent = True
    return scene


def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def bounds(objs):
    cs = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    return (Vector((min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs))),
            Vector((max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs))))


def upstream(socket):
    """All nodes feeding `socket`, transitively."""
    seen, stack = set(), [l.from_node for l in socket.links]
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        for i in n.inputs:
            stack.extend(l.from_node for l in i.links)
    return seen


def simplify_materials():
    """Keep the base-colour network: drop ORM/normal maps (weight, and some have no image data, which breaks
    three.js's GLTFLoader). Metal goes to zero, roughness to a matte 0.85."""
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        keep = upstream(bsdf.inputs["Base Color"]) | upstream(bsdf.inputs["Alpha"])
        for name in ("Metallic", "Roughness", "Normal"):
            for l in list(bsdf.inputs[name].links):
                nt.links.remove(l)
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 0.85
        for n in list(nt.nodes):
            if n.type == "TEX_IMAGE" and n not in keep:
                nt.nodes.remove(n)
            elif n.type == "NORMAL_MAP":
                nt.nodes.remove(n)


def bake_pose(outfit_objs, action, scene):
    for arm in (o for o in outfit_objs if o.type == "ARMATURE"):
        arm.animation_data_create()
        arm.animation_data.action = action
        # Blender 4.4+ actions are slotted: bind the slot the glTF importer made for the library's armature.
        if hasattr(arm.animation_data, "action_slot") and action.slots:
            arm.animation_data.action_slot = action.slots[0]
    end = int(action.frame_range[1])
    scene.frame_set(end)
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    baked = []
    for o in outfit_objs:
        # The "Icosphere" is the bone-shape widget shipped with the rig, not part of the body.
        if o.type != "MESH" or o.name.startswith("Icosphere"):
            continue
        ev = o.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(ev, depsgraph=depsgraph)
        new = bpy.data.objects.new(o.name + "_baked", mesh)
        scene.collection.objects.link(new)
        new.matrix_world = ev.matrix_world.copy()
        baked.append(new)
    return baked


def finish(scene, objs, job):
    bpy.context.view_layer.update()
    lo, hi = bounds(objs)
    ext = hi - lo
    # Lay the long axis along X (rotating about Z), mirrored if asked.
    if ext.y > ext.x:
        rot = Matrix.Rotation(math.radians(90), 4, "Z")
        for o in objs:
            o.matrix_world = rot @ o.matrix_world
    if job.get("yaw"):
        rot = Matrix.Rotation(math.radians(job["yaw"]), 4, "Z")
        for o in objs:
            o.matrix_world = rot @ o.matrix_world
    if job.get("mirror"):
        flip = Matrix.Diagonal((1, -1, 1, 1))
        for o in objs:
            o.matrix_world = flip @ o.matrix_world
    bpy.context.view_layer.update()
    lo, hi = bounds(objs)
    k = job["length"] / max(hi.x - lo.x, 1e-6)
    fit = Matrix.Diagonal((k, k, k, 1.0)) @ Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    for o in objs:
        o.matrix_world = fit @ o.matrix_world
    bpy.context.view_layer.update()
    for o in bpy.context.scene.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    # Corpses are seen from a distance and there can be a dozen per zone: decimate the joined mesh.
    body = bpy.context.view_layer.objects.active
    mod = body.modifiers.new("decimate", "DECIMATE")
    mod.ratio = job.get("ratio", 0.2)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    simplify_materials()
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > 512:
            s = 512 / max(w, h)
            img.scale(max(1, int(w * s)), max(1, int(h * s)))
    os.makedirs(os.path.dirname(os.path.abspath(job["out"])), exist_ok=True)
    # Export only the joined body (the rig and widgets are deleted first).
    body = bpy.context.view_layer.objects.active
    for o in list(bpy.data.objects):
        if o is not body:
            bpy.data.objects.remove(o, do_unlink=True)
    body.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(job["out"]), export_format="GLB", export_yup=True,
                              export_image_format="WEBP", use_selection=True)
    lo, hi = bounds([body])
    print(f"built {job['name']}: {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f} x {hi.z - lo.z:.2f} polys {len(body.data.polygons)}")
    if job.get("preview"):
        centre = (lo + hi) / 2
        radius = (hi - lo).length / 2
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        scene.collection.objects.link(cam)
        cam.location = centre + Vector((-0.6, -1.2, 1.0)).normalized() * radius * 3.2
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
    outfits_root, base_root, ual, jobs_path = argv
    with open(jobs_path, encoding="utf-8") as f:
        jobs = json.load(f)
    hair_dir = os.path.join(base_root, "Hairstyles", "Rigged to Head Bone", "glTF (Godot -Unreal)")
    for job in jobs:
        scene = reset()
        anim_objs = import_gltf(ual)
        action = bpy.data.actions[job.get("action", "Death01")]
        files = [os.path.join(outfits_root, "Outfits", job["outfit"] + ".gltf")]
        files += [os.path.join(outfits_root, "Modular Parts", e + ".gltf") for e in job.get("extras", [])]
        if job.get("base"):
            files.append(os.path.join(base_root, "Base Characters", "Godot - UE", job["base"] + ".gltf"))
        files += [os.path.join(hair_dir, job[k] + ".gltf") for k in ("hair", "eyebrows") if job.get(k)]
        imported = []
        for path in files:
            imported += import_gltf(path)
        baked = bake_pose(imported, action, scene)
        for o in anim_objs + imported:
            bpy.data.objects.remove(o, do_unlink=True)
        finish(scene, baked, job)


main()
