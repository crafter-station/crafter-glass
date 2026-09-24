@group(0) @binding(0) var backdrop: texture_2d<f32>;
@group(0) @binding(1) var glass: texture_2d<f32>;
@group(0) @binding(2) var compositeSampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let behind = textureSampleLevel(backdrop, compositeSampler, uv, 0.0).rgb;
  let front = textureSampleLevel(glass, compositeSampler, uv, 0.0);
  return vec4f(front.rgb + behind * (1.0 - front.a), 1.0);
}
