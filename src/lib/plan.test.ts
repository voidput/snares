import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { timeToReach, travelTime, speedAt } from "./kinematics";
import {
  anchorWeights,
  approaches,
  bestCatches,
  effectiveArrival,
  monitoredAt,
  nearestArmistice,
  obstructions,
  scanTargets,
  solvePlan,
  spreadOf,
  weightOf,
} from "./plan";
import { decodeState, DEFAULT_STATE, encodeState } from "./share";
import { parseShowLocation } from "./showlocation";
import type { Body, QuantumDrive, Universe } from "./types";
import { distance } from "./vec";

const universe = JSON.parse(fs.readFileSync(new URL("../../public/data/universe.json", import.meta.url), "utf-8")) as Universe;
const stanton = universe.systems.find((s) => s.name === "Stanton")!;
const named = (name: string) => stanton.bodies.find((b) => b.name === name)!;
const base = { bodies: stanton.bodies, spread: "auto" as const, drift: 50_000, radius: 20_000, placement: 0.5 };

describe("baked data", () => {
  it("places the Stanton planets where the game does", () => {
    expect(named("Hurston").pos[0]).toBeCloseTo(12_850_457_093, -3);
    expect(distance(named("Crusader").pos, [0, 0, 0]) / 1e9).toBeCloseTo(19.15, 1);
    expect(named("Hurston").arrival).toBe(1_050_000);
  });

  it("has the three systems, a snare and drives", () => {
    expect(universe.systems.map((s) => s.name).sort()).toEqual(["Nyx", "Pyro", "Stanton"]);
    expect(universe.interdictors[0]).toMatchObject({ name: "RSI Mantis", snareRadius: 20000, dampenRange: 12000 });
    // Every other interdictor in the game is a dampener with no snare.
    expect(universe.interdictors.length).toBeGreaterThan(3);
    expect(universe.interdictors.slice(1).every((i) => i.snareRadius === 0 && i.dampenRange > 0)).toBe(true);
    expect(universe.drives.length).toBeGreaterThan(20);
  });
});

describe("solvePlan", () => {
  it("covers a real three-origin route in full", () => {
    const [leg] = solvePlan({
      ...base,
      originIds: [named("Hurston").id, named("Crusader").id, named("microTech").id],
      destIds: [named("ARC L1").id],
    });
    expect(leg.routes).toHaveLength(3);
    expect(leg.corridor.feasible).toBe(true);
    expect(leg.evaluation.coverage).toBe(1);
    expect(leg.evaluation.margin).toBeGreaterThan(0);
    expect(leg.distance).toBeGreaterThan(leg.corridor.minDistance);
    expect(leg.distance).toBeLessThan(leg.corridor.maxDistance);
    expect(distance(leg.snare, leg.dest.pos)).toBeCloseTo(leg.distance, 0);
  });

  it("falls back to the best partial cover when routes come from opposite sides", () => {
    const [leg] = solvePlan({
      ...base,
      originIds: [named("Hurston").id, named("microTech").id, named("ARC L1").id],
      destIds: [named("ArcCorp").id],
    });
    expect(leg.corridor.feasible).toBe(false);
    expect(leg.evaluation.coverage).toBeGreaterThan(0);
    expect(leg.evaluation.coverage).toBeLessThan(1);
  });

  it("drops an origin that is also the destination", () => {
    const [leg] = solvePlan({ ...base, originIds: [named("Hurston").id, named("ArcCorp").id], destIds: [named("ArcCorp").id] });
    expect(leg.routes.map((r) => r.label)).toEqual(["Hurston"]);
  });

  it("starts a route change leg from the previous arrival sphere", () => {
    const legs = solvePlan({ ...base, originIds: [named("Hurston").id], destIds: [named("CRU L1").id, named("Crusader").id] });
    expect(legs).toHaveLength(2);
    const second = legs[1].routes[0];
    expect(distance(second.origin, named("CRU L1").pos)).toBeCloseTo(named("CRU L1").arrival ?? 20000, 0);
    expect(second.spread).toBe(50_000);
    // The drop-out point is on Hurston's side of the waypoint.
    expect(distance(second.origin, named("Hurston").pos)).toBeLessThan(distance(named("CRU L1").pos, named("Hurston").pos));
  });

  it("treats a city as the planet it is on", () => {
    const lorville = named("Lorville");
    expect(lorville).toMatchObject({ kind: "city", on: named("Hurston").id, pos: named("Hurston").pos });
    expect(spreadOf(lorville, "auto")).toBe(1_050_000);

    const dest = named("ARC-L1 Wide Forest Station").id;
    const [city] = solvePlan({ ...base, originIds: [lorville.id], destIds: [dest] });
    const [planet] = solvePlan({ ...base, originIds: [named("Hurston").id], destIds: [dest] });
    expect(city.snare).toEqual(planet.snare);
    expect(city.blocked).toEqual([]);

    // The city and its own planet are one route; a city on the destination's body is none.
    const [both] = solvePlan({ ...base, originIds: [lorville.id, named("Hurston").id], destIds: [dest] });
    expect(both.routes.map((r) => r.label)).toEqual(["Lorville"]);
    const [toCity] = solvePlan({ ...base, originIds: [named("Hurston").id, named("Crusader").id], destIds: [lorville.id] });
    expect(toCity.routes.map((r) => r.label)).toEqual(["Crusader"]);
    expect(toCity.corridor.minDistance).toBe(1_050_000 + 20_000);
  });

  it("returns nothing without both ends", () => {
    expect(solvePlan({ ...base, originIds: [], destIds: [named("ArcCorp").id] })).toEqual([]);
    expect(solvePlan({ ...base, originIds: [named("Hurston").id], destIds: [] })).toEqual([]);
  });
});

