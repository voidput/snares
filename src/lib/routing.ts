/**
 * How a quantum jump gets round a body in the way.
 *
 * The game will not plot a jump whose straight line passes through a star,
 * planet or moon; it plots a route of several jumps instead, stopping at that
 * body's orbital markers. The game files give the obstruction radii and the
 * markers but not the route planner itself, so this models it as the shortest
 * chain of clear jumps over the markers of the bodies in the way.
 */

import type { Body } from "./types";
import { closestOnSegment, distance, type Vec3 } from "./vec";

const solid = (body: Body) => !!body.obstruction && (body.kind === "star" || body.kind === "planet" || body.kind === "moon");

/** Bodies whose obstruction sphere the straight line a→b passes through. */
export function obstructions(a: Vec3, b: Vec3, bodies: Body[], ignore: Set<string>): Body[] {
  const hits: Body[] = [];
  for (const body of bodies) {
    if (!body.obstruction || ignore.has(body.id) || !solid(body)) continue;
    // An endpoint inside the sphere is a ship leaving or arriving there.
    if (distance(a, body.pos) < body.obstruction || distance(b, body.pos) < body.obstruction) continue;
    if (closestOnSegment(body.pos, a, b).distance < body.obstruction) hits.push(body);
  }
  return hits;
}

/** How many times the search widens to the markers of bodies found in the way. */
const ROUNDS = 3;

/**
 * The orbital markers a jump from `from` to `to` stops at, in order: none when
 * the straight line is clear, and `undefined` when no clear chain was found.
 * `bodies` must include the markers (see `withMarkers`).
 */
export function findPath(from: Vec3, to: Vec3, bodies: Body[], ignore: Set<string>): Body[] | undefined {
  const blockers = bodies.filter((b) => solid(b) && !ignore.has(b.id));
  const none = new Set<string>();
  let pending = obstructions(from, to, blockers, none);
  if (pending.length === 0) return [];

  const used = new Set<string>();
  const stops: Body[] = [];
  for (let round = 0; round < ROUNDS && pending.length > 0; round++) {
    for (const body of pending) {
      if (used.has(body.id)) continue;
      used.add(body.id);
      for (const marker of bodies) if (marker.kind === "marker" && marker.parent === body.id) stops.push(marker);
    }

    // Shortest chain over: 0 the start, 1..n the markers, n+1 the end.
    const points = [from, ...stops.map((s) => s.pos), to];
    const last = points.length - 1;
    const cost = points.map(() => Infinity);
    const prev = points.map(() => -1);
    const done = points.map(() => false);
    const found = new Map<string, Body>();
    cost[0] = 0;
    for (;;) {
      let at = -1;
      for (let i = 0; i <= last; i++) if (!done[i] && (at < 0 || cost[i] < cost[at])) at = i;
      if (at < 0 || cost[at] === Infinity || at === last) break;
      done[at] = true;
      for (let j = 1; j <= last; j++) {
        if (done[j]) continue;
        const step = distance(points[at], points[j]);
        if (cost[at] + step >= cost[j]) continue;
        const hits = obstructions(points[at], points[j], blockers, none);
        if (hits.length > 0) {
          for (const hit of hits) if (!used.has(hit.id)) found.set(hit.id, hit);
          continue;
        }
        cost[j] = cost[at] + step;
        prev[j] = at;
      }
    }

    if (cost[last] < Infinity) {
      const path: Body[] = [];
      for (let i = prev[last]; i > 0; i = prev[i]) path.unshift(stops[i - 1]);
      return path;
    }
    pending = [...found.values()];
  }
  return undefined;
}
