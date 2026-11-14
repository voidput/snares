/**
 * Turns picked locations into solved legs.
 *
 * A plan is a chain: origins -> destination, optionally continuing through
 * route changes (a target drops out at a waypoint, moves a little, and spools
 * again for the next stop). Each hop is a leg with its own routes and its own
 * corridor; the routes of a later leg start where the previous leg dropped the
 * target out.
 */

import {
  bestPartialDirection,
  corridor,
  dampenPosition,
  enclosingBall,
  evaluate,
  evaluateDampen,
  type Corridor,
  type DropPoint,
  type Evaluation,
  type Route,
} from "./solver";
import type { Body } from "./types";
import { add, closestOnSegment, distance, dot, normalize, scale, sub, type Vec3 } from "./vec";

/** "auto", "exact", or a radius in metres. */
export type SpreadMode = "auto" | "exact" | number;

const DEFAULT_ARRIVAL = 20_000;
/** Spread assumed around a station or point target in auto mode. */
const POINT_SPREAD = 10_000;

export const arrivalOf = (body: Body): number => body.arrival ?? DEFAULT_ARRIVAL;

/**
 * How far from an origin's centre a target may spool. Around a planet or moon
 * ships leave from anywhere in orbit, roughly its arrival radius, and the same
 * goes for a city or outpost on one; around a station or marker they leave
 * from close by.
 */
export function spreadOf(body: Body, mode: SpreadMode): number {
  if (mode === "exact") return 0;
  if (typeof mode === "number") return mode;
  return body.kind === "planet" || body.kind === "moon" || body.on ? arrivalOf(body) : POINT_SPREAD;
}

/** The body a location stands for in space: itself, or the one it sits on. */
export const anchorOf = (body: Body): string => body.on ?? body.id;

/** One armistice zone and how much room it leaves. */
export interface ArmisticeGap {
  body: Body;
  /**
   * Metres between the edge of the armistice zone and the nearest point a
   * target can end up: the edge of the snare sphere, or the dampener itself.
   * Negative when they overlap.
   */
  gap: number;
}

/** What the law looks like at a planned position. */
export interface Security {
  /** Places whose monitored zone covers the position: crime here is seen. */
  monitoredBy: Body[];
  /** Places whose jammer covers the position: a dead zone, nothing here is seen. */
  jammedBy: Body[];
  /** Nearest armistice zone, if the system has any. */
  armistice?: ArmisticeGap;
}

/** Places whose monitor zone jammer covers `point`: a comm dead zone. Nearest first. */
export function jammedAt(point: Vec3, bodies: Body[]): Body[] {
  return bodies
    .filter((b) => b.jammer && !b.on && distance(b.pos, point) <= b.jammer)
    .sort((a, b) => distance(a.pos, point) - distance(b.pos, point));
}

/**
 * Places whose monitored zone contains `point`, nearest first. None inside a jammer's
 * dead zone: a jammer cancels every monitored zone that reaches into it.
 */
export function monitoredAt(point: Vec3, bodies: Body[]): Body[] {
  if (jammedAt(point, bodies).length > 0) return [];
  return bodies
    .filter((b) => b.monitored && !b.on && distance(b.pos, point) <= b.monitored)
    .sort((a, b) => distance(a.pos, point) - distance(b.pos, point));
}

/**
 * The armistice zone nearest a device at `point`. `reach` is how far from the
 * point a caught target may sit: the snare radius, or 0 for a dampener.
 */
export function nearestArmistice(point: Vec3, reach: number, bodies: Body[]): ArmisticeGap | undefined {
  let best: ArmisticeGap | undefined;
  for (const body of bodies) {
    if (!body.armistice || body.on) continue;
    const gap = distance(body.pos, point) - body.armistice - reach;
    if (!best || gap < best.gap) best = { body, gap };
  }
  return best;
}

/**
 * The arrival radius to plan against: the real one, pushed out when the
 * destination has an armistice zone, so the snare sphere ends up at least
 * `standoff` clear of it. A target pulled out right beside an armistice zone
 * just flies in.
 */
export function effectiveArrival(dest: Body, standoff: number): number {
  return dest.armistice ? Math.max(arrivalOf(dest), dest.armistice + standoff) : arrivalOf(dest);
}

export interface Blockage {
  routeId: string;
  by: Body;
}

/**
 * "snare": sit out on the routes and pull targets out of quantum.
 * "dampen": sit where targets drop out and stop them spooling again.
 */
export type Mode = "snare" | "dampen";

