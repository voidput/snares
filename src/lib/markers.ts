/**
 * Orbital markers: the six quantum travel points the game puts around every
 * planet and moon (OM-1 to OM-6), and the route-only ones around a star.
 *
 * The game files carry the rule, not the positions: the Planet and Moon star
 * map types spawn `NavPoint_SubPoint` entities, which use the `CardinalPoint`
 * record (named OM-1..6, arrival radius 1 km). The engine places them at run
 * time, so they are derived here.
 *
 * The radius is a fit, not a number from the files: against the OM distances
 * players have measured in Stanton, `√2 × obstruction radius + margin` lands
 * within a metre for most moons and for ArcCorp and microTech. √2 is the ratio
 * at which a straight hop between two neighbouring markers just clears the
 * body. Pyro and Nyx have no measurements to check it against.
 */

import type { Body } from "./types";
import { add, scale, type Vec3 } from "./vec";

/** Ships travelling to a marker drop out this far from it, metres (`CardinalPoint`). */
export const MARKER_ARRIVAL = 1_000;

const MOON_MARGIN = 7_177;
const PLANET_MARGIN = 10_000;

/** OM-1 and OM-2 over the poles, OM-3 to OM-6 around the equator. */
const AXES: Vec3[] = [
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
];

/** Distance of a body's orbital markers from its centre, metres. */
export function markerRadius(body: Body): number {
  return Math.SQRT2 * (body.obstruction ?? 0) + (body.kind === "moon" ? MOON_MARGIN : PLANET_MARGIN);
}

/** The six markers around a star, planet or moon; none for anything else. */
export function markersOf(body: Body): Body[] {
  if (!body.obstruction || (body.kind !== "star" && body.kind !== "planet" && body.kind !== "moon")) return [];
  const radius = markerRadius(body);
  return AXES.map((axis, index) => ({
    id: `${body.id}_OM${index + 1}`,
    name: `${body.name} OM-${index + 1}`,
    kind: "marker" as const,
    parent: body.id,
    pos: add(body.pos, scale(axis, radius)),
    arrival: MARKER_ARRIVAL,
    // A star's points only ever show up as stops on a plotted route.
    hidden: body.kind === "star" ? true : undefined,
    weight: 0,
  }));
}

/** A system's bodies with every orbital marker added after them. */
export function withMarkers(bodies: Body[]): Body[] {
  if (bodies.some((b) => b.kind === "marker")) return bodies;
  return [...bodies, ...bodies.flatMap(markersOf)];
}
