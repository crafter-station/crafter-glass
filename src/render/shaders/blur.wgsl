struct Blur {
  step: vec2f,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> blur: Blur;

const WEIGHTS = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  var color = textureSampleLevel(src, srcSampler, uv, 0.0) * WEIGHTS[0];
  for (var i = 1; i < 5; i++) {
    let offset = blur.step * f32(i);
    color += textureSampleLevel(src, srcSampler, uv + offset, 0.0) * WEIGHTS[i];
    color += textureSampleLevel(src, srcSampler, uv - offset, 0.0) * WEIGHTS[i];
  }
  return color;
}