export interface Leg {
  index: number;
  mode: Mode;
  /** Reach of the device in this mode: snare radius or dampener range, metres. */
  reach: number;
  /** Where each route drops out on the destination's arrival sphere. */
  drops: DropPoint[];
  dest: Body;
  routes: Route[];
  corridor: Corridor;
  /** Distance from the destination the snare is placed at. */
  distance: number;
  /** Direction used: the corridor's, or the best partial one when infeasible. */
  direction: Vec3;
  snare: Vec3;
  evaluation: Evaluation;
  blocked: Blockage[];
  security: Security;
}

export interface PlanInput {
  bodies: Body[];
  originIds: string[];
  /** Destinations in travel order; all but the last are route changes. */
  destIds: string[];
  spread: SpreadMode;
  /** How far a target may move after dropping out at a route change, metres. */
  drift: number;
  radius: number;
  /** Where in the corridor to sit, 0 (nearest the destination) to 1 (farthest). */
  placement: number;
  mode?: Mode;
  /** Dampener range, metres. Used in "dampen" mode. */
  dampenRange?: number;
  /** Distance to keep between the snare sphere and an armistice zone, metres. */
  standoff?: number;
}

/** Bodies whose obstruction sphere the straight line a→b passes through. */
export function obstructions(a: Vec3, b: Vec3, bodies: Body[], ignore: Set<string>): Body[] {
  const hits: Body[] = [];
  for (const body of bodies) {
    if (!body.obstruction || ignore.has(body.id)) continue;
    if (body.kind !== "star" && body.kind !== "planet" && body.kind !== "moon") continue;
    // An endpoint inside the sphere is a ship leaving or arriving there.
    if (distance(a, body.pos) < body.obstruction || distance(b, body.pos) < body.obstruction) continue;
    if (closestOnSegment(body.pos, a, b).distance < body.obstruction) hits.push(body);
  }
  return hits;
}

/** Where each route ends its jump: on the arrival sphere, on the side it came from. */
export function dropPoints(dest: Body, routes: Route[]): DropPoint[] {
  const arrival = arrivalOf(dest);
  return routes.map((r) => {
    const v = sub(r.origin, dest.pos);
    const total = Math.hypot(v[0], v[1], v[2]);
    return {
      id: r.id,
      point: add(dest.pos, scale(normalize(v), arrival)),
      // The route's cone has narrowed to this by the time it reaches the sphere.
      spread: total > 0 ? (r.spread * Math.min(arrival, total)) / total : 0,
    };
  });
}

/** How well a device at `point` does against a leg's routes, in the leg's mode. */
export function evaluateLeg(leg: Leg, point: Vec3): Evaluation {
  return leg.mode === "dampen"
    ? evaluateDampen(leg.drops, point, leg.reach)
    : evaluate(leg.dest.pos, leg.routes, point, leg.reach);
}

export function solveLeg(
  index: number,
  dest: Body,
  routes: Route[],
  bodies: Body[],
  radius: number,
  placement: number,
  ignore: Set<string>,
  mode: Mode = "snare",
  dampenRange = 0,
  standoff = 0,
): Leg {
  const drops = dropPoints(dest, routes);
  const blocked: Blockage[] = [];
  for (const route of routes) {
    for (const by of obstructions(route.origin, dest.pos, bodies, new Set([...ignore, anchorOf(dest)]))) {
      blocked.push({ routeId: route.id, by });
    }
  }

  if (mode === "dampen") {
    const position = routes.length > 0 ? dampenPosition(drops, dampenRange) : dest.pos;
    const evaluation = evaluateDampen(drops, position, dampenRange);
    const dist = distance(position, dest.pos);
    const direction = normalize(sub(position, dest.pos));
    return {
      index,
      mode,
      reach: dampenRange,
      drops,
      dest,
      routes,
      // A dampener has one best spot, not a stretch of them.
      corridor: {
        direction,
        phi: 0,
        minDistance: dist,
        maxDistance: dist,
        feasible: routes.length > 0 && evaluation.margin >= 0,
      },
      distance: dist,
      direction,
      snare: position,
      evaluation,
      blocked,
      security: { monitoredBy: monitoredAt(position, bodies), jammedBy: jammedAt(position, bodies), armistice: nearestArmistice(position, 0, bodies) },
    };
  }

  const c = corridor(dest.pos, routes, { radius, arrival: effectiveArrival(dest, standoff) });
  const t = Math.min(1, Math.max(0, placement));

  let dist = c.minDistance;
  let direction = c.direction;
  if (c.feasible) {
    // Geometric interpolation: the corridor spans orders of magnitude.
    dist = c.minDistance * Math.pow(c.maxDistance / c.minDistance, t);
  } else if (routes.length > 0) {
    direction = bestPartialDirection(dest.pos, routes, radius, dist, c.direction);
  }

  const snare = add(dest.pos, scale(direction, dist));
  return {
    index,
    mode,
    reach: radius,
    drops,
    dest,
    routes,
    corridor: c,
    distance: dist,
    direction,
    snare,
    evaluation: evaluate(dest.pos, routes, snare, radius),
    blocked,
    security: { monitoredBy: monitoredAt(snare, bodies), jammedBy: jammedAt(snare, bodies), armistice: nearestArmistice(snare, radius, bodies) },
  };
}

