import bpy, sys, os
from mathutils import Vector
d = sys.argv[sys.argv.index("--") + 1]
names = ["Wall_Plaster_Straight", "Wall_Plaster_Window_Wide_Round", "Wall_Plaster_Door_Round", "Wall_UnevenBrick_Straight", "Corner_Exterior_Wood", "Floor_WoodDark", "Roof_RoundTiles_4x4", "Roof_RoundTiles_6x4", "Roof_2x4", "Roof_Modular_RoundTiles", "Overhang_Plaster_Long", "Wall_Plaster_WoodGrid", "Prop_Chimney"]
files = {os.path.splitext(f)[0]: f for f in os.listdir(d) if f.endswith(".gltf")}
for n in names:
    m = [k for k in files if k.startswith(n)]
    if not m: print("MISSING", n); continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(d, files[m[0]]))
    cs = [o.matrix_world @ Vector(c) for o in bpy.context.scene.objects if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs))); hi = Vector((max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs)))
    print(f"DIM {m[0]}: x[{lo.x:.2f},{hi.x:.2f}] y[{lo.y:.2f},{hi.y:.2f}] z[{lo.z:.2f},{hi.z:.2f}]")
