import { describe, expect, it } from "vitest";

import { bestDirection, bestPartialDirection, circleOverlap, corridor, evaluate, type Route } from "./solver";
import { add, dot, normalize, scale, type Vec3 } from "./vec";

const dest: Vec3 = [0, 0, 0];
const route = (id: string, origin: Vec3, spread = 0): Route => ({ id, label: id, origin, spread });
const deg = (d: number) => (d * Math.PI) / 180;
const at = (angle: number, dist: number): Vec3 => [Math.cos(deg(angle)) * dist, Math.sin(deg(angle)) * dist, 0];

describe("bestDirection", () => {
  it("follows a single route exactly", () => {
    const { direction, phi } = bestDirection(dest, [route("a", [0, 5e9, 0])]);
    expect(direction[1]).toBeCloseTo(1, 9);
    expect(phi).toBeCloseTo(0, 9);
  });

  it("bisects two routes, needing sin of half the angle between them", () => {
    const { direction, phi } = bestDirection(dest, [route("a", at(0, 1e10)), route("b", at(10, 2e10))]);
    expect(direction[0]).toBeCloseTo(Math.cos(deg(5)), 7);
    expect(direction[1]).toBeCloseTo(Math.sin(deg(5)), 7);
    expect(phi).toBeCloseTo(Math.sin(deg(5)), 7);
  });

  it("is governed by the widest pair, not the mean, when routes bunch up", () => {
    const routes = [0, 1, 2, 20].map((a) => route(String(a), at(a, 1e10)));
    const { direction, phi } = bestDirection(dest, routes);
    expect(phi).toBeCloseTo(Math.sin(deg(10)), 6);
    expect(Math.atan2(direction[1], direction[0])).toBeCloseTo(deg(10), 6);
  });

  it("finds the circumcentre of three routes out of plane", () => {
    const origins: Vec3[] = [
      [1e10, 1e8, 0],
      [1e10, -1e8, 0],
      [1e10, 0, 1.5e8],
    ];
    const { direction, phi } = bestDirection(dest, origins.map((o, i) => route(String(i), o)));
    const needs = origins.map((o) => Math.sqrt(1 - dot(direction, normalize(o)) ** 2));
    // All three bind at the optimum.
    expect(Math.max(...needs) - Math.min(...needs)).toBeLessThan(1e-9);
    expect(phi).toBeCloseTo(needs[0], 9);
  });

  it("charges a route for its departure spread", () => {
    const { phi } = bestDirection(dest, [route("a", [1e10, 0, 0], 1e6)]);
    expect(phi).toBeCloseTo(1e-4, 9);
  });
});

describe("corridor", () => {
  it("reaches out to radius over phi", () => {
    const routes = [route("a", at(0, 1e10)), route("b", at(1, 1e10))];
    const c = corridor(dest, routes, { radius: 20000, arrival: 24000 });
    expect(c.minDistance).toBe(44000);
    expect(c.maxDistance).toBeCloseTo(20000 / Math.sin(deg(0.5)), 0);
    expect(c.feasible).toBe(true);

    // Just inside the far end everything is covered, with almost nothing to spare.
    const edge = evaluate(dest, routes, scale(c.direction, c.maxDistance * 0.999), 20000);
    expect(edge.coverage).toBe(1);
    expect(edge.margin).toBeGreaterThan(0);
    expect(edge.margin).toBeLessThan(25);
    const past = evaluate(dest, routes, scale(c.direction, c.maxDistance * 1.05), 20000);
    expect(past.margin).toBeLessThan(0);
  });

  it("is infeasible when the routes diverge before the dropout sphere is cleared", () => {
    const c = corridor(dest, [route("a", at(0, 1e10)), route("b", at(90, 1e10))], { radius: 20000, arrival: 1e6 });
    expect(c.feasible).toBe(false);
  });

  it("keeps the snare out of a lone route's departure zone", () => {
    const c = corridor(dest, [route("a", [1e9, 0, 0], 1000)], { radius: 20000, arrival: 24000 });
    expect(c.maxDistance).toBeCloseTo(1e9 - 1000 - 20000, 3);
  });
});

describe("evaluate", () => {
  it("reports offset, cone radius and margin", () => {
    const e = evaluate(dest, [route("a", [1e9, 0, 0], 1e6)], [1e7, 5000, 0], 20000);
    expect(e.routes[0].along).toBeCloseTo(1e7);
    expect(e.routes[0].offset).toBeCloseTo(5000);
    expect(e.routes[0].coneRadius).toBeCloseTo(10000);
    expect(e.routes[0].margin).toBeCloseTo(5000);
    expect(e.coverage).toBe(1);
  });

  it("gives partial coverage when the cone is wider than the snare", () => {
    const e = evaluate(dest, [route("a", [1e9, 0, 0], 4e6)], [1e7, 0, 0], 20000);
    // Cone radius 40 km, snare 20 km, concentric: a quarter of the area.
    expect(e.coverage).toBeCloseTo(0.25, 9);
    expect(e.margin).toBeCloseTo(-20000);
  });

  it("does not cover a route the snare sits behind or beyond", () => {
    expect(evaluate(dest, [route("a", [1e9, 0, 0])], [-1e6, 0, 0], 20000).coverage).toBe(0);
    expect(evaluate(dest, [route("a", [1e9, 0, 0])], [2e9, 0, 0], 20000).coverage).toBe(0);
  });
});

describe("circleOverlap", () => {
  it("handles disjoint, contained and crossing circles", () => {
    expect(circleOverlap(1, 1, 3)).toBe(0);
    expect(circleOverlap(3, 1, 0.5)).toBeCloseTo(Math.PI);
    expect(circleOverlap(1, 1, 0)).toBeCloseTo(Math.PI);
    // Two unit circles one radius apart: 2*pi/3 - sqrt(3)/2.
    expect(circleOverlap(1, 1, 1)).toBeCloseTo((2 * Math.PI) / 3 - Math.sqrt(3) / 2, 9);
  });
});

describe("bestPartialDirection", () => {
  it("abandons the outlier to cover the cluster", () => {
    const routes = [route("a", at(0, 1e10)), route("b", at(0.2, 1e10)), route("far", at(60, 1e10))];
    const dist = 1e7;
    const { direction } = bestDirection(dest, routes);
    const u = bestPartialDirection(dest, routes, 20000, dist, direction);
    const e = evaluate(dest, routes, add(dest, scale(u, dist)), 20000);
    expect(e.coverage).toBeCloseTo(2 / 3, 6);
    expect(e.routes.find((r) => r.id === "far")?.coverage).toBe(0);
  });
});
