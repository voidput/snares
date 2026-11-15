import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { MARKER_ARRIVAL, markerRadius, markersOf, withMarkers } from "./markers";
import { approaches, bestCatches, scanTargets, solvePlan } from "./plan";
import { findPath, obstructions } from "./routing";
import type { Universe } from "./types";
import { distance } from "./vec";

const universe = JSON.parse(fs.readFileSync(new URL("../../public/data/universe.json", import.meta.url), "utf-8")) as Universe;
const stanton = universe.systems.find((s) => s.name === "Stanton")!;
const bodies = withMarkers(stanton.bodies);
const named = (name: string) => bodies.find((b) => b.name === name)!;
const base = { bodies, spread: "auto" as const, drift: 50_000, radius: 20_000, placement: 0.5 };

describe("orbital markers", () => {
  it("puts six round every star, planet and moon and nothing else", () => {
    const solid = stanton.bodies.filter((b) => b.kind === "star" || b.kind === "planet" || b.kind === "moon");
    expect(bodies.filter((b) => b.kind === "marker")).toHaveLength(solid.length * 6);
    expect(markersOf(named("Port Tressler"))).toEqual([]);
    expect(withMarkers(bodies)).toBe(bodies);
  });

  it("matches the distances measured in game", () => {
    // Community-measured OM radii, metres.
    expect(markerRadius(named("Daymar"))).toBeCloseTo(430_027, -1);
    expect(markerRadius(named("Yela"))).toBeCloseTo(455_483, -1);
    expect(markerRadius(named("microTech"))).toBeCloseTo(1_439_593, -1);
  });

  it("names them, poles first, and keeps a star's off the pickers", () => {
    const daymar = named("Daymar");
    const [om1, om2, om3] = markersOf(daymar);
    expect(om1).toMatchObject({ name: "Daymar OM-1", kind: "marker", parent: daymar.id, arrival: MARKER_ARRIVAL });
    expect(om1.pos[2] - daymar.pos[2]).toBeCloseTo(markerRadius(daymar), 3);
    expect(om2.pos[2] - daymar.pos[2]).toBeCloseTo(-markerRadius(daymar), 3);
    expect(om3.pos[1] - daymar.pos[1]).toBeCloseTo(markerRadius(daymar), 3);
    expect(om1.hidden).toBeUndefined();
    expect(markersOf(stanton.bodies.find((b) => b.kind === "star")!).every((m) => m.hidden)).toBe(true);
  });

  it("stays out of the scout's targets and candidates", () => {
    expect(scanTargets(bodies).some((b) => b.kind === "marker")).toBe(false);
    const groups = bestCatches(bodies, named("Port Tressler"), { radius: 20_000, spread: "auto" });
    expect(groups.flatMap((g) => g.originIds).some((id) => id.includes("_OM"))).toBe(false);
  });
});

describe("findPath", () => {
  it("is empty for a clear line", () => {
    expect(findPath(named("Hurston").pos, named("HUR L1").pos, bodies, new Set())).toEqual([]);
  });

  it("goes round a planet by one of its markers", () => {
    const from = named("Comm Array ST4-22");
    const to = named("Port Tressler");
    expect(obstructions(from.pos, to.pos, bodies, new Set()).map((b) => b.name)).toEqual(["microTech"]);
    const path = findPath(from.pos, to.pos, bodies, new Set([to.id]))!;
    expect(path).toHaveLength(1);
    expect(path[0].parent).toBe(named("microTech").id);
    expect(obstructions(from.pos, path[0].pos, bodies, new Set())).toEqual([]);
    expect(obstructions(path[0].pos, to.pos, bodies, new Set())).toEqual([]);
  });

  it("goes round the star by its route-only points", () => {
    const path = findPath(named("Hurston").pos, named("HUR L3").pos, bodies, new Set())!;
    expect(path.length).toBeGreaterThan(0);
    expect(path.every((m) => m.parent === stanton.bodies.find((b) => b.kind === "star")!.id)).toBe(true);
  });

  it("finds a way for every blocked pair in every system", () => {
    for (const system of universe.systems) {
      const all = withMarkers(system.bodies);
      const places = system.bodies.filter((b) => !["star", "asteroid", "surface", "city"].includes(b.kind) && !b.hidden && !b.on);
      for (const a of places) {
        for (const b of places) {
          if (a === b) continue;
          const path = findPath(a.pos, b.pos, all, new Set([b.id]));
          expect(path, `${system.name}: ${a.name} to ${b.name}`).toBeDefined();
          const stops = [a.pos, ...path!.map((m) => m.pos), b.pos];
          for (let i = 1; i < stops.length; i++) expect(obstructions(stops[i - 1], stops[i], all, new Set([b.id]))).toEqual([]);
        }
      }
    }
  });

  it("gives up without markers to go by", () => {
    expect(findPath(named("Comm Array ST4-22").pos, named("Port Tressler").pos, stanton.bodies, new Set())).toBeUndefined();
  });
});

