/**
 * Several ships on one leg.
 *
 * The lead ship is the one the plan was solved for. Others join in one of three roles:
 * - "split": another net. When no one spot covers every route, the routes are divided
 *   between the lead and the split ships, each taking a group it can cover in full.
 * - "hold": a dampener partner. It sits where the targets a snare pulls out come to rest
 *   and stops them spooling again.
 * - "backstop": a second net on the same routes, behind another ship and nearer the
 *   destination, for whatever gets past while the first is down or recharging.
 *
 * Every ship ends up with a `Leg` of its own, so anything that reads a leg (the position
 * facts, the approach lines, the position check, the map) works for any ship in the fleet.
 */

import { effectiveArrival, jammedAt, monitoredAt, nearestArmistice, solveLeg, type Leg } from "./plan";
import { corridor, dampenPosition, evaluate, evaluateDampen, type DropPoint, type Route } from "./solver";
import type { Body } from "./types";
import { add, distance, dot, normalize, scale, sub } from "./vec";

export type Role = "split" | "hold" | "backstop";

/** What a ship carries: snare radius and dampener range, metres. */
export interface Device {
  name: string;
  radius: number;
  dampen: number;
}

export interface FleetMember {
  role: Role;
  device: Device;
}

export interface FleetShip {
  role: "lead" | Role;
  device: Device;
  leg: Leg;
  /** Index of the ship this one backs up or holds for. */
  supports?: number;
  /** Has nothing to do in this plan, and is left off the map. */
  idle?: boolean;
  /** Why the ship is idle, or what is off about its spot. */
  note?: string;
}

export interface FleetPlan {
  ships: FleetShip[];
  /** Best coverage of each route by any net in the fleet. */
  routes: { id: string; label: string; coverage: number; by?: number }[];
  /** Mean of those, 0..1. */
  coverage: number;
}

export interface FleetContext {
  bodies: Body[];
  placement: number;
  standoff: number;
}

/** Clear space kept between two nets on one line, metres. */
const BACKSTOP_GAP = 2_000;

/**
 * Where a snare brings each route's targets to rest: the point the route's line first meets
 * the snare sphere, coming from the origin. A route whose line misses the sphere has none.
 * This assumes a pulled ship stops where it enters the sphere; the game may carry it on a
 * little, which only brings it nearer the snare's centre.
 */
export function entryPoints(leg: Leg): DropPoint[] {
  const points: DropPoint[] = [];
  for (const route of leg.routes) {
    const total = distance(route.origin, leg.dest.pos);
    if (total === 0) continue;
    const dir = normalize(sub(leg.dest.pos, route.origin));
    const m = sub(route.origin, leg.snare);
    const b = dot(m, dir);
    const disc = b * b - (dot(m, m) - leg.reach * leg.reach);
    if (disc < 0) continue;
    const s = -b - Math.sqrt(disc);
    if (s < 0 || s > total) continue;
    points.push({ id: route.id, point: add(route.origin, scale(dir, s)), spread: (route.spread * (total - s)) / total });
  }
  return points;
}

/**
 * How much of what a snare pulls out its own dampener then holds. A ship sits at the centre
 * of its snare sphere and targets stop at its edge, so a dampener shorter than the snare
 * leaves a gap to close before they spool again.
 */
export function ownHold(leg: Leg, dampen: number): { held: number; gap: number } {
  const entries = entryPoints(leg);
  return {
    held: entries.length > 0 ? evaluateDampen(entries, leg.snare, dampen).coverage : 0,
    gap: Math.max(0, leg.reach - dampen),
  };
}

/** The largest group of `routes` that `fits` together, grown from each route in turn. */
function largestGroup(routes: Route[], dest: Body, fits: (group: Route[]) => boolean): Route[] {
  const dirs = new Map(routes.map((r) => [r.id, normalize(sub(r.origin, dest.pos))]));
  let best: Route[] = [];
  for (const seed of routes) {
    if (!fits([seed])) continue;
    const seedDir = dirs.get(seed.id)!;
    // Nearest in direction first: those are the ones one spot can take together.
    const rest = routes.filter((r) => r !== seed).sort((a, b) => dot(dirs.get(b.id)!, seedDir) - dot(dirs.get(a.id)!, seedDir));
    const group = [seed];
    for (const next of rest) {
      if (fits([...group, next])) group.push(next);
    }
    if (group.length > best.length) best = group;
  }
  return best;
}

function reSolve(base: Leg, routes: Route[], device: Device, ctx: FleetContext, placement = ctx.placement): Leg {
  const leg = solveLeg(base.index, base.dest, routes, ctx.bodies, device.radius, placement, new Set(), base.mode, device.dampen, ctx.standoff);
  // The base leg already knows which bodies stand in a route's way.
  const ids = new Set(routes.map((r) => r.id));
  return { ...leg, blocked: base.blocked.filter((b) => ids.has(b.routeId)) };
}

/** A dampener placed on the points a snare leaves its targets at. */
function holdLeg(net: Leg, device: Device, bodies: Body[]): Leg | undefined {
  const entries = entryPoints(net);
  if (entries.length === 0) return undefined;
  const position = dampenPosition(entries, device.dampen);
  const evaluation = evaluateDampen(entries, position, device.dampen);
  const dist = distance(position, net.dest.pos);
  const direction = normalize(sub(position, net.dest.pos));
  const held = new Set(entries.map((e) => e.id));
  return {
    index: net.index,
    mode: "dampen",
    reach: device.dampen,
    drops: entries,
    dest: net.dest,
    routes: net.routes.filter((r) => held.has(r.id)),
    corridor: { direction, phi: 0, minDistance: dist, maxDistance: dist, feasible: evaluation.margin >= 0 },
    distance: dist,
    direction,
    snare: position,
    evaluation,
    blocked: [],
    security: { monitoredBy: monitoredAt(position, bodies), jammedBy: jammedAt(position, bodies), armistice: nearestArmistice(position, 0, bodies) },
  };
}

