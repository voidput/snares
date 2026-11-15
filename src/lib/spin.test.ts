import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { withMarkers } from "./markers";
import { solvePlan } from "./plan";
import { sanitizeState } from "./plans";
import { decodeState, DEFAULT_STATE, encodeState } from "./share";
import { carrierOf, holdWindow, lastStops, rotateZ, turned, turnFrom, turnIn, turnSpeed } from "./spin";
import type { Universe } from "./types";
import { distance } from "./vec";

const universe = JSON.parse(fs.readFileSync(new URL("../../public/data/universe.json", import.meta.url), "utf-8")) as Universe;
const stanton = universe.systems.find((s) => s.name === "Stanton")!;
const byId = new Map(stanton.bodies.map((b) => [b.id, b]));
const named = (name: string, bodies = stanton.bodies) => bodies.find((b) => b.name === name)!;

describe("baked rotation", () => {
  it("carries each body's period and rotating zone from the game files", () => {
    expect(named("Hurston")).toMatchObject({ spin: 2.48, grid: 2_000_000 });
    expect(named("microTech").spin).toBeCloseTo(4.12, 2);
    expect(stanton.bodies.filter((b) => (b.kind === "planet" || b.kind === "moon") && !b.spin)).toEqual([]);
  });

  it("knows which places turn with a body and which hold still", () => {
    const tressler = named("Port Tressler");
    expect(carrierOf(tressler, byId)?.name).toBe("microTech");
    // The baked position is the unturned one.
    expect(distance(tressler.pos, [0, 1, 2].map((i) => named("microTech").pos[i] + tressler.local![i]) as [number, number, number])).toBeLessThan(2);
    expect(carrierOf(named("Everus Harbor"), byId)?.name).toBe("Hurston");
    expect(carrierOf(named("Lorville"), byId)?.name).toBe("Hurston");
    expect(named("Lorville").on).toBe(named("Hurston").id);
    // Moons and Lagrange stations sit outside any rotating zone.
    expect(carrierOf(named("Daymar"), byId)).toBeUndefined();
    expect(carrierOf(named("HUR L1"), byId)).toBeUndefined();
  });

  it("puts each low station over its city", () => {
    const over = (station: string, city: string) => {
      const a = named(station).local!;
      const b = named(city).local!;
      const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
      return (Math.acos(cos) * 180) / Math.PI;
    };
    expect(over("Everus Harbor", "Lorville")).toBeLessThan(20);
    expect(over("Port Tressler", "New Babbage")).toBeLessThan(20);
  });
});

describe("turned", () => {
  const microTech = named("microTech");

  it("leaves everything alone at no turn", () => {
    expect(turned(stanton.bodies, {})).toBe(stanton.bodies);
    expect(turned(stanton.bodies, { [microTech.id]: 360 })).toBe(stanton.bodies);
  });

  it("carries a station round its planet and nothing else", () => {
    const moved = turned(stanton.bodies, { [microTech.id]: 90 });
    const before = named("Port Tressler");
    const after = named("Port Tressler", moved);
    expect(distance(after.pos, microTech.pos)).toBeCloseTo(distance(before.pos, microTech.pos), 0);
    expect(after.pos[2]).toBeCloseTo(before.pos[2], 0);
    expect(distance(after.pos, before.pos)).toBeGreaterThan(1_000_000);
    expect(named("microTech", moved).pos).toEqual(microTech.pos);
    expect(named("Everus Harbor", moved).pos).toEqual(named("Everus Harbor").pos);
    // A city stays on its planet's centre, which is how it is planned.
    expect(named("New Babbage", moved).pos).toEqual(microTech.pos);
  });

  it("turns a quarter in a quarter of the period", () => {
    expect(turnIn(microTech, (microTech.spin! * 3600) / 4)).toBeCloseTo(90, 6);
    expect(rotateZ([1, 0, 5], 90)[1]).toBeCloseTo(1, 9);
    // Port Tressler: about 20 km a minute.
    expect(turnSpeed(named("Port Tressler"), microTech) * 60).toBeGreaterThan(19_000);
    expect(turnSpeed(named("Port Tressler"), microTech) * 60).toBeLessThan(21_000);
  });

  it("reads the turn back from a position at the place", () => {
    const moved = turned(stanton.bodies, { [microTech.id]: 137 });
    const at = named("Port Tressler", moved).pos;
    expect(turnFrom(at, named("Port Tressler"), microTech)).toBeCloseTo(137, 3);
  });

  it("changes which way a route comes in, and whether a planet is in the way", () => {
    const bodies = (degrees: number) => withMarkers(turned(stanton.bodies, { [microTech.id]: degrees }));
    const plan = (degrees: number) =>
      solvePlan({
        bodies: bodies(degrees),
        originIds: [named("Crusader").id],
        destIds: [named("Port Tressler").id],
        spread: "auto",
        drift: 50_000,
        radius: 20_000,
        placement: 0.5,
      })[0];
    const stops = new Set<string>();
    for (let d = 0; d < 360; d += 15) stops.add(plan(d).routes[0].via?.[0]?.name ?? "direct");
    // Over a turn the station is sometimes in view and sometimes behind microTech.
    expect(stops.has("direct")).toBe(true);
    expect([...stops].some((s) => s.startsWith("microTech OM-"))).toBe(true);
  });
});

describe("lastStops", () => {
  const all = withMarkers(stanton.bodies);

  it("gives a high-latitude city its pole marker for the whole turn", () => {
    const stops = lastStops(named("New Babbage"), named("microTech"), all);
    expect(stops[0]).toMatchObject({ share: 1 });
    expect(stops[0].marker.name).toBe("microTech OM-1");
  });

  it("shares a low-latitude city between the four markers round the equator", () => {
    const stops = lastStops(named("Area18"), named("ArcCorp"), all);
    expect(stops.map((s) => s.marker.name).sort()).toEqual(["ArcCorp OM-3", "ArcCorp OM-4", "ArcCorp OM-5", "ArcCorp OM-6"]);
    for (const s of stops) expect(s.share).toBeCloseTo(0.25, 1);
  });

  it("has nothing to say without markers", () => {
    expect(lastStops(named("Area18"), named("ArcCorp"), stanton.bodies)).toEqual([]);
  });
});

describe("holdWindow", () => {
  it("measures how long cover lasts either side of now", () => {
    const cover = (t: number) => (t > -60 && t < 120 ? 1 : 0);
    expect(holdWindow(cover, 0.98, 10, 3600)).toEqual({ before: 50, after: 110 });
  });

  it("stops at the limit when cover never drops", () => {
    expect(holdWindow(() => 1, 0.98, 10, 600)).toEqual({ before: 600, after: 600 });
  });
});

describe("turns in a link", () => {
  it("round-trips, dropping whole turns and bad entries", () => {
    const state = { ...DEFAULT_STATE, turns: { Stanton4: 137.26, Stanton1: 360, Stanton2: -90 } };
    expect(decodeState(encodeState(state)).turns).toEqual({ Stanton4: 137.3, Stanton2: 270 });
    expect(decodeState("t=Stanton4:abc,:40,Stanton1:400").turns).toEqual({});
    expect(encodeState(DEFAULT_STATE)).not.toContain("t=");
  });

  it("survives a saved plan", () => {
    expect(sanitizeState({ ...DEFAULT_STATE, turns: { Stanton4: 45, bad: "x" } }).turns).toEqual({ Stanton4: 45 });
    expect(sanitizeState({ ...DEFAULT_STATE, turns: "nope" }).turns).toEqual({});
  });
});
