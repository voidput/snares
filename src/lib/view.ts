/**
 * Depth for a flat map: which part of a line passes in front of a sphere.
 *
 * The map is an orthographic view, so a sphere is a disc on screen and a
 * straight line stays straight. A line crossing the disc is either in front of
 * the body or behind it, and which is which is the whole of the depth cue.
 */

export type Point = readonly [number, number];

/**
 * The stretch of the segment a→b, as fractions along it, that lies over the
 * disc and nearer the viewer than the sphere's centre plane. `da`, `db` and
 * `dc` are depths toward the viewer of the two ends and the centre. Undefined
 * when no part of it does.
 */
export function frontSpan(a: Point, b: Point, da: number, db: number, centre: Point, radius: number, dc: number): [number, number] | undefined {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const fx = a[0] - centre[0];
  const fy = a[1] - centre[1];
  const qa = dx * dx + dy * dy;
  if (qa === 0 || radius <= 0) return undefined;
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - radius * radius;
  const disc = qb * qb - 4 * qa * qc;
  if (disc <= 0) return undefined;
  const root = Math.sqrt(disc);
  let from = Math.max(0, (-qb - root) / (2 * qa));
  let to = Math.min(1, (-qb + root) / (2 * qa));
  if (to <= from) return undefined;

  // Depth runs linearly along the segment: keep the part nearer than the centre.
  const slope = db - da;
  if (slope === 0) return da > dc ? [from, to] : undefined;
  const cross = (dc - da) / slope;
  if (slope > 0) from = Math.max(from, cross);
  else to = Math.min(to, cross);
  return to > from ? [from, to] : undefined;
}

/** True when a point drawn at `p`, at depth `dp`, is hidden behind the sphere. */
export function behind(p: Point, dp: number, centre: Point, radius: number, dc: number): boolean {
  return dp < dc && Math.hypot(p[0] - centre[0], p[1] - centre[1]) < radius;
}