export function planFleet(base: Leg, lead: Device, members: FleetMember[], ctx: FleetContext): FleetPlan {
  const dampening = base.mode === "dampen";
  const arrival = effectiveArrival(base.dest, ctx.standoff);
  const fits = (device: Device) => (group: Route[]) => {
    if (dampening) {
      const ids = new Set(group.map((r) => r.id));
      const drops = base.drops.filter((d) => ids.has(d.id));
      return evaluateDampen(drops, dampenPosition(drops, device.dampen), device.dampen).margin >= 0;
    }
    return corridor(base.dest.pos, group, { radius: device.radius, arrival }).feasible;
  };

  // Ships keep the order they were added in: the lead, then member 1 as ship 2, and so on.
  const ships: (FleetShip | undefined)[] = [{ role: "lead", device: lead, leg: base }, ...members.map(() => undefined)];
  const lead0 = ships[0]!;
  // Dampening has one job, holding arrivals, so every extra ship is another dampener.
  const nets = members.map((m, i) => ({ m, slot: i + 1 })).filter(({ m }) => dampening || m.role === "split");

  if (nets.length > 0 && base.routes.length > 0) {
    if (base.corridor.feasible) {
      for (const { m, slot } of nets) ships[slot] = { role: m.role, device: m.device, leg: base, idle: true, note: "One ship already covers every route." };
    } else {
      let remaining = base.routes;
      const groups: Route[][] = [];
      for (const device of [lead, ...nets.map(({ m }) => m.device)]) {
        const group = largestGroup(remaining, base.dest, fits(device));
        groups.push(group);
        remaining = remaining.filter((r) => !group.includes(r));
      }
      // A lead that can take nothing in full keeps the whole plan, as it would alone.
      if (groups[0].length > 0) lead0.leg = reSolve(base, groups[0], lead, ctx);
      nets.forEach(({ m, slot }, i) => {
        const group = groups[i + 1];
        ships[slot] =
          group.length === 0
            ? { role: m.role, device: m.device, leg: base, idle: true, note: "No route left that this ship can cover in full." }
            : { role: m.role, device: m.device, leg: reSolve(base, group, m.device, ctx) };
      });
    }
  } else {
    for (const { m, slot } of nets) ships[slot] = { role: m.role, device: m.device, leg: base, idle: true, note: "No routes to cover yet." };
  }

  const coverers = ships.map((s, i) => ({ s, i })).filter((x): x is { s: FleetShip; i: number } => !!x.s && !x.s.idle);

  if (!dampening) {
    // Backstops line up behind a net, each a snare's width nearer the destination.
    const last = new Map<number, Leg>();
    members
      .map((m, i) => ({ m, slot: i + 1 }))
      .filter(({ m }) => m.role === "backstop")
      .forEach(({ m, slot }, n) => {
        const target = coverers[n % coverers.length];
        const routes = target.s.leg.routes;
        const probe = reSolve(base, routes, m.device, ctx, 0);
        if (routes.length === 0 || !probe.corridor.feasible) {
          ships[slot] = {
            role: "backstop",
            device: m.device,
            leg: probe,
            supports: target.i,
            idle: routes.length === 0,
            note: routes.length === 0 ? "Nothing to back up yet." : "Its snare is too small to cover these routes in full.",
          };
          return;
        }
        const ahead = last.get(target.i) ?? target.s.leg;
        const c = probe.corridor;
        const wanted = ahead.distance - (ahead.reach + m.device.radius + BACKSTOP_GAP);
        const dist = Math.min(c.maxDistance, Math.max(c.minDistance, wanted));
        const t = c.maxDistance > c.minDistance ? Math.log(dist / c.minDistance) / Math.log(c.maxDistance / c.minDistance) : 0;
        const leg = reSolve(base, routes, m.device, ctx, t);
        last.set(target.i, leg);
        ships[slot] = {
          role: "backstop",
          device: m.device,
          leg,
          supports: target.i,
          note: wanted < c.minDistance ? "No room behind the ship ahead: the two nets overlap. Move that ship farther out." : undefined,
        };
      });

    // Holders pair off with the nets, a dampener on each net's catch.
    members
      .map((m, i) => ({ m, slot: i + 1 }))
      .filter(({ m }) => m.role === "hold")
      .forEach(({ m, slot }, n) => {
        const target = coverers[n % coverers.length];
        const leg = holdLeg(target.s.leg, m.device, ctx.bodies);
        ships[slot] = leg
          ? { role: "hold", device: m.device, leg, supports: target.i }
          : { role: "hold", device: m.device, leg: target.s.leg, supports: target.i, idle: true, note: "The net it pairs with catches nothing to hold." };
      });
  }

  const placed = ships.filter((s): s is FleetShip => !!s);

  // What the fleet's nets catch between them: each route counts its best net.
  const routes = base.routes.map((route) => {
    let coverage = 0;
    let by: number | undefined;
    placed.forEach((ship, i) => {
      if (ship.idle || ship.role === "hold") return;
      const value = dampening
        ? evaluateDampen(base.drops.filter((d) => d.id === route.id), ship.leg.snare, ship.leg.reach).coverage
        : evaluate(base.dest.pos, [route], ship.leg.snare, ship.leg.reach).coverage;
      if (value > coverage) {
        coverage = value;
        by = i;
      }
    });
    return { id: route.id, label: route.label, coverage, by };
  });

  return { ships: placed, routes, coverage: routes.length ? routes.reduce((sum, r) => sum + r.coverage, 0) / routes.length : 0 };
}
