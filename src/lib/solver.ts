/**
 * Where to park a quantum snare.
 *
 * Ships in quantum fly a straight line from where they spooled to the centre of
 * their destination and drop out at its arrival radius. Every route into one
 * destination therefore meets at it, and a snare of radius R catches a route if
 * the route's line passes within R of the snare.
 *
 * A route is not one line. A ship leaves from somewhere around its origin, a
 * sphere of radius `spread`, so the route is a cone of lines narrowing to the
 * destination: at distance t from the destination along a route of length L the
 * cone is `spread * t / L` wide. A route is fully covered when its whole cone
 * cross-section sits inside the snare.
 *
 * Everything is measured from the destination, and every quantity scales with
 * the distance from it. So the problem splits: find the direction from the
 * destination that keeps the worst route closest (`phi`, a dimensionless
 * spread per metre of distance), then the snare can sit anywhere along that
 * direction out to R / phi and still cover everything.
 */

import { add, cross, dot, length, normalize, scale, sub, tangentBasis, type Vec3 } from "./vec";

export interface Route {
  id: string;
  label: string;
  /** Where the target spools from. */
  origin: Vec3;
  /** Radius around the origin the target may actually leave from, metres. */
  spread: number;
}

export interface Corridor {
  /** Unit direction from the destination along which the snare covers the most. */
  direction: Vec3;
  /** Required snare radius per metre of distance from the destination. */
  phi: number;
  /** Closest useful distance: the snare sphere just clear of the dropout sphere. */
  minDistance: number;
  /** Farthest distance at which every route is still fully covered. */
  maxDistance: number;
  /** True when a full-coverage position exists. */
  feasible: boolean;
}

export interface RouteCoverage {
  id: string;
  /** Distance from the destination to the snare's closest point on the route axis. */
  along: number;
  /** Distance from the snare to the route axis. */
  offset: number;
  /** Radius of the route's cone where the snare sits. */
  coneRadius: number;
  /** Fraction of the cone cross-section inside the snare, 0..1. */
  coverage: number;
  /** Metres to spare: how far the snare can drift and still cover the route fully. */
  margin: number;
}

export interface Evaluation {
  routes: RouteCoverage[];
  /** Mean coverage over the routes, 0..1. */
  coverage: number;
  /** Smallest margin; negative when some route is only partly covered. */
  margin: number;
}

interface Axis {
  dir: Vec3;
  length: number;
  spread: number;
}

function axes(dest: Vec3, routes: Route[]): Axis[] {
  return routes.map((r) => {
    const v = sub(r.origin, dest);
    return { dir: normalize(v), length: length(v), spread: r.spread };
  });
}

/** Snare radius route `a` needs per metre of distance, with the snare along unit `u`. */
function need(a: Axis, u: Vec3): number {
  const c = dot(u, a.dir);
  // Behind the destination the route never passes: grow with the angle so the
  // minimiser is still pushed back toward it.
  if (c <= 0) return 1 - c;
  const coneSlope = a.length > 0 ? a.spread / a.length : 0;
  return Math.sqrt(Math.max(0, 1 - c * c)) + coneSlope * c;
}

function worst(list: Axis[], u: Vec3): { value: number; index: number } {
  let value = -Infinity;
  let index = 0;
  for (let i = 0; i < list.length; i++) {
    const n = need(list[i], u);
    if (n > value) {
      value = n;
      index = i;
    }
  }
  return { value, index };
}

/** Minimise a function of direction by a shrinking pattern search on the sphere. */
function refine(start: Vec3, cost: (u: Vec3) => number, step = 0.2): Vec3 {
  let best = start;
  let bestCost = cost(best);
  for (let iteration = 0; iteration < 400 && step > 1e-13; iteration++) {
    const [e1, e2] = tangentBasis(best);
    let improved = false;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
      const candidate = normalize(add(best, add(scale(e1, a * step), scale(e2, b * step))));
      const c = cost(candidate);
      if (c < bestCost) {
        best = candidate;
        bestCost = c;
        improved = true;
      }
    }
    if (!improved) step /= 2;
  }
  return best;
}

