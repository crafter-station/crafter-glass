struct Text {
  viewProjection: mat4x4f,
  size: vec2f,
  depth: f32,
  lift: f32,
  ink: vec3f,
  pad: f32,
}

@group(0) @binding(0) var<uniform> text: Text;
@group(0) @binding(1) var glyphs: texture_2d<f32>;
@group(0) @binding(2) var glyphSampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@location(0) position: vec2f) -> VertexOut {
  var out: VertexOut;
  let world = vec3f(position * text.size * 0.5 + vec2f(0.0, text.lift), text.depth);
  out.position = text.viewProjection * vec4f(world, 1.0);
  out.uv = vec2f(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let coverage = textureSample(glyphs, glyphSampler, in.uv).a;
  return vec4f(text.ink, coverage);
}
