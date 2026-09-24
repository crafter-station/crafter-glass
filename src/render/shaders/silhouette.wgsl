struct Silhouette {
  viewProjection: mat4x4f,
  model: mat4x4f,
  tube: f32,
}

@group(0) @binding(0) var<uniform> silhouette: Silhouette;

@vertex
fn vs_main(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) core: vec3f,
  @location(3) occlusion: f32,
) -> @builtin(position) vec4f {
  let local = core + (position - core) * silhouette.tube;
  return silhouette.viewProjection * silhouette.model * vec4f(local, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return vec4f(1.0);
}