export function solvePlan(input: PlanInput): Leg[] {
  const byId = new Map(input.bodies.map((b) => [b.id, b]));
  const origins = input.originIds.map((id) => byId.get(id)).filter((b): b is Body => !!b);
  const dests = input.destIds.map((id) => byId.get(id)).filter((b): b is Body => !!b);
  if (origins.length === 0 || dests.length === 0) return [];

  const legs: Leg[] = [];
  // Two origins on one body (a city and its planet) are one route, and an
  // origin on the destination's own body is no route at all.
  const seen = new Set([anchorOf(dests[0])]);
  let routes: Route[] = origins
    .filter((o) => !seen.has(anchorOf(o)) && !!seen.add(anchorOf(o)))
    .map((o) => ({ id: o.id, label: o.name, origin: o.pos, spread: spreadOf(o, input.spread) }));
  let ignore = new Set(origins.map(anchorOf));

  for (let i = 0; i < dests.length; i++) {
    const dest = dests[i];
    legs.push(
      solveLeg(
        i,
        dest,
        routes,
        input.bodies,
        input.radius,
        input.placement,
        ignore,
        input.mode,
        input.dampenRange,
        input.standoff,
      ),
    );

    // The next leg starts where this one drops the target: on the arrival
    // sphere, on the side the target came from, give or take its drift.
    const arrival = arrivalOf(dest);
    routes = routes.map((r) => ({
      id: r.id,
      label: `${r.label} › ${dest.name}`,
      origin: add(dest.pos, scale(normalize(sub(r.origin, dest.pos)), arrival)),
      spread: input.drift,
    }));
    ignore = new Set([anchorOf(dest)]);
  }
  return legs;
}

/** How close to the arrival sphere counts as "finish the jump", metres. */
export const ARRIVAL_SLACK = 2_000;

export interface Approach {
  from: Body;
  to: Body;
  /** Distance left to `to` at the moment to drop out, metres. */
  remaining: number;
  /** How far off the snare position that drop-out point is, metres. */
  miss: number;
  /** The drop-out point. */
  point: Vec3;
}

/**
 * Ways to reach a point in open space: quantum from one location toward
 * another and drop out early. Ranked by how close the line passes; lines
 * blocked by a body, or that pass the point inside the target's arrival
 * radius or before leaving the start, are skipped.
 */
export function approaches(target: Vec3, bodies: Body[], options: { from?: Body; limit?: number } = {}): Approach[] {
  // Markers a pilot can actually select: not the star, not ones the star map
  // hides, and not bare asteroid bases. A chosen start is taken as given.
  // Surface locations are left out too: they fly the same line as their body.
  const selectable = bodies.filter((b) => b.kind !== "star" && b.kind !== "asteroid" && !b.hidden && !b.on);
  const starts = options.from ? [options.from] : selectable;
  const found: Approach[] = [];

  for (const from of starts) {
    for (const to of selectable) {
      if (to.id === from.id) continue;
      const total = distance(from.pos, to.pos);
      if (total < 1) continue;
      const hit = closestOnSegment(target, from.pos, to.pos);
      const remaining = (1 - hit.t) * total;
      const travelled = hit.t * total;
      // Past the arrival sphere a jump has already ended. A point on the
      // sphere itself is reached by simply finishing the jump, so allow a
      // little slack there: that is exactly where a dampener waits.
      if (remaining < arrivalOf(to) - ARRIVAL_SLACK || travelled <= arrivalOf(from)) continue;
      found.push({ from, to, remaining, miss: hit.distance, point: hit.point });
    }
  }

  // Closest pass first, in 1 km steps; among equals, the shortest run-in,
  // which is the easiest drop-out to time.
  found.sort((a, b) => Math.round(a.miss / 1000) - Math.round(b.miss / 1000) || a.remaining - b.remaining);
  const out: Approach[] = [];
  for (const candidate of found) {
    if (out.length >= (options.limit ?? 5)) break;
    const ignore = new Set([candidate.from.id, candidate.to.id]);
    if (obstructions(candidate.from.pos, candidate.to.pos, bodies, ignore).length > 0) continue;
    out.push(candidate);
  }
  return out;
}

