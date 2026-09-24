struct Panel {
  center: vec3f,
  size: vec2f,
  brightness: f32,
}

fn panel(direction: vec3f, p: Panel, blur: f32) -> f32 {
  let axis = normalize(p.center);
  let facing = dot(direction, axis);
  if (facing <= 1e-4) {
    return 0.0;
  }
  let hit = direction * (length(p.center) / facing) - p.center;
  let reference = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(axis.y) > 0.9);
  let u = normalize(cross(reference, axis));
  let v = cross(axis, u);
  let local = abs(vec2f(dot(hit, u), dot(hit, v)));
  let inside = smoothstep(p.size * 0.5 + blur, p.size * 0.5 - blur, local);
  return inside.x * inside.y * p.brightness;
}

/** A bright city sky over a dim street, with the example's tall light panel at the right. */
export fn environment(direction: vec3f, panel_brightness: f32) -> vec3f {
  let up = clamp(direction.y, -1.0, 1.0);
  let sky = mix(vec3f(0.35, 0.36, 0.38), vec3f(2.4, 2.5, 2.7), pow(max(up, 0.0), 0.8));
  let street = mix(vec3f(0.35, 0.36, 0.38), vec3f(0.07, 0.07, 0.06), pow(max(-up, 0.0), 0.5));
  let base = select(street, sky, up > 0.0);
  let light = panel(direction, Panel(vec3f(10.0, 5.0, 0.0), vec2f(10.0, 50.0), panel_brightness), 0.6);
  return base + vec3f(light);
}