describe("plotted routes", () => {
  const blockedOrigin = named("Comm Array ST4-22");
  const dest = named("Port Tressler");

  it("restarts a blocked route from the marker it stops at", () => {
    const [leg] = solvePlan({ ...base, originIds: [blockedOrigin.id, named("Crusader").id], destIds: [dest.id] });
    const [rerouted, direct] = leg.routes;
    expect(rerouted.id).toBe(blockedOrigin.id);
    expect(rerouted.via).toHaveLength(1);
    expect(rerouted.origin).toEqual(rerouted.via![0].pos);
    expect(rerouted.from).toEqual(blockedOrigin.pos);
    expect(rerouted.spread).toBe(base.drift);
    expect(rerouted.label).toBe(`${blockedOrigin.name} › ${rerouted.via![0].name}`);
    expect(direct.via).toBeUndefined();
    expect(direct.origin).toEqual(named("Crusader").pos);
    expect(leg.blocked).toEqual([]);
  });

  it("still flags the route as blocked when there are no markers", () => {
    const [leg] = solvePlan({ ...base, bodies: stanton.bodies, originIds: [blockedOrigin.id], destIds: [dest.id] });
    expect(leg.routes[0].via).toBeUndefined();
    expect(leg.blocked.map((b) => b.by.name)).toEqual(["microTech"]);
  });

  it("lets the scout count the places that come in round a body", () => {
    const withRoutes = bestCatches(bodies, dest, { radius: 20_000, spread: "auto" });
    const without = bestCatches(stanton.bodies, dest, { radius: 20_000, spread: "auto" });
    const count = (groups: typeof withRoutes) => new Set(groups.flatMap((g) => g.originIds)).size;
    expect(count(withRoutes)).toBeGreaterThan(count(without));
  });

  it("plans the hop to the marker as a leg of its own", () => {
    const [first] = solvePlan({ ...base, originIds: [blockedOrigin.id], destIds: [dest.id] });
    const stop = first.routes[0].via![0];
    const [hop] = solvePlan({ ...base, originIds: [blockedOrigin.id], destIds: [stop.id] });
    expect(hop.dest.kind).toBe("marker");
    expect(hop.blocked).toEqual([]);
    expect(hop.routes[0].via).toBeUndefined();
  });

  it("offers markers as lines to fly to a spot", () => {
    const daymar = named("Daymar");
    const om = named("Daymar OM-1");
    const crusader = named("Crusader").pos;
    const mid = [(om.pos[0] + crusader[0]) / 2, (om.pos[1] + crusader[1]) / 2, (om.pos[2] + crusader[2]) / 2] as const;
    const found = approaches(mid, bodies, { limit: 40 });
    expect(found.some((a) => a.from.kind === "marker" || a.to.kind === "marker")).toBe(true);
    expect(distance(om.pos, daymar.pos)).toBeCloseTo(markerRadius(daymar), 3);
  });
});
