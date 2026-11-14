import { describe, expect, it } from "vitest";
import { entryPoints, ownHold, planFleet, type Device } from "./fleet";
import { solvePlan } from "./plan";
import type { Body } from "./types";
import { distance } from "./vec";

const GM = 1e9;
const body = (id: string, pos: [number, number, number], extra: Partial<Body> = {}): Body => ({ id, name: id, kind: "station", pos, arrival: 20_000, ...extra }) as Body;

const dest = body("dest", [0, 0, 0]);
// Two origins close together in direction, one far off to the side.
const near1 = body("near1", [10 * GM, 0, 0]);
const near2 = body("near2", [10 * GM, 2000, 0]);
const far = body("far", [0, 10 * GM, 0]);
const bodies = [dest, near1, near2, far];

const mantis: Device = { name: "Mantis", radius: 20_000, dampen: 12_000 };
const ctx = { bodies, placement: 0.5, standoff: 0 };
const solve = (originIds: string[], mode: "snare" | "dampen" = "snare") =>
  solvePlan({ bodies, originIds, destIds: ["dest"], spread: "exact", drift: 0, radius: mantis.radius, placement: 0.5, mode, dampenRange: mantis.dampen })[0];

describe("planFleet", () => {
  it("leaves a lone lead exactly as solved", () => {
    const base = solve(["near1", "near2", "far"]);
    const plan = planFleet(base, mantis, [], ctx);
    expect(plan.ships).toHaveLength(1);
    expect(plan.ships[0].leg).toBe(base);
  });

  it("splits routes one spot cannot cover between two ships", () => {
    const base = solve(["near1", "near2", "far"]);
    expect(base.corridor.feasible).toBe(false);
    const plan = planFleet(base, mantis, [{ role: "split", device: mantis }], ctx);
    const [lead, second] = plan.ships;
    expect(lead.leg.routes.map((r) => r.id).sort()).toEqual(["near1", "near2"]);
    expect(second.leg.routes.map((r) => r.id)).toEqual(["far"]);
    expect(lead.leg.corridor.feasible && second.leg.corridor.feasible).toBe(true);
    expect(plan.coverage).toBeCloseTo(1, 6);
    expect(plan.routes.map((r) => r.by)).toEqual([0, 0, 1]);
  });

  it("stands a split ship down when one ship covers everything", () => {
    const base = solve(["near1", "near2"]);
    const plan = planFleet(base, mantis, [{ role: "split", device: mantis }], ctx);
    expect(plan.ships[1].idle).toBe(true);
    expect(plan.ships[0].leg).toBe(base);
  });

  it("puts a holder on the points the snare leaves its targets at", () => {
    const base = solve(["near1", "near2"]);
    const plan = planFleet(base, mantis, [{ role: "hold", device: mantis }], ctx);
    const hold = plan.ships[1];
    expect(hold.role).toBe("hold");
    expect(hold.supports).toBe(0);
    expect(hold.leg.mode).toBe("dampen");
    expect(hold.leg.evaluation.coverage).toBeCloseTo(1, 6);
    // On the origin side of the snare, about a snare radius out from its centre.
    expect(distance(hold.leg.snare, base.snare)).toBeGreaterThan(mantis.radius * 0.9);
    expect(hold.leg.distance).toBeGreaterThan(base.distance);
  });

  it("lines a backstop up behind the lead without overlapping it", () => {
    const base = solvePlan({ bodies, originIds: ["near1", "near2"], destIds: ["dest"], spread: "exact", drift: 0, radius: mantis.radius, placement: 1 })[0];
    const plan = planFleet(base, mantis, [{ role: "backstop", device: mantis }], { ...ctx, placement: 1 });
    const back = plan.ships[1];
    expect(back.supports).toBe(0);
    expect(back.leg.corridor.feasible).toBe(true);
    expect(back.leg.evaluation.coverage).toBeCloseTo(1, 6);
    expect(base.distance - back.leg.distance).toBeGreaterThanOrEqual(2 * mantis.radius);
    expect(back.note).toBeUndefined();
  });

  it("says so when there is no room for a backstop", () => {
    const base = solvePlan({ bodies, originIds: ["near1", "near2"], destIds: ["dest"], spread: "exact", drift: 0, radius: mantis.radius, placement: 0 })[0];
    const plan = planFleet(base, mantis, [{ role: "backstop", device: mantis }], { ...ctx, placement: 0 });
    expect(plan.ships[1].note).toMatch(/No room/);
  });

  it("uses every extra ship as a dampener when dampening", () => {
    const base = solve(["near1", "far"], "dampen");
    expect(base.corridor.feasible).toBe(false);
    const plan = planFleet(base, mantis, [{ role: "backstop", device: mantis }], ctx);
    expect(plan.ships[1].idle).toBeUndefined();
    expect(plan.coverage).toBeCloseTo(1, 6);
  });
});

describe("ship order", () => {
  it("keeps ships in the order they were added", () => {
    const base = solve(["near1", "near2", "far"]);
    const plan = planFleet(base, mantis, [{ role: "hold", device: mantis }, { role: "backstop", device: mantis }, { role: "split", device: mantis }], ctx);
    expect(plan.ships.map((s) => s.role)).toEqual(["lead", "hold", "backstop", "split"]);
    expect(plan.ships[1].supports).toBe(0);
  });
});

describe("own dampener", () => {
  it("finds entry points on the snare sphere", () => {
    const base = solve(["near1", "near2"]);
    const entries = entryPoints(base);
    expect(entries).toHaveLength(2);
    for (const e of entries) expect(distance(e.point, base.snare)).toBeCloseTo(mantis.radius, 0);
  });

  it("reports the gap between snare edge and dampener", () => {
    const base = solve(["near1", "near2"]);
    expect(ownHold(base, 12_000)).toEqual({ held: 0, gap: 8_000 });
    expect(ownHold(base, 25_000)).toEqual({ held: 1, gap: 0 });
  });
});