describe("spread and obstruction", () => {
  it("spreads a planet by its arrival radius and a station by a little", () => {
    expect(spreadOf(named("Hurston"), "auto")).toBe(1_050_000);
    expect(spreadOf(named("Everus Harbor"), "auto")).toBe(10_000);
    expect(spreadOf(named("Hurston"), "exact")).toBe(0);
    expect(spreadOf(named("Hurston"), 5000)).toBe(5000);
  });

  it("flags a line through the star and not one beside it", () => {
    const star = stanton.bodies.find((b) => b.kind === "star")!;
    const through = obstructions(named("Hurston").pos, named("HUR L3").pos, stanton.bodies, new Set());
    expect(through.map((b) => b.id)).toContain(star.id);
    expect(obstructions(named("Hurston").pos, named("HUR L1").pos, stanton.bodies, new Set())).toEqual([]);
  });
});

describe("approaches", () => {
  it("finds the route a point lies on", () => {
    const a = named("Hurston");
    const b = named("ARC-L1 Wide Forest Station");
    const mid = a.pos.map((v, i) => v + (b.pos[i] - v) * 0.9) as unknown as Body["pos"];
    const [best] = approaches(mid, stanton.bodies, { limit: 3 });
    expect(best.miss).toBeLessThan(1000);
    expect(best.remaining).toBeGreaterThan(0);
  });

  it("only offers markers a pilot can select, unless the start is given", () => {
    const target = named("ARC-L1 Wide Forest Station").pos.map((v, i) => v + (i === 0 ? 5e7 : 0)) as unknown as Body["pos"];
    for (const a of approaches(target, stanton.bodies, { limit: 8 })) {
      expect(a.from.hidden || a.to.hidden).toBeFalsy();
      expect([a.from.kind, a.to.kind]).not.toContain("asteroid");
    }
    const hidden = named("ARC L2");
    const fromHidden = approaches(target, stanton.bodies, { from: hidden, limit: 3 });
    expect(fromHidden.every((a) => a.from.id === hidden.id)).toBe(true);
  });
});