/** The direction from the destination that minimises the worst route's need. */
export function bestDirection(dest: Vec3, routes: Route[]): { direction: Vec3; phi: number } {
  const list = axes(dest, routes);
  if (list.length === 0) return { direction: [1, 0, 0], phi: Infinity };

  // Start at the mean heading, walk toward whichever route is worst with a
  // shrinking step (the minimum enclosing ball iteration), then polish.
  let u = normalize(list.reduce<Vec3>((sum, a) => add(sum, a.dir), [0, 0, 0]));
  if (!Number.isFinite(u[0]) || length(u) === 0) u = list[0].dir;
  for (let k = 1; k <= 300; k++) {
    const { index } = worst(list, u);
    u = normalize(add(u, scale(sub(list[index].dir, u), 1 / (k + 1))));
  }
  u = refine(u, (v) => worst(list, v).value);
  return { direction: u, phi: worst(list, u).value };
}

export interface CorridorOptions {
  /** Snare radius, metres. */
  radius: number;
  /** Destination arrival radius, metres. */
  arrival: number;
}

export function corridor(dest: Vec3, routes: Route[], options: CorridorOptions): Corridor {
  const { direction, phi } = bestDirection(dest, routes);
  const minDistance = options.arrival + options.radius;

  // Full coverage holds out to R / phi, but never past the point where the
  // snare would sit inside a route's own departure zone.
  let maxDistance = phi > 0 ? options.radius / phi : Infinity;
  for (const a of axes(dest, routes)) {
    const c = dot(direction, a.dir);
    if (c > 0) maxDistance = Math.min(maxDistance, Math.max(0, a.length - a.spread - options.radius) / c);
  }

  return { direction, phi, minDistance, maxDistance, feasible: routes.length > 0 && maxDistance >= minDistance };
}

/** Area of overlap of two circles of radius `r1`, `r2` whose centres are `d` apart. */
export function circleOverlap(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  const small = Math.min(r1, r2);
  if (d <= Math.abs(r1 - r2)) return Math.PI * small * small;
  const a1 = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const kite = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return r1 * r1 * a1 + r2 * r2 * a2 - kite;
}

/** How well a snare of `radius` at `snare` covers each route into `dest`. */
export function evaluate(dest: Vec3, routes: Route[], snare: Vec3, radius: number): Evaluation {
  const rel = sub(snare, dest);
  const results: RouteCoverage[] = routes.map((route) => {
    const v = sub(route.origin, dest);
    const routeLength = length(v);
    const dir = normalize(v);
    const along = dot(rel, dir);
    const offset = length(cross(rel, dir));
    const inside = along > 0 && along < routeLength;
    const coneRadius = inside && routeLength > 0 ? (route.spread * along) / routeLength : 0;

    let coverage = 0;
    if (inside) {
      coverage =
        coneRadius < 1e-6
          ? offset <= radius
            ? 1
            : 0
          : circleOverlap(radius, coneRadius, offset) / (Math.PI * coneRadius * coneRadius);
    }
    const margin = inside ? radius - offset - coneRadius : -Infinity;
    return { id: route.id, along, offset, coneRadius, coverage: Math.min(1, coverage), margin };
  });

  return {
    routes: results,
    coverage: results.length ? results.reduce((sum, r) => sum + r.coverage, 0) / results.length : 0,
    margin: results.reduce((min, r) => Math.min(min, r.margin), Infinity),
  };
}

/**
 * When no position covers everything, the direction at `dist` from the
 * destination that covers the most: tries the minimax direction, each route's
 * own axis and each pair's midpoint, and polishes the best.
 */
export function bestPartialDirection(dest: Vec3, routes: Route[], radius: number, dist: number, seed: Vec3): Vec3 {
  const list = axes(dest, routes);
  const score = (u: Vec3) => {
    const e = evaluate(dest, routes, add(dest, scale(u, dist)), radius);
    // Coverage first; among equals, the direction that keeps routes closest.
    return -e.coverage + 1e-6 * worst(list, u).value;
  };

  const starts: Vec3[] = [seed, ...list.map((a) => a.dir)];
  for (let i = 0; i < list.length && starts.length < 60; i++) {
    for (let j = i + 1; j < list.length && starts.length < 60; j++) {
      starts.push(normalize(add(list[i].dir, list[j].dir)));
    }
  }

  let best = seed;
  let bestScore = Infinity;
  for (const start of starts) {
    const polished = refine(start, score, 0.02);
    const s = score(polished);
    if (s < bestScore) {
      best = polished;
      bestScore = s;
    }
  }
  return best;
}

