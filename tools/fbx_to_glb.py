# Headless Blender: import the Optimus FBX (same path Blender uses interactively,
# which renders correctly) and export a GLB with all animation clips baked in.
# Run: blender -b -P tools/fbx_to_glb.py -- <input.fbx> <output.glb>
import bpy
import sys

argv = sys.argv
argv = argv[argv.index("--") + 1:]
fbx_path, glb_path = argv[0], argv[1]

# start from an empty scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# import with Blender's default FBX settings (the ones that look correct in the UI)
bpy.ops.import_scene.fbx(filepath=fbx_path)

# keep every imported take so the glTF exporter emits all of them
n_actions = len(bpy.data.actions)
for a in bpy.data.actions:
    a.use_fake_user = True
print(f"[convert] imported actions: {n_actions}")
for a in bpy.data.actions:
    print(f"[convert]   action: {a.name}")

armatures = [o for o in bpy.data.objects if o.type == 'ARMATURE']
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print(f"[convert] armatures: {[o.name for o in armatures]}")
print(f"[convert] meshes: {[o.name for o in meshes]}")

# export GLB: each action as its own animation clip, Y-up for three.js
bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format='GLB',
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_skins=True,
    export_yup=True,
    export_apply=False,
)
print(f"[convert] wrote {glb_path}")