export interface Catch {
  /** Origins one snare position covers in full, nearest the centre line first. */
  originIds: string[];
  /** How many of them are not bare asteroid bases: the busier places. */
  major: number;
  /** Sum of the origins' traffic weights: what the group is worth. */
  score: number;
  /** Snare: farthest it can sit from the destination and still cover them all. */
  maxDistance: number;
  /** Dampener: range left over once every arrival is held. */
  margin: number;
}

/**
 * Given only a destination, the groups of origins a single snare can cover in
 * full: where to sit to catch the most traffic. Ranked by the summed traffic
 * weight of a group's origins, so a city planet and two serviced stations
 * outrank a dozen comm arrays.
 *
 * Every marker a pilot could be leaving from is a candidate, bar ones whose
 * straight line to the destination is blocked. Covering the most of them is a
 * maximum-coverage problem; this grows a group greedily from each candidate in
 * turn, always adding the route nearest the group's centre line and keeping it
 * only while one position still covers the whole group.
 */
export function bestCatches(
  bodies: Body[],
  dest: Body,
  options: {
    radius: number;
    spread: SpreadMode;
    limit?: number;
    mode?: Mode;
    dampenRange?: number;
    /** Traffic weights set by hand, by body id, overriding the baked ones. */
    weights?: Weights;
    /** Distance to keep between the snare sphere and an armistice zone, metres. */
    standoff?: number;
  },
): Catch[] {
  const weigh = (b: Body) => weightOf(b, options.weights);
  if (options.mode === "dampen") {
    return bestHolds(bodies, dest, options.dampenRange ?? 0, options.spread, weigh, options.limit);
  }
  const corridorOptions = { radius: options.radius, arrival: effectiveArrival(dest, options.standoff ?? 0) };
  const ignore = new Set([anchorOf(dest)]);

  // Surface locations stand for their body, which is already a candidate.
  const candidates = bodies
    .filter((b) => b.kind !== "star" && !b.hidden && !b.on && anchorOf(b) !== anchorOf(dest))
    .filter((b) => distance(b.pos, dest.pos) > corridorOptions.arrival + options.radius)
    .filter((b) => obstructions(b.pos, dest.pos, bodies, new Set([...ignore, b.id])).length === 0)
    .map((b) => ({
      route: { id: b.id, label: b.name, origin: b.pos, spread: spreadOf(b, options.spread) } satisfies Route,
      dir: normalize(sub(b.pos, dest.pos)),
      major: b.kind !== "asteroid",
      weight: weigh(b),
    }))
    // A route too wide to cover even alone can never be part of a group.
    .filter((c) => corridor(dest.pos, [c.route], corridorOptions).feasible)
    // Grow from the places that matter most first.
    .sort((a, b) => b.weight - a.weight);

  // Routes a snare can hold together all lie within this angle of its centre
  // line, so anything more than twice that from the line can be ruled out
  // without solving.
  const reach = Math.asin(Math.min(1, options.radius / (corridorOptions.arrival + options.radius)));
  const outOfReach = Math.cos(Math.min(Math.PI, 2 * reach));

  const groups = new Map<string, Catch>();
  const grouped = new Set<string>();
  for (const seed of candidates) {
    // A route already in a group would mostly regrow that same group.
    if (grouped.has(seed.route.id)) continue;
    let group = [seed];
    let fit = corridor(dest.pos, [seed.route], corridorOptions);
    const rest = candidates.filter((c) => c !== seed);

    for (let misses = 0; rest.length > 0 && misses < 4; ) {
      // Nearest remaining route to where the group's snare would point.
      let pick = 0;
      for (let i = 1; i < rest.length; i++) {
        if (dot(rest[i].dir, fit.direction) > dot(rest[pick].dir, fit.direction)) pick = i;
      }
      // The nearest is out of reach, so everything left is.
      if (dot(rest[pick].dir, fit.direction) < outOfReach) break;
      const [next] = rest.splice(pick, 1);
      const trial = corridor(dest.pos, [...group, next].map((c) => c.route), corridorOptions);
      if (trial.feasible) {
        group = [...group, next];
        fit = trial;
        misses = 0;
      } else {
        misses++;
      }
    }

    const ids = group.map((c) => c.route.id);
    const key = [...ids].sort().join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        originIds: ids,
        major: group.filter((c) => c.major).length,
        score: group.reduce((sum, c) => sum + c.weight, 0),
        maxDistance: fit.maxDistance,
        margin: 0,
      });
    }
    for (const id of ids) grouped.add(id);
  }

  return rankCatches([...groups.values()], options.limit);
}

