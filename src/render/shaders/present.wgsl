import { linearToSrgb3 } from "@vgpu/wgsl-std/color";

struct Present {
  focus: f32,
  falloff: f32,
  shade: f32,
  floor: f32,
  blur: f32,
}

@group(0) @binding(0) var sharp: texture_2d<f32>;
@group(0) @binding(1) var soft: texture_2d<f32>;
@group(0) @binding(2) var presentSampler: sampler;
@group(0) @binding(3) var<uniform> present: Present;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(sharp));
  let crisp = textureLoad(sharp, vec2i(uv * size), 0).rgb;
  let blurred = textureSampleLevel(soft, presentSampler, uv, 0.0).rgb;
  let away = abs(uv.y - 0.5) * 2.0;
  let mixAmount = smoothstep(present.focus, present.falloff, away) * present.blur;
  let color = mix(crisp, blurred, mixAmount) * (1.0 - present.shade * smoothstep(present.floor, 1.0, uv.y));
  let noise = fract(sin(dot(uv * size, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  return vec4f(linearToSrgb3(clamp(color, vec3f(0.0), vec3f(1.0))) + noise / 255.0, 1.0);
}
