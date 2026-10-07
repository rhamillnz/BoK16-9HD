import bpy, sys
argv = sys.argv[sys.argv.index("--") + 1:]
for f in argv:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type == "MESH")
    print(f"TRIS {f.split('/')[-1]} {tris}")