/** Hand-set traffic weights by body id. */
export type Weights = Record<string, number>;

/**
 * Traffic weight of a body: the hand-set one if there is one, else the baked
 * one. A surface location is weighed as its body, and a weight set on either
 * counts for both, since they are one route.
 */
export function weightOf(body: Body, overrides?: Weights): number {
  const set = overrides?.[body.id] ?? (body.on ? overrides?.[body.on] : undefined);
  return set ?? body.weight ?? 1;
}

/**
 * Hand-set weights, folded onto the bodies that stand for them: a weight put
 * on a city lands on its planet, which is the candidate the search uses.
 */
export function anchorWeights(bodies: Body[], overrides: Weights): Weights {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const out: Weights = {};
  for (const [id, weight] of Object.entries(overrides)) {
    const body = byId.get(id);
    if (!body) continue;
    const anchor = anchorOf(body);
    out[anchor] = Math.max(out[anchor] ?? -Infinity, weight);
  }
  return out;
}

/** Heaviest first, then biggest, then roomiest; groups inside a listed one dropped. */
function rankCatches(groups: Catch[], limit = 4): Catch[] {
  const ranked = groups.sort(
    (a, b) =>
      b.score - a.score ||
      b.originIds.length - a.originIds.length ||
      b.maxDistance - a.maxDistance ||
      b.margin - a.margin,
  );
  const out: Catch[] = [];
  for (const group of ranked) {
    if (out.length >= limit) break;
    if (out.some((kept) => group.originIds.every((id) => kept.originIds.includes(id)))) continue;
    out.push(group);
  }
  return out;
}

/**
 * The dampener's version of `bestCatches`: the groups of origins whose
 * drop-out points one dampener position holds, grown the same greedy way but
 * over points on the arrival sphere instead of directions.
 */
function bestHolds(
  bodies: Body[],
  dest: Body,
  range: number,
  spread: SpreadMode,
  weigh: (body: Body) => number,
  limit?: number,
): Catch[] {
  const ignore = new Set([anchorOf(dest)]);
  const origins = bodies
    .filter((b) => b.kind !== "star" && !b.hidden && !b.on && anchorOf(b) !== anchorOf(dest))
    .filter((b) => distance(b.pos, dest.pos) > arrivalOf(dest))
    .filter((b) => obstructions(b.pos, dest.pos, bodies, new Set([...ignore, b.id])).length === 0);
  const drops = dropPoints(
    dest,
    origins.map((b) => ({ id: b.id, label: b.name, origin: b.pos, spread: spreadOf(b, spread) })),
  );
  const candidates = drops
    .map((drop, index) => ({ drop, major: origins[index].kind !== "asteroid", weight: weigh(origins[index]) }))
    // A drop-out area wider than the dampener cannot be held even alone.
    .filter((c) => c.drop.spread <= range)
    .sort((a, b) => b.weight - a.weight);

  const groups: Catch[] = [];
  const seenKeys = new Set<string>();
  const grouped = new Set<string>();
  for (const seed of candidates) {
    if (grouped.has(seed.drop.id)) continue;
    let group = [seed];
    let ball = enclosingBall([seed.drop], 60);
    const rest = candidates.filter((c) => c !== seed);

    for (let misses = 0; rest.length > 0 && misses < 4; ) {
      let pick = 0;
      let nearest = Infinity;
      for (let i = 0; i < rest.length; i++) {
        const d = distance(rest[i].drop.point, ball.centre);
        if (d < nearest) {
          nearest = d;
          pick = i;
        }
      }
      // Everything a dampener holds is within its range of it, so a point
      // more than twice that from the group's centre can never join.
      if (nearest > 2 * range) break;
      const [next] = rest.splice(pick, 1);
      const trial = enclosingBall([...group, next].map((c) => c.drop), 60);
      if (trial.radius <= range) {
        group = [...group, next];
        ball = trial;
        misses = 0;
      } else {
        misses++;
      }
    }

    const ids = group.map((c) => c.drop.id);
    const key = [...ids].sort().join("|");
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      groups.push({
        originIds: ids,
        major: group.filter((c) => c.major).length,
        score: group.reduce((sum, c) => sum + c.weight, 0),
        maxDistance: 0,
        margin: range - ball.radius,
      });
    }
    for (const id of ids) grouped.add(id);
  }
  return rankCatches(groups, limit);
}

/** Places worth scanning as a destination: ones pilots actually fly to. */
export function scanTargets(bodies: Body[]): Body[] {
  return bodies.filter((b) => b.kind !== "star" && b.kind !== "asteroid" && b.kind !== "other" && !b.hidden && !b.on);
}