describe("dampen mode", () => {
  const dampen = { ...base, mode: "dampen" as const, dampenRange: 4000 };

  it("sits on the drop-out point of a single route", () => {
    const dest = named("ARC-L1 Wide Forest Station");
    const [leg] = solvePlan({ ...dampen, spread: "exact", originIds: [named("Hurston").id], destIds: [dest.id] });
    expect(leg.mode).toBe("dampen");
    expect(leg.distance).toBeCloseTo(24_000, 0);
    expect(distance(leg.snare, leg.drops[0].point)).toBeLessThan(1);
    expect(leg.evaluation.coverage).toBe(1);
    // The spot is on Hurston's side of the station.
    expect(distance(leg.snare, named("Hurston").pos)).toBeLessThan(distance(dest.pos, named("Hurston").pos));
  });

  it("holds two close drop-out points from between them, and not two far ones", () => {
    const dest = named("ARC-L1 Wide Forest Station");
    const near = solvePlan({
      ...dampen,
      spread: "exact",
      originIds: [named("Hurston").id, named("HUR-L1 Green Glade Station").id],
      destIds: [dest.id],
    })[0];
    expect(near.corridor.feasible).toBe(true);
    expect(near.evaluation.routes[0].offset).toBeCloseTo(near.evaluation.routes[1].offset, 0);

    const far = solvePlan({
      ...dampen,
      spread: "exact",
      originIds: [named("Hurston").id, named("Crusader").id, named("microTech").id],
      destIds: [dest.id],
    })[0];
    expect(far.corridor.feasible).toBe(false);
    expect(far.evaluation.coverage).toBeGreaterThan(0);
    expect(far.evaluation.coverage).toBeLessThan(1);
  });

  it("is reached by simply finishing the jump from the origin", () => {
    const dest = named("ARC-L1 Wide Forest Station");
    const [leg] = solvePlan({ ...dampen, spread: "exact", originIds: [named("Hurston").id], destIds: [dest.id] });
    const [best] = approaches(leg.snare, stanton.bodies, { from: named("Hurston"), limit: 1 });
    expect(best.to.id).toBe(dest.id);
    expect(best.miss).toBeLessThan(100);
    expect(best.remaining).toBeCloseTo(24_000, -2);
  });

  it("reaches more with a longer range", () => {
    const plan = { ...dampen, spread: "exact" as const, originIds: [named("Hurston").id, named("microTech").id], destIds: [named("ARC-L1 Wide Forest Station").id] };
    const short = solvePlan({ ...plan, dampenRange: 4000 })[0];
    const long = solvePlan({ ...plan, dampenRange: 12000 })[0];
    expect(long.evaluation.coverage).toBeGreaterThanOrEqual(short.evaluation.coverage);
    expect(long.evaluation.margin).toBeGreaterThan(short.evaluation.margin);
  });
});

describe("bestCatches", () => {
  const dest = named("ARC-L1 Wide Forest Station");
  const catches = bestCatches(stanton.bodies, dest, { radius: 20_000, spread: "auto" });

  it("returns groups a single position really covers in full, heaviest first", () => {
    expect(catches.length).toBeGreaterThan(0);
    const weights = new Map(stanton.bodies.map((b) => [b.id, b.weight ?? 1]));
    for (let i = 0; i < catches.length; i++) {
      const sum = catches[i].originIds.reduce((total, id) => total + weights.get(id)!, 0);
      expect(catches[i].score).toBeCloseTo(sum, 6);
      if (i > 0) expect(catches[i].score).toBeLessThanOrEqual(catches[i - 1].score);
    }
    for (const group of catches) {
      const [leg] = solvePlan({ ...base, originIds: group.originIds, destIds: [dest.id] });
      expect(leg.routes).toHaveLength(group.originIds.length);
      expect(leg.corridor.feasible).toBe(true);
      expect(leg.evaluation.coverage).toBe(1);
      expect(leg.blocked).toEqual([]);
    }
  });

  it("beats a hand-picked single origin and offers only real markers", () => {
    expect(catches[0].originIds.length).toBeGreaterThan(1);
    const byId = new Map(stanton.bodies.map((b) => [b.id, b]));
    for (const id of catches.flatMap((c) => c.originIds)) {
      const body = byId.get(id)!;
      expect(body.hidden || body.on || body.kind === "star").toBeFalsy();
    }
  });

  it("does not list a group that sits inside a bigger one", () => {
    for (let i = 0; i < catches.length; i++) {
      for (let j = 0; j < i; j++) {
        expect(catches[i].originIds.every((id) => catches[j].originIds.includes(id))).toBe(false);
      }
    }
  });
});

