import { multiply, rotation, scaling, translation, type Mat4 } from "./math/mat4";
import { fromEuler } from "./math/quat";
import type { Vec3 } from "./math/vec3";
import { viewHeight } from "./render/camera";

export const SCALE = 5;
const SPAN = 2.2;
const KNOT_FIT = 0.72;
const REST = 25;
export const TEXT_DEPTH = -10;
export const GROUND = -7.5;
export const FLOAT = 2;
const SMOOTH = 0.2;

export interface Pointer {
  readonly x: number;
  readonly y: number;
}

/** The knot's scale: full size, or smaller on narrow screens so it keeps a margin at rest. */
export function knotScale(aspect: number): number {
  const width = viewHeight(REST) * aspect;
  return Math.min(SCALE, (KNOT_FIT * width) / SPAN);
}

/** drei's Float: a slow bob and sway. */
export function floating(time: number, scale: number): Mat4 {
  const t = time / 4;
  const bob = (Math.sin(t) / 10) * FLOAT;
  const sway = fromEuler(Math.cos(t) / 8, Math.sin(t) / 8, Math.sin(t) / 20);
  return multiply(translation(0, bob, 0), multiply(rotation(sway), scaling(scale)));
}

/** Where the camera wants to be for a pointer, as the example's rig. */
const wanted = ({ x, y }: Pointer): Vec3 => [Math.sin(-x) * 5, y * 3.5, 15 + Math.cos(x) * 10];

/** Unity's SmoothDamp, the spring maath's damp3 uses. */
function damp(current: number, target: number, velocity: number, dt: number): [number, number] {
  const omega = 2 / SMOOTH;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * dt;
  return [target + (change + temp) * decay, (velocity - omega * temp) * decay];
}

export interface Rig {
  readonly eye: Vec3;
  step(dt: number, pointer: Pointer): void;
}

export function createRig(): Rig {
  let eye: Vec3 = wanted({ x: 0, y: 0 });
  let velocity: Vec3 = [0, 0, 0];
  return {
    get eye() {
      return eye;
    },
    step(dt, pointer) {
      const target = wanted(pointer);
      const next = eye.map((c, i) => damp(c, target[i], velocity[i], dt));
      eye = next.map(([p]) => p) as unknown as Vec3;
      velocity = next.map(([, v]) => v) as unknown as Vec3;
    },
  };
}
