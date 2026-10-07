import bpy, sys, math
from mathutils import Vector
f, out = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
s = bpy.context.scene; s.render.engine = "BLENDER_EEVEE"; s.render.resolution_x = 800; s.render.resolution_y = 500
w = bpy.data.worlds.new("w"); w.color = (0.5, 0.6, 0.7); s.world = w
bpy.ops.import_scene.gltf(filepath=f)
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); s.collection.objects.link(cam)
cam.location = Vector((1.5, -9.0, 2.2)); cam.rotation_euler = (Vector((0, 0, 1.6)) - cam.location).to_track_quat("-Z", "Y").to_euler(); s.camera = cam
sun = bpy.data.objects.new("s", bpy.data.lights.new("s", "SUN")); sun.data.energy = 3; sun.rotation_euler = (math.radians(55), 0, math.radians(-20)); s.collection.objects.link(sun)
s.render.filepath = out; bpy.ops.render.render(write_still=True)
