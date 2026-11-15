/**
 * Places that turn with a planet or moon.
 *
 * A body's container has a rotating zone (`grid`): everything it places inside
 * turns with the body once per `spin` hours, about the body's z axis. That is
 * the surface (cities, outposts) and low orbit alike: Everus Harbor, Port
 * Tressler and Seraphim ride their planet's turn, while moons, Lagrange
 * stations and orbital markers hold still.
 *
 * The game files give the rate of the turn, not where it is at any moment. So
 * a plan carries the turn of each body as an angle the pilot sets, and what a
 * spot is worth is said over time: how long it holds as the place turns away.
 */

import type { Body } from "./types";
import { add, distance, type Vec3 } from "./vec";

/** How far each turning body has turned from the baked instant, degrees, by body id. */
export type Turns = Record<string, number>;

export function rotateZ(v: Vec3, degrees: number): Vec3 {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

const norm = (degrees: number) => ((degrees % 360) + 360) % 360;

/** The body a place turns with, when it turns at all. */
export function carrierOf(place: Body, byId: Map<string, Body>): Body | undefined {
  const body = place.rides ? byId.get(place.rides) : undefined;
  return body?.spin && place.local ? body : undefined;
}

/**
 * The bodies with every place in a rotating zone moved to where its body's
 * turn puts it. Surface places stay on their body's centre, which is how the
 * planner treats them. Returns the same array when nothing has turned.
 */
export function turned(bodies: Body[], turns: Turns): Body[] {
  if (!Object.values(turns).some((d) => norm(d) !== 0)) return bodies;
  const byId = new Map(bodies.map((b) => [b.id, b]));
  return bodies.map((place) => {
    const body = carrierOf(place, byId);
    const degrees = body ? norm(turns[body.id] ?? 0) : 0;
    if (!body || !place.local || place.on || degrees === 0) return place;
    return { ...place, pos: add(body.pos, rotateZ(place.local, degrees)) };
  });
}

/** Speed a turning place moves through space at, metres per second. */
export function turnSpeed(place: Body, body: Body): number {
  if (!place.local || !body.spin) return 0;
  return (2 * Math.PI * Math.hypot(place.local[0], place.local[1])) / (body.spin * 3600);
}

/** Degrees a body turns in `seconds`. */
export const turnIn = (body: Body, seconds: number) => (body.spin ? (360 * seconds) / (body.spin * 3600) : 0);

/**
 * The turn that puts `place` nearest a position read in game, degrees: stand
 * at the place, read `/showlocation`, and the plan's turn matches the game's.
 */
export function turnFrom(position: Vec3, place: Body, body: Body): number | undefined {
  if (!place.local) return undefined;
  const dx = position[0] - body.pos[0];
  const dy = position[1] - body.pos[1];
  if (Math.hypot(dx, dy) < 1 || Math.hypot(place.local[0], place.local[1]) < 1) return undefined;
  return norm(((Math.atan2(dy, dx) - Math.atan2(place.local[1], place.local[0])) * 180) / Math.PI);
}

export interface LastStop {
  marker: Body;
  /** Share of a full turn this marker is the nearest one to the place, 0..1. */
  share: number;
}

/**
 * Which of a body's orbital markers is nearest a place on or over it, and for
 * how much of a turn: the marker a jump stops at when the place is on the far
 * side. Depends on the place's latitude only, so it needs no knowledge of
 * where the turn is. Most-used first.
 */
export function lastStops(place: Body, body: Body, bodies: Body[], samples = 720): LastStop[] {
  const markers = bodies.filter((b) => b.kind === "marker" && b.parent === body.id);
  if (!place.local || markers.length === 0) return [];
  const count = new Map<string, number>();
  for (let i = 0; i < samples; i++) {
    const at = add(body.pos, rotateZ(place.local, (360 * i) / samples));
    let best = markers[0];
    for (const m of markers) if (distance(m.pos, at) < distance(best.pos, at)) best = m;
    count.set(best.id, (count.get(best.id) ?? 0) + 1);
  }
  return markers
    .map((marker) => ({ marker, share: (count.get(marker.id) ?? 0) / samples }))
    .filter((s) => s.share > 0)
    .sort((a, b) => b.share - a.share);
}

/**
 * How long a fixed spot stays good while places turn: `coverAt(t)` is the
 * spot's coverage `t` seconds from now. Scans both ways until it drops under
 * `floor`. Seconds either side; `limit` when it never drops.
 */
export function holdWindow(coverAt: (seconds: number) => number, floor: number, step = 5, limit = 3 * 3600): { before: number; after: number } {
  const scan = (sign: 1 | -1) => {
    for (let t = step; t <= limit; t += step) if (coverAt(sign * t) < floor) return t - step;
    return limit;
  };
  return { before: scan(-1), after: scan(1) };
}
