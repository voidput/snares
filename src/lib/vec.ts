export type Vec3 = readonly [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

export function normalize(a: Vec3): Vec3 {
  const n = length(a);
  return n > 0 ? scale(a, 1 / n) : [1, 0, 0];
}

/** Two unit vectors spanning the plane perpendicular to the unit vector `u`. */
export function tangentBasis(u: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = normalize(cross(u, helper));
  return [e1, cross(u, e1)];
}

/** Closest point to `p` on the segment a→b, as the fraction along it and the point. */
export function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): { t: number; point: Vec3; distance: number } {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2)) : 0;
  const point = add(a, scale(ab, t));
  return { t, point, distance: distance(p, point) };
}
