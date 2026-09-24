import { multiply, perspective, type Mat4 } from "../math/mat4";
import { cross, dot, normalize, sub, type Vec3 } from "../math/vec3";

export const FOV = (50 * Math.PI) / 180;
const NEAR = 1;
const FAR = 120;
const UP: Vec3 = [0, 1, 0];

export function lookAt(eye: Vec3, at: Vec3): Mat4 {
  const z = normalize(sub(eye, at));
  const x = normalize(cross(UP, z));
  const y = cross(z, x);
  const m = new Float32Array(16);
  [x, y, z].forEach((axis, row) => {
    m[row] = axis[0];
    m[4 + row] = axis[1];
    m[8 + row] = axis[2];
    m[12 + row] = -dot(axis, eye);
  });
  m[15] = 1;
  return m;
}

export const viewProjection = ([width, height]: readonly [number, number], eye: Vec3): Mat4 =>
  multiply(perspective(FOV, width / height, NEAR, FAR), lookAt(eye, [0, 0, 0]));

/** Height of the view at a plane `distance` in front of the camera, in world units. */
export const viewHeight = (distance: number): number => 2 * distance * Math.tan(FOV / 2);

/** A top-down orthographic view over a square of half-size `reach`, for the contact shadow. */
export function topDown(reach: number, top: number, range: number): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1 / reach;
  m[9] = -1 / reach;
  m[6] = -1 / range;
  m[14] = top / range;
  m[15] = 1;
  return m;
}
