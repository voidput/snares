import { describe, expect, it } from "vitest";
import { exportPlans, loadPlans, mergePlans, parsePlanFile, sanitizeState, storePlans, STORAGE_KEY, upsertPlan } from "./plans";
import { DEFAULT_STATE, type PlanState } from "./share";

const plan: PlanState = {
  ...DEFAULT_STATE,
  system: "Pyro",
  originIds: ["a", "b"],
  destIds: ["c"],
  mode: "dampen",
  radius: 5000,
  ship: undefined,
  weights: { a: 3 },
  careComms: false,
};

function memory(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe("sanitizeState", () => {
  it("keeps a valid plan unchanged", () => {
    expect(sanitizeState(plan)).toEqual(plan);
    expect(sanitizeState(DEFAULT_STATE)).toEqual(DEFAULT_STATE);
  });

  it("falls back to defaults on junk", () => {
    expect(sanitizeState(null)).toEqual(DEFAULT_STATE);
    expect(sanitizeState("x")).toEqual(DEFAULT_STATE);
    const odd = sanitizeState({ system: 4, originIds: "a", destIds: [1, "c", "d,e"], radius: -5, placement: 9, weights: { a: "x", b: 2 }, mode: "?" });
    expect(odd.system).toBe(DEFAULT_STATE.system);
    expect(odd.originIds).toEqual([]);
    expect(odd.destIds).toEqual(["c"]);
    expect(odd.radius).toBe(DEFAULT_STATE.radius);
    expect(odd.placement).toBe(1);
    expect(odd.weights).toEqual({ b: 2 });
    expect(odd.mode).toBe("snare");
  });
});

describe("saved plans", () => {
  it("replaces a plan saved under the same name", () => {
    let plans = upsertPlan([], "Gate camp", DEFAULT_STATE);
    plans = upsertPlan(plans, "Other", DEFAULT_STATE);
    const again = upsertPlan(plans, "  gate   CAMP ", plan);
    expect(again).toHaveLength(2);
    expect(again[0].id).toBe(plans[0].id);
    expect(again[0].state).toEqual(plan);
  });

  it("round-trips through storage", () => {
    const store = memory();
    const plans = upsertPlan([], "Gate camp", plan);
    expect(storePlans(store, plans)).toBe(true);
    expect(loadPlans(store)).toEqual(plans);
  });

  it("survives blocked or corrupt storage", () => {
    expect(loadPlans(undefined)).toEqual([]);
    expect(loadPlans(memory("{nope"))).toEqual([]);
    expect(loadPlans(memory('{"a":1}'))).toEqual([]);
    expect(loadPlans({ getItem: () => { throw new Error("denied"); } })).toEqual([]);
    expect(storePlans({ setItem: () => { throw new Error("full"); } }, [])).toBe(false);
    expect(storePlans(undefined, [])).toBe(false);
  });
});

describe("plan files", () => {
  it("round-trips an export", () => {
    const plans = upsertPlan(upsertPlan([], "One", plan), "Two", DEFAULT_STATE);
    const back = parsePlanFile(exportPlans(plans));
    expect(back.map((p) => p.name)).toEqual(["One", "Two"]);
    expect(back[0].state).toEqual(plan);
    expect(back[1].state).toEqual(DEFAULT_STATE);
  });

  it("rejects files that are not plan files", () => {
    expect(() => parsePlanFile("nope")).toThrow("Not a JSON file.");
    expect(() => parsePlanFile("[]")).toThrow("Not a Snares plan file.");
    expect(() => parsePlanFile('{"app":"other","plans":[]}')).toThrow("Not a Snares plan file.");
    expect(() => parsePlanFile('{"app":"snares","version":1,"plans":[]}')).toThrow("no plans");
    expect(() => parsePlanFile('{"app":"snares","version":2,"plans":[{}]}')).toThrow("newer version");
  });

  it("merges without overwriting or duplicating", () => {
    const mine = upsertPlan([], "One", DEFAULT_STATE);
    const incoming = parsePlanFile(exportPlans(upsertPlan([], "One", plan)));
    const merged = mergePlans(mine, incoming);
    expect(merged.map((p) => p.name)).toEqual(["One", "One (2)"]);
    expect(merged[0].state).toEqual(DEFAULT_STATE);
    expect(mergePlans(merged, incoming)).toHaveLength(2);
  });
});

describe("fleet in plans", () => {
  it("round-trips a fleet through a file and drops junk entries", () => {
    const withFleet: PlanState = { ...plan, fleet: [{ role: "split", ship: "RSI_Mantis" }, { role: "hold" }, { role: "backstop", ship: "ANVL_Scorpius_Antares" }] };
    expect(parsePlanFile(exportPlans(upsertPlan([], "Fleet", withFleet)))[0].state.fleet).toEqual(withFleet.fleet);
    expect(sanitizeState({ fleet: [{ role: "nope" }, { role: "hold", ship: "a,b" }, 4, { role: "split", ship: "X_1" }] }).fleet).toEqual([
      { role: "hold", ship: undefined },
      { role: "split", ship: "X_1" },
    ]);
    expect(sanitizeState({ fleet: Array.from({ length: 9 }, () => ({ role: "split" })) }).fleet).toHaveLength(5);
  });
});
