import { describe, expect, it } from "vitest";

import { behind, frontSpan } from "./view";

describe("frontSpan", () => {
  const centre = [0, 0] as const;

  it("is the whole chord for a line passing in front", () => {
    const span = frontSpan([-10, 0], [10, 0], 5, 5, centre, 5, 0)!;
    expect(span[0]).toBeCloseTo(0.25, 9);
    expect(span[1]).toBeCloseTo(0.75, 9);
  });

  it("is nothing for a line passing behind, or one that misses the disc", () => {
    expect(frontSpan([-10, 0], [10, 0], -5, -5, centre, 5, 0)).toBeUndefined();
    expect(frontSpan([-10, 8], [10, 8], 5, 5, centre, 5, 0)).toBeUndefined();
    expect(frontSpan([3, 3], [3, 3], 5, 5, centre, 5, 0)).toBeUndefined();
  });

  it("keeps only the near half of a line that dives through", () => {
    // Front at the start, behind at the end, crossing the centre plane halfway.
    const span = frontSpan([-10, 0], [10, 0], 10, -10, centre, 5, 0)!;
    expect(span[0]).toBeCloseTo(0.25, 9);
    expect(span[1]).toBeCloseTo(0.5, 9);
    const back = frontSpan([-10, 0], [10, 0], -10, 10, centre, 5, 0)!;
    expect(back[0]).toBeCloseTo(0.5, 9);
    expect(back[1]).toBeCloseTo(0.75, 9);
  });

  it("clips to a segment that ends inside the disc", () => {
    const span = frontSpan([-10, 0], [0, 0], 5, 5, centre, 5, 0)!;
    expect(span[0]).toBeCloseTo(0.5, 9);
    expect(span[1]).toBe(1);
  });
});

describe("behind", () => {
  it("hides a point over the disc and farther than the centre", () => {
    expect(behind([1, 1], -3, [0, 0], 5, 0)).toBe(true);
    expect(behind([1, 1], 3, [0, 0], 5, 0)).toBe(false);
    expect(behind([9, 1], -3, [0, 0], 5, 0)).toBe(false);
  });
});