/** A point a target may drop out at, give or take `spread`. */
export interface DropPoint {
  id: string;
  point: Vec3;
  spread: number;
}

/** Range a dampener at `p` needs to hold every drop-out point. */
function reachNeeded(points: DropPoint[], p: Vec3): number {
  let value = 0;
  for (const point of points) value = Math.max(value, length(sub(point.point, p)) + point.spread);
  return value;
}

/**
 * The smallest ball holding every drop-out point (each widened by its spread):
 * the one spot nearest to all of them, and the range needed from it. Walks
 * toward whichever point is farthest with a shrinking step, then polishes.
 */
export function enclosingBall(points: DropPoint[], iterations = 400): { centre: Vec3; radius: number } {
  if (points.length === 0) return { centre: [0, 0, 0], radius: 0 };
  let centre = scale(points.reduce<Vec3>((sum, p) => add(sum, p.point), [0, 0, 0]), 1 / points.length);
  for (let k = 1; k <= iterations; k++) {
    let far = points[0];
    let farValue = -Infinity;
    for (const point of points) {
      const d = length(sub(point.point, centre)) + point.spread;
      if (d > farValue) {
        farValue = d;
        far = point;
      }
    }
    centre = add(centre, scale(sub(far.point, centre), 1 / (k + 1)));
  }

  let radius = reachNeeded(points, centre);
  const axes: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let step = radius * 0.1; step > 0.01; ) {
    let improved = false;
    for (const axis of axes) {
      const candidate = add(centre, scale(axis, step));
      const r = reachNeeded(points, candidate);
      if (r < radius) {
        centre = candidate;
        radius = r;
        improved = true;
      }
    }
    if (!improved) step /= 2;
  }
  return { centre, radius };
}

/**
 * Where to hold a quantum dampener.
 *
 * A dampener pulls nothing out of quantum; it stops ships within its range
 * from spooling. So the useful place is where targets end their jump: each
 * route drops out at one point on the destination's arrival sphere, and the
 * dampener holds a target if that point is within range.
 *
 * Returns the point whose farthest drop-out point is nearest (the centre of
 * their smallest enclosing ball) when one position holds them all, and
 * otherwise the candidate that holds the most.
 */
export function dampenPosition(points: DropPoint[], range: number): Vec3 {
  if (points.length === 0) return [0, 0, 0];
  const { centre, radius } = enclosingBall(points);
  if (radius <= range) return centre;
  const farthest = (p: Vec3) => ({ value: reachNeeded(points, p) });

  // No one spot holds them all: take the candidate that holds the most.
  const candidates: Vec3[] = [centre, ...points.map((p) => p.point)];
  for (let i = 0; i < points.length && candidates.length < 400; i++) {
    for (let j = i + 1; j < points.length && candidates.length < 400; j++) {
      if (length(sub(points[i].point, points[j].point)) <= 2 * range) {
        candidates.push(scale(add(points[i].point, points[j].point), 0.5));
      }
    }
  }
  let best = centre;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const e = evaluateDampen(points, candidate, range);
    const score = e.coverage - 1e-9 * farthest(candidate).value;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** How many drop-out points a dampener of `range` at `position` holds. */
export function evaluateDampen(points: DropPoint[], position: Vec3, range: number): Evaluation {
  const results: RouteCoverage[] = points.map((p) => {
    const offset = length(sub(p.point, position));
    const coverage =
      p.spread < 1e-6
        ? offset <= range
          ? 1
          : 0
        : Math.min(1, circleOverlap(range, p.spread, offset) / (Math.PI * p.spread * p.spread));
    return { id: p.id, along: 0, offset, coneRadius: p.spread, coverage, margin: range - offset - p.spread };
  });
  return {
    routes: results,
    coverage: results.length ? results.reduce((sum, r) => sum + r.coverage, 0) / results.length : 0,
    margin: results.reduce((min, r) => Math.min(min, r.margin), Infinity),
  };
}