describe("bestCatches for a dampener", () => {
  const dest = named("ARC-L1 Wide Forest Station");
  const options = { radius: 20_000, spread: "auto" as const, mode: "dampen" as const, dampenRange: 12_000 };
  const holds = bestCatches(stanton.bodies, dest, options);

  it("returns groups one dampener position really holds", () => {
    expect(holds.length).toBeGreaterThan(0);
    expect(holds[0].originIds.length).toBeGreaterThan(1);
    for (const group of holds) {
      const [leg] = solvePlan({ ...base, mode: "dampen", dampenRange: 12_000, originIds: group.originIds, destIds: [dest.id] });
      expect(leg.corridor.feasible).toBe(true);
      expect(leg.evaluation.coverage).toBe(1);
      expect(group.margin).toBeGreaterThanOrEqual(0);
    }
  });

  it("holds fewer with a shorter range", () => {
    const short = bestCatches(stanton.bodies, dest, { ...options, dampenRange: 4_000 });
    expect(short[0].originIds.length).toBeLessThan(holds[0].originIds.length);
  });
});

describe("traffic weights", () => {
  it("tiers hot places over lesser ones over cold ones", () => {
    const w = (name: string) => named(name).weight!;
    // Hot: cities, refineries, full-service hubs, live gateways.
    expect(w("Hurston")).toBe(10);
    expect(w("Lorville")).toBe(10);
    expect(w("ARC-L1 Wide Forest Station")).toBe(9);
    expect(named("ARC-L1 Wide Forest Station").refinery).toBe(true);
    expect(w("Pyro Gateway")).toBe(9);
    expect(w("Everus Harbor")).toBe(8);
    expect(w("Grim HEX")).toBe(8);
    // Lesser.
    expect(w("ARC-L3 Modern Express Station")).toBe(4);
    expect(w("Daymar")).toBe(2);
    // Cold: a refinery does not rescue a gateway to nowhere.
    expect(named("Terra Gateway")).toMatchObject({ deadEnd: true, refinery: true, weight: 0.5 });
    expect(w("Stanton - Magnus Jump Point")).toBe(0.5);
    expect(w("Comm Array ST1-02")).toBe(0.25);
    expect(stanton.bodies.find((b) => b.kind === "asteroid")!.weight).toBe(0.25);
    expect(named("Nyx Gateway").deadEnd).toBeUndefined();

    // A planet with no city is not a hub.
    const pyro = universe.systems.find((s) => s.name === "Pyro")!;
    expect(pyro.bodies.find((b) => b.kind === "planet")!.weight).toBe(3);
    expect(pyro.bodies.find((b) => b.name === "Checkmate")!.weight).toBe(9);
  });

  it("ranks a few hubs over many comm arrays", () => {
    const [top] = bestCatches(stanton.bodies, named("ARC-L1 Wide Forest Station"), { radius: 20_000, spread: "auto" });
    const kinds = new Map(stanton.bodies.map((b) => [b.id, b]));
    expect(top.originIds.some((id) => (kinds.get(id)!.weight ?? 0) >= 6)).toBe(true);
  });
});

