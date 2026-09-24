import { environment } from "./env.wgsl";

struct Glass {
  viewProjection: mat4x4f,
  model: mat4x4f,
  eye: vec3f,
  ior: f32,
  light: vec3f,
  thickness: f32,
  aberration: f32,
  reflections: f32,
  occlusion: f32,
  shine: f32,
}

@group(0) @binding(0) var<uniform> glass: Glass;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var sceneSampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) core: vec3f,
  @location(3) occlusion: f32,
}

@vertex
fn vs_main(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) core: vec3f,
  @location(3) occlusion: f32,
) -> VertexOut {
  let world = glass.model * vec4f(position, 1.0);
  var out: VertexOut;
  out.position = glass.viewProjection * world;
  out.world = world.xyz;
  out.normal = (glass.model * vec4f(normal, 0.0)).xyz;
  out.core = (glass.model * vec4f(core, 1.0)).xyz;
  out.occlusion = occlusion;
  return out;
}

fn screenUv(world: vec3f) -> vec2f {
  let clip = glass.viewProjection * vec4f(world, 1.0);
  let ndc = clip.xy / clip.w;
  return clamp(vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5), vec2f(0.001), vec2f(0.999));
}

struct Exit {
  uv: vec2f,
  sheen: f32,
  mirror: vec3f,
}

/** Light entering a round tube, crossing it, and leaving through the far wall. */
fn through(world: vec3f, normal: vec3f, core: vec3f, incident: vec3f, ior: f32) -> Exit {
  let inside = refract(incident, normal, 1.0 / ior);
  let radius = length(world - core);
  let chord = max(-2.0 * dot(world - core, inside), 0.0);
  let far = world + inside * chord;
  let wall = normalize(far - core);
  let f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  var out = refract(inside, -wall, ior);
  var sheen = f0 + (1.0 - f0) * pow(1.0 - max(dot(-inside, wall), 0.0), 5.0);
  if (dot(out, out) < 0.5) {
    out = reflect(inside, wall);
    sheen = 1.0;
  }
  return Exit(screenUv(far + out * glass.thickness * radius), sheen, reflect(inside, wall));
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let normal = normalize(in.normal);
  let view = normalize(glass.eye - in.world);
  let facing = clamp(dot(normal, view), 0.0, 1.0);
  let incident = -view;
  let f0 = pow((glass.ior - 1.0) / (glass.ior + 1.0), 2.0);
  let fresnel = f0 + (1.0 - f0) * pow(1.0 - facing, 5.0);

  let spread = glass.aberration;
  let red = through(in.world, normal, in.core, incident, glass.ior - spread);
  let green = through(in.world, normal, in.core, incident, glass.ior);
  let blue = through(in.world, normal, in.core, incident, glass.ior + spread);
  let behind = vec3f(
    textureSampleLevel(scene, sceneSampler, red.uv, 0.0).r,
    textureSampleLevel(scene, sceneSampler, green.uv, 0.0).g,
    textureSampleLevel(scene, sceneSampler, blue.uv, 0.0).b,
  );
  let inner = environment(green.mirror) * glass.reflections;
  let refracted = mix(behind, inner, green.sheen * 0.22);
  let reflected = environment(reflect(incident, normal)) * glass.reflections;

  let toLight = normalize(glass.light - in.world);
  let halfway = normalize(toLight + view);
  let glance = f0 + (1.0 - f0) * pow(1.0 - max(dot(halfway, view), 0.0), 5.0);
  let highlight = pow(max(dot(normal, halfway), 0.0), 600.0) * glance * glass.shine;

  let shade = mix(1.0 - glass.occlusion, 1.0, in.occlusion);
  let color = (mix(refracted, reflected, fresnel) + vec3f(highlight)) * shade;
  return vec4f(color, 1.0);
}
