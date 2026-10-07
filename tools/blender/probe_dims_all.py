import bpy, sys, os
from mathutils import Vector
d = sys.argv[sys.argv.index("--") + 1]
for f in sorted(os.listdir(d)):
    if not f.endswith(".gltf") or not (f.startswith("Roof") or f.startswith("Wall_") or f.startswith("Door_") or f.startswith("Window_") or f.startswith("Corner_")): continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(d, f))
    cs = [o.matrix_world @ Vector(c) for o in bpy.context.scene.objects if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs))); hi = Vector((max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs)))
    print(f"DIM {f[:-5]}: {hi.x-lo.x:.2f}x{hi.y-lo.y:.2f}x{hi.z-lo.z:.2f} at x{lo.x:.1f} y{lo.y:.1f} z{lo.z:.1f}")
