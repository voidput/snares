import { decodeState, DEFAULT_STATE, encodeState, type FleetRole, type PlanState } from "./share";

/** A plan kept in this browser under a name, so several can be switched between. */
export interface SavedPlan {
  id: string;
  name: string;
  /** ISO timestamp of the last save. */
  savedAt: string;
  state: PlanState;
}

/** What an exported file holds. */
export interface PlanFile {
  app: "snares";
  version: 1;
  exported: string;
  plans: { name: string; savedAt: string; plan: PlanState }[];
}

export const STORAGE_KEY = "snares.plans.v1";
export const MAX_PLANS = 200;
const MAX_NAME = 60;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const strings = (v: unknown): string[] =>
  // Ids travel comma-separated in links, so one holding a comma could never round-trip.
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x && !x.includes(",")) : [];

/**
 * Turn anything, a hand-edited file included, into a valid plan. Fields of the wrong type fall
 * back to the default, and the link codec then applies the same limits a shared link gets.
 */
export function sanitizeState(raw: unknown): PlanState {
  if (!isObject(raw)) return { ...DEFAULT_STATE, weights: {}, fleet: [], turns: {} };
  const r = raw;
  const weights: Record<string, number> = {};
  if (isObject(r.weights)) {
    for (const [id, weight] of Object.entries(r.weights)) {
      if (typeof weight === "number" && Number.isFinite(weight) && !id.includes(",")) weights[id] = weight;
    }
  }
  const turns: Record<string, number> = {};
  if (isObject(r.turns)) {
    for (const [id, degrees] of Object.entries(r.turns)) {
      if (typeof degrees === "number" && Number.isFinite(degrees)) turns[id] = degrees;
    }
  }
  const candidate: PlanState = {
    channel: r.channel === "ptu" ? "ptu" : "live",
    system: str(r.system) ?? DEFAULT_STATE.system,
    originIds: strings(r.originIds),
    destIds: strings(r.destIds),
    spread: r.spread === "exact" || r.spread === "auto" ? r.spread : num(r.spread, NaN) >= 0 ? (r.spread as number) : DEFAULT_STATE.spread,
    drift: num(r.drift, DEFAULT_STATE.drift),
    radius: num(r.radius, DEFAULT_STATE.radius),
    placement: num(r.placement, DEFAULT_STATE.placement),
    activeLeg: num(r.activeLeg, 0),
    // JSON drops an unset ship, so a missing one means hand-set radii, not the default ship.
    ship: str(r.ship),
    mode: r.mode === "dampen" ? "dampen" : "snare",
    dampen: num(r.dampen, DEFAULT_STATE.dampen),
    targetDrive: str(r.targetDrive),
    myDrive: str(r.myDrive),
    weights,
    standoff: num(r.standoff, DEFAULT_STATE.standoff),
    careArmistice: r.careArmistice !== false,
    careComms: r.careComms !== false,
    fleet: Array.isArray(r.fleet)
      ? r.fleet
          .filter(isObject)
          .filter((m) => m.role === "split" || m.role === "hold" || m.role === "backstop")
          .map((m) => ({ role: m.role as FleetRole, ship: typeof m.ship === "string" && /^[\w-]+$/.test(m.ship) ? m.ship : undefined }))
      : [],
    turns,
  };
  return decodeState(encodeState(candidate));
}

export function cleanName(raw: unknown, fallback = "Unnamed plan"): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
  return name || fallback;
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Save under a name. A plan already using that name is replaced in place. */
export function upsertPlan(plans: SavedPlan[], name: string, state: PlanState, now = new Date()): SavedPlan[] {
  const clean = cleanName(name);
  const existing = plans.find((p) => sameName(p.name, clean));
  const saved: SavedPlan = { id: existing?.id ?? newId(), name: clean, savedAt: now.toISOString(), state };
  return existing ? plans.map((p) => (p === existing ? saved : p)) : [...plans, saved].slice(-MAX_PLANS);
}

/** Read the stored list. Never throws: storage can be blocked, empty or hold junk. */
export function loadPlans(storage: Pick<Storage, "getItem"> | undefined): SavedPlan[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isObject).slice(0, MAX_PLANS).map((p) => ({
      id: str(p.id) ?? newId(),
      name: cleanName(p.name),
      savedAt: str(p.savedAt) ?? new Date(0).toISOString(),
      state: sanitizeState(p.state),
    }));
  } catch {
    return [];
  }
}

/** Write the list. False when the browser refuses, so the page can say so. */
export function storePlans(storage: Pick<Storage, "setItem"> | undefined, plans: SavedPlan[]): boolean {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(plans));
    return true;
  } catch {
    return false;
  }
}

export function exportPlans(plans: Pick<SavedPlan, "name" | "savedAt" | "state">[], now = new Date()): string {
  const file: PlanFile = {
    app: "snares",
    version: 1,
    exported: now.toISOString(),
    plans: plans.map((p) => ({ name: p.name, savedAt: p.savedAt, plan: p.state })),
  };
  return JSON.stringify(file, null, 2);
}

/** Read an exported file. Throws an Error with a message fit to show when it is not one. */
export function parsePlanFile(text: string): { name: string; savedAt: string; state: PlanState }[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Not a JSON file.");
  }
  if (!isObject(data) || data.app !== "snares" || !Array.isArray(data.plans)) throw new Error("Not a Snares plan file.");
  if (typeof data.version === "number" && data.version > 1) throw new Error("This file is from a newer version of Snares.");
  const plans = data.plans.filter(isObject).slice(0, MAX_PLANS).map((p) => ({
    name: cleanName(p.name),
    savedAt: str(p.savedAt) ?? new Date().toISOString(),
    state: sanitizeState(p.plan),
  }));
  if (plans.length === 0) throw new Error("The file holds no plans.");
  return plans;
}

/** Add imported plans. A name already taken gets a number rather than overwriting. */
export function mergePlans(plans: SavedPlan[], incoming: { name: string; savedAt: string; state: PlanState }[]): SavedPlan[] {
  const out = [...plans];
  for (const p of incoming) {
    // The same plan under the same name is already here: importing twice adds nothing.
    const base = p.name.slice(0, MAX_NAME - 5).toLowerCase();
    const alreadyHere = (q: SavedPlan) =>
      (sameName(q.name, p.name) || q.name.toLowerCase().startsWith(`${base} (`)) && encodeState(q.state) === encodeState(p.state);
    if (out.some(alreadyHere)) continue;
    let name = p.name;
    for (let n = 2; out.some((q) => sameName(q.name, name)); n++) name = `${p.name.slice(0, MAX_NAME - 5)} (${n})`;
    out.push({ id: newId(), name, savedAt: p.savedAt, state: p.state });
  }
  return out.slice(-MAX_PLANS);
}
