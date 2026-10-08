import bpy
op = bpy.context.active_operator

op.export_format = 'GLB'
op.export_yup = True
op.export_apply = True
op.use_renderable = True
op.export_cameras = False
op.export_lights = False
op.export_extras = True
op.export_draco_mesh_compression_enable = True
op.export_draco_mesh_compression_level = 6
op.export_draco_position_quantization = 14
op.export_draco_normal_quantization = 10
op.export_draco_texcoord_quantization = 12
op.export_draco_color_quantization = 10
op.export_draco_generic_quantization = 12
