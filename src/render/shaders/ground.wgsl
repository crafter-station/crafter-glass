struct Ground {
  viewProjection: mat4x4f,
  height: f32,
  reach: f32,
  extent: f32,
  opacity: f32,
}

@group(0) @binding(0) var<uniform> ground: Ground;
@group(0) @binding(1) var shadow: texture_2d<f32>;
@group(0) @binding(2) var shadowSampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@location(0) position: vec2f) -> VertexOut {
  var out: VertexOut;
  let world = vec3f(position.x * ground.extent, ground.height, position.y * ground.extent);
  out.position = ground.viewProjection * vec4f(world, 1.0);
  out.uv = world.xz / ground.reach * 0.5 + 0.5;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let edge = max(abs(in.uv.x * 2.0 - 1.0), abs(in.uv.y * 2.0 - 1.0));
  let inside = smoothstep(1.0, 0.8, edge);
  let dark = textureSampleLevel(shadow, shadowSampler, clamp(in.uv, vec2f(0.0), vec2f(1.0)), 0.0).r;
  return vec4f(0.0, 0.0, 0.0, dark * inside * ground.opacity);
}
