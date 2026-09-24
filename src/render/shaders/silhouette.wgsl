struct Silhouette {
  viewProjection: mat4x4f,
  model: mat4x4f,
}

@group(0) @binding(0) var<uniform> silhouette: Silhouette;

@vertex
fn vs_main(@location(0) position: vec3f) -> @builtin(position) vec4f {
  return silhouette.viewProjection * silhouette.model * vec4f(position, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return vec4f(1.0);
}
