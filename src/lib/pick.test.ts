import { describe, expect, it } from "vitest";
import { mapRank, pickNearest } from "./pick";

describe("pickNearest", () => {
  it("returns nothing out of reach", () => {
    expect(pickNearest([{ item: "a", distance: 20, rank: 0 }])).toBeUndefined();
    expect(pickNearest([])).toBeUndefined();
  });

  it("keeps the labelled body when others are stacked on it", () => {
    const pile = [
      { item: "Hurston", distance: 4, rank: 1 },
      { item: "Everus Harbor", distance: 1, rank: 5 },
      { item: "Arial", distance: 3, rank: 6 },
    ];
    expect(pickNearest(pile)).toBe("Hurston");
    // Moving a few pixels inside the pile does not change the answer.
    expect(pickNearest(pile.map((c) => ({ ...c, distance: c.distance + 2 })))).toBe("Hurston");
  });

  it("takes the nearest once dots are apart", () => {
    expect(
      pickNearest([
        { item: "Hurston", distance: 12, rank: 1 },
        { item: "Everus Harbor", distance: 2, rank: 5 },
      ]),
    ).toBe("Everus Harbor");
  });

  it("breaks a tie in rank by distance", () => {
    expect(
      pickNearest([
        { item: "a", distance: 5, rank: 5 },
        { item: "b", distance: 3, rank: 5 },
      ]),
    ).toBe("b");
  });

  it("keeps the held one among equals, so the pick does not flicker", () => {
    const pile = [
      { item: "Nyx Gateway", distance: 2, rank: 5 },
      { item: "Magnus Jump Point", distance: 3, rank: 5 },
    ];
    expect(pickNearest(pile)).toBe("Nyx Gateway");
    expect(pickNearest(pile, "Magnus Jump Point")).toBe("Magnus Jump Point");
    // Something more important in the pile still wins over what was held.
    expect(pickNearest([...pile, { item: "Planet", distance: 5, rank: 1 }], "Magnus Jump Point")).toBe("Planet");
  });
});

describe("mapRank", () => {
  it("puts planets and core stations ahead of comm arrays and mining bases", () => {
    const planet = mapRank("planet", 3);
    const hub = mapRank("station", 8);
    const commArray = mapRank("station", 0.25);
    const miningBase = mapRank("asteroid", 0.25);
    expect(mapRank("star")).toBeLessThan(planet);
    expect(planet).toBeLessThan(hub);
    expect(hub).toBeLessThan(commArray);
    expect(hub).toBeLessThan(miningBase);
    expect(mapRank("station", 4)).toBeLessThan(commArray);
  });
});