describe("armistice and monitored zones", () => {
  const station = named("ARC-L1 Wide Forest Station");
  const pyro = universe.systems.find((s) => s.name === "Pyro")!;

  it("come from the game files", () => {
    expect(station.armistice).toBe(12_000);
    expect(station.monitored).toBe(50_000_000);
    expect(named("Comm Array ST1-02").monitored).toBe(50_000_000);
    expect(named("Comm Array ST1-02").armistice).toBeUndefined();
    // Grim HEX keeps the peace in its own space and reports to no one.
    expect(named("Grim HEX").armistice).toBe(12_000);
    expect(named("Grim HEX").monitored).toBeUndefined();
    // A planet's surface zones are not zones in space.
    expect(named("Hurston").armistice).toBeUndefined();
    // Pyro's stations have neither.
    expect(pyro.bodies.find((b) => b.name === "Checkmate")).toMatchObject({ kind: "station" });
    expect(pyro.bodies.find((b) => b.name === "Checkmate")!.armistice).toBeUndefined();
  });

  it("push the snare out so its sphere clears the armistice zone by the stand-off", () => {
    const plan = { ...base, placement: 0, originIds: [named("Hurston").id], destIds: [station.id] };
    const [close] = solvePlan({ ...plan, standoff: 0 });
    const [clear] = solvePlan({ ...plan, standoff: 60_000 });
    // No stand-off: the arrival radius (24 km) already clears the 12 km zone.
    expect(close.distance).toBeCloseTo(44_000, 0);
    expect(close.security.armistice).toMatchObject({ body: station });
    expect(close.security.armistice!.gap).toBeCloseTo(44_000 - 12_000 - 20_000, 0);
    expect(clear.distance).toBeCloseTo(12_000 + 60_000 + 20_000, 0);
    expect(clear.security.armistice!.gap).toBeCloseTo(60_000, 0);
    expect(effectiveArrival(station, 60_000)).toBe(72_000);
    expect(effectiveArrival(named("Hurston"), 60_000)).toBe(1_050_000);
  });

  it("report who is watching a position, or that nobody is", () => {
    const [leg] = solvePlan({ ...base, originIds: [named("Hurston").id], destIds: [station.id] });
    expect(leg.security.monitoredBy.map((b) => b.id)).toContain(station.id);
    expect(monitoredAt(named("Everus Harbor").pos, stanton.bodies).length).toBeGreaterThan(1);

    const checkmate = pyro.bodies.find((b) => b.name === "Checkmate")!;
    const origin = pyro.bodies.find((b) => b.kind === "planet")!;
    const [dark] = solvePlan({ ...base, bodies: pyro.bodies, originIds: [origin.id], destIds: [checkmate.id] });
    expect(dark.security.monitoredBy).toEqual([]);
    expect(nearestArmistice(dark.snare, 20_000, pyro.bodies)!.gap).toBeGreaterThan(1e6);
  });

  it("keep best-catch groups honest under a stand-off", () => {
    const wide = bestCatches(stanton.bodies, station, { radius: 20_000, spread: "auto", standoff: 0 });
    const tight = bestCatches(stanton.bodies, station, { radius: 20_000, spread: "auto", standoff: 200_000 });
    // Farther out the routes have spread more, so one spot holds fewer of them.
    expect(tight[0].originIds.length).toBeLessThan(wide[0].originIds.length);
    for (const group of tight) {
      const [leg] = solvePlan({ ...base, standoff: 200_000, originIds: group.originIds, destIds: [station.id] });
      expect(leg.corridor.feasible).toBe(true);
      expect(leg.security.armistice!.gap).toBeGreaterThanOrEqual(200_000 - 1);
    }
  });
});

describe("hand-set weights", () => {
  const dest = named("ARC-L1 Wide Forest Station");
  const options = { radius: 20_000, spread: "auto" as const };

  it("override the baked weight, for a place and for what sits on it", () => {
    expect(weightOf(named("Daymar"), { [named("Daymar").id]: 40 })).toBe(40);
    expect(weightOf(named("Daymar"), {})).toBe(2);
    // Set on the planet, read through its city; set on the city, folded onto the planet.
    expect(weightOf(named("Lorville"), { [named("Hurston").id]: 0 })).toBe(0);
    expect(anchorWeights(stanton.bodies, { [named("Lorville").id]: 50 })).toEqual({ [named("Hurston").id]: 50 });
  });

  it("pull an event location into the top group", () => {
    const plain = bestCatches(stanton.bodies, dest, options);
    // Somewhere the unweighted best group leaves out.
    const outsider = stanton.bodies.find(
      (b) => b.kind === "moon" && !plain[0].originIds.includes(b.id) && bestCatches(stanton.bodies, dest, { ...options, weights: { [b.id]: 1 } }).length > 0,
    )!;
    const boosted = bestCatches(stanton.bodies, dest, { ...options, weights: { [outsider.id]: 5000 } });
    expect(boosted[0].originIds).toContain(outsider.id);
    expect(boosted[0].score).toBeGreaterThan(5000);
  });

  it("zero out a place without breaking the search", () => {
    const hurston = named("Hurston").id;
    const muted = bestCatches(stanton.bodies, dest, { ...options, weights: { [hurston]: 0 } });
    const plain = bestCatches(stanton.bodies, dest, options);
    expect(muted.length).toBeGreaterThan(0);
    const withHurston = plain.find((c) => c.originIds.includes(hurston));
    const mutedSame = muted.find((c) => c.originIds.includes(hurston));
    if (withHurston && mutedSame) expect(mutedSame.score).toBeLessThan(withHurston.score);
  });
});

