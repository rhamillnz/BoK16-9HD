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
   # Standing figures (NPCs): "stand": true, "height": 2.2, "width": 1.0, "frame": 0.3 (fraction of the action, default last frame)
   "mirror": false, "yaw": 0.0, "ratio": 0.2, "tex": 256,
   "tints": {"Body": {"color": [0.3, 0.16, 0.42], "target": 1.0}},   # per-part recolour, see tint_object
   "preview": "shots/body-dbody2.png"}

The outfit, base character, hair and the animation library share one 65-bone skeleton, so the action is
assigned to every imported armature, the meshes are evaluated at the action's last frame (armature modifier applied),
then laid along X, scaled uniformly so its length matches `length`, centred on the origin with its
lowest point at z = 0, and exported as a static GLB (no armature). Textures are capped at `tex` px (default 256).
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


def bypass_vertex_colour(mat):
    """Some outfit materials multiply the texture by a painted vertex colour (very dark on the rangers):
    wire the texture straight into Base Color instead."""
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return
    ups = upstream(bsdf.inputs["Base Color"])
    if not any(n.type == "VERTEX_COLOR" for n in ups):
        return
    tex = next((n for n in ups if n.type == "TEX_IMAGE"), None)
    if tex is not None:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])


def simplify_materials():
    """Keep the base-colour network: drop ORM/normal maps (weight, and some have no image data, which breaks
    three.js's GLTFLoader). Metal goes to zero, roughness to a matte 0.85."""
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        bypass_vertex_colour(mat)
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


def tint_object(obj, spec):
    """Recolour a baked part: keep the base-colour texture's light/dark pattern, replace its colour.

    spec = {"color": [r, g, b], "target": 1.0}: the texture's luminance is rescaled to a median of
    `target` and multiplied by `color` (linear, 0..1). Each slot gets its own copy of the material and
    image, so parts sharing one atlas can be tinted differently.
    """
    import numpy as np
    for slot in obj.material_slots:
        mat = slot.material.copy()
        slot.material = mat
        mat.name = "tint_" + spec.get("name", obj.name)
        bypass_vertex_colour(mat)
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        tex = next((n for n in upstream(bsdf.inputs["Base Color"]) if n.type == "TEX_IMAGE"), None) if bsdf else None
        if tex is None or tex.image is None or tex.image.size[0] == 0:
            continue
        img = tex.image.copy()
        if max(img.size) > 1024:
            img.scale(512, 512)
        tex.image = img
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        lum = px[:, 0] * 0.3 + px[:, 1] * 0.55 + px[:, 2] * 0.15
        mean = min(max(float(np.median(lum[px[:, 3] > 0.5])) if (px[:, 3] > 0.5).any() else float(lum.mean()), 0.02), 1.0)
        px[:, :3] = np.clip((lum / mean * spec.get("target", 1.0))[:, None] * np.array(spec["color"], dtype=np.float32), 0, 1)
        img.pixels.foreach_set(px.reshape(-1))
        img.pack()


# Base-character parts hidden under the outfit: decimation would let this skin poke through the clothes.
COVERED_BONES = ("pelvis", "spine", "clavicle", "upperarm", "thigh", "calf", "foot", "ball")


def strip_covered_skin(obj, group_names):
    """Delete the vertices of a baked base character whose strongest bone is covered by clothing."""
    import bmesh as bm_mod
    bm = bm_mod.new()
    bm.from_mesh(obj.data)
    layer = bm.verts.layers.deform.active
    if layer is None:
        bm.free()
        return
    doomed = []
    for v in bm.verts:
        weights = v[layer]
        if not weights:
            continue
        top = max(weights.items(), key=lambda kv: kv[1])[0]
        if group_names[top].startswith(COVERED_BONES):
            doomed.append(v)
    bm_mod.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def bake_pose(outfit_objs, action, scene, frame=None):
    for arm in (o for o in outfit_objs if o.type == "ARMATURE"):
        arm.animation_data_create()
        arm.animation_data.action = action
        # Blender 4.4+ actions are slotted: bind the slot the glTF importer made for the library's armature.
        if hasattr(arm.animation_data, "action_slot") and action.slots:
            arm.animation_data.action_slot = action.slots[0]
    # Default: the action's last frame (the death pose); `frame` is a 0..1 fraction of the range (idle poses).
    lo_f, hi_f = action.frame_range
    scene.frame_set(int(hi_f if frame is None else lo_f + (hi_f - lo_f) * frame))
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
        if o.name.lower().startswith("superhero"):
            strip_covered_skin(new, [g.name for g in o.vertex_groups])
        baked.append(new)
    return baked


def finish(scene, objs, job):
    tex_cap = job.get("tex", 256)
    bpy.context.view_layer.update()
    lo, hi = bounds(objs)
    ext = hi - lo
    # Lay the long axis along X (rotating about Z), mirrored if asked. Standing figures keep their orientation.
    if not job.get("stand") and ext.y > ext.x:
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
    if job.get("stand"):
        # Upright figure: fit the height (Z), optional extra sideways width, feet at z = 0, centred on X/Y.
        k = job["height"] / max(hi.z - lo.z, 1e-6)
        w = job.get("width", 1.0)
        fit = Matrix.Diagonal((k * w, k * w, k, 1.0)) @ Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    else:
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
    # Static mesh: drop skin weights and the extra UV sets the rig exports carry (they dominate the file size).
    body.vertex_groups.clear()
    while len(body.data.uv_layers) > 1:
        body.data.uv_layers.remove(body.data.uv_layers[-1])
    mod = body.modifiers.new("decimate", "DECIMATE")
    mod.ratio = job.get("ratio", 0.2)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    simplify_materials()
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > tex_cap:
            s = tex_cap / max(w, h)
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
        frame = job.get("frame")
        files = [os.path.join(outfits_root, "Outfits", job["outfit"] + ".gltf")]
        files += [os.path.join(outfits_root, "Modular Parts", e + ".gltf") for e in job.get("extras", [])]
        if job.get("base"):
            files.append(os.path.join(base_root, "Base Characters", "Godot - UE", job["base"] + ".gltf"))
        files += [os.path.join(hair_dir, job[k] + ".gltf") for k in ("hair", "eyebrows") if job.get(k)]
        imported = []
        for path in files:
            imported += import_gltf(path)
        baked = bake_pose(imported, action, scene, frame)
        for o in anim_objs + imported:
            bpy.data.objects.remove(o, do_unlink=True)
        for o in baked:
            for key, spec in job.get("tints", {}).items():
                if key in o.name:
                    tint_object(o, {**spec, "name": key.lower()})
        finish(scene, baked, job)


main()