describe("scanTargets", () => {
  it("offers real destinations only", () => {
    const targets = scanTargets(stanton.bodies);
    expect(targets.map((b) => b.name)).toContain("Hurston");
    expect(targets.map((b) => b.name)).toContain("Everus Harbor");
    expect(targets.some((b) => b.hidden || b.on || b.kind === "asteroid" || b.kind === "star")).toBe(false);
  });
});

describe("kinematics", () => {
  const drive: QuantumDrive = { id: "d", name: "d", size: 1, grade: 1, speed: 2e8, accel1: 1e7, accel2: 3e7, spool: 4, cooldown: 8 };

  it("is monotonic and symmetric over a long trip", () => {
    const total = 2e10;
    const end = travelTime(total, drive);
    // Ramp 10 s each way covering 1e9 each, cruise 1.8e10 at 2e8 = 90 s.
    expect(end).toBeCloseTo(110, 6);
    expect(timeToReach(total / 2, total, drive)).toBeCloseTo(end / 2, 6);
    expect(timeToReach(1e9, total, drive)).toBeCloseTo(10, 6);
    expect(speedAt(total / 2, total, drive)).toBeCloseTo(2e8);
    expect(speedAt(0, total, drive)).toBe(0);
  });

  it("never reaches drive speed on a short hop", () => {
    const total = 2e8;
    // Mean acceleration 2e7 over each 1e8 half: 2 * sqrt(2 * 1e8 / 2e7).
    expect(travelTime(total, drive)).toBeCloseTo(2 * Math.sqrt(10), 6);
    expect(speedAt(total / 2, total, drive)).toBeLessThan(drive.speed);
  });
});

describe("showlocation", () => {
  it("reads labelled coordinates", () => {
    expect(parseShowLocation("Coordinates: x:12850457093.5 y:-1234.25 z:0.0")).toEqual([12850457093.5, -1234.25, 0]);
    expect(parseShowLocation("x=1 y=2 z=3")).toEqual([1, 2, 3]);
  });

  it("falls back to three bare numbers, and rejects less", () => {
    expect(parseShowLocation("-5.5, 6e3, 7")).toEqual([-5.5, 6000, 7]);
    expect(parseShowLocation("only 1 2")).toBeUndefined();
    expect(parseShowLocation("")).toBeUndefined();
  });
});

describe("share links", () => {
  it("round-trips a plan", () => {
    const state = {
      ...DEFAULT_STATE,
      originIds: ["Stanton1", "Stanton2"],
      destIds: ["Stanton3_L1", "Stanton3"],
      spread: 50000 as const,
      drift: 75000,
      radius: 25000,
      placement: 0.25,
      activeLeg: 1,
      ship: "DRAK_Cutlass_Blue",
      mode: "dampen" as const,
      dampen: 4000,
      targetDrive: "QDRV_X",
      weights: { Stanton2b: 50, RR_HUR_LEO: 0 },
      standoff: 75000,
      careArmistice: false,
      careComms: false,
    };
    expect(decodeState(encodeState(state))).toEqual(state);
  });

  it("survives garbage", () => {
    expect(decodeState("#p=abc&r=-4&sp=wat&l=x")).toEqual(DEFAULT_STATE);
    expect(decodeState("")).toEqual(DEFAULT_STATE);
  });
});
