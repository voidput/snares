import type { Mode, SpreadMode, Weights } from "./plan";
import type { Turns } from "./spin";

/** Everything that defines a plan, and so everything a shared link carries. */
export type Channel = "live" | "ptu";

export interface PlanState {
  /** Which game build the data is from: the live servers or the public test universe. */
  channel: Channel;
  system: string;
  originIds: string[];
  destIds: string[];
  spread: SpreadMode;
  /** Metres. */
  drift: number;
  /** Metres. */
  radius: number;
  placement: number;
  activeLeg: number;
  /** Id of the interdictor ship, when the radii came from one. */
  ship?: string;
  mode: Mode;
  /** Dampener range, metres. */
  dampen: number;
  targetDrive?: string;
  myDrive?: string;
  /** Traffic weights set by hand for this plan, by body id. */
  weights: Weights;
  /** Distance to keep between the snare sphere and an armistice zone, metres. */
  standoff: number;
  /** Keep clear of armistice zones, and warn when close to one. */
  careArmistice: boolean;
  /** Show who monitors a spot, and have the scout prefer unwatched ones. */
  careComms: boolean;
  /** Ships beyond the lead: what each does, and which interdictor it is (the lead's when unset). */
  fleet: FleetEntry[];
  /** How far each turning planet or moon has turned, degrees, by body id. */
  turns: Turns;
}

export type FleetRole = "split" | "hold" | "backstop";
export interface FleetEntry {
  role: FleetRole;
  ship?: string;
}
export const MAX_FLEET = 5;
const ROLE_CODE: Record<FleetRole, string> = { split: "s", hold: "h", backstop: "b" };
const CODE_ROLE: Record<string, FleetRole> = { s: "split", h: "hold", b: "backstop" };

export const DEFAULT_STATE: PlanState = {
  channel: "live",
  system: "Stanton",
  originIds: [],
  destIds: [],
  spread: "auto",
  drift: 50_000,
  radius: 20_000,
  placement: 0.6,
  activeLeg: 0,
  ship: "RSI_Mantis",
  mode: "snare",
  dampen: 12_000,
  weights: {},
  standoff: 30_000,
  careArmistice: true,
  careComms: true,
  fleet: [],
  turns: {},
};

export function encodeState(state: PlanState): string {
  const p = new URLSearchParams();
  if (state.channel !== DEFAULT_STATE.channel) p.set("ch", state.channel);
  p.set("s", state.system);
  if (state.originIds.length) p.set("o", state.originIds.join(","));
  if (state.destIds.length) p.set("d", state.destIds.join(","));
  if (state.spread !== DEFAULT_STATE.spread) p.set("sp", String(state.spread));
  if (state.drift !== DEFAULT_STATE.drift) p.set("dr", String(Math.round(state.drift)));
  if (state.radius !== DEFAULT_STATE.radius) p.set("r", String(Math.round(state.radius)));
  if (state.placement !== DEFAULT_STATE.placement) p.set("p", state.placement.toFixed(3));
  if (state.activeLeg) p.set("l", String(state.activeLeg));
  if (state.ship !== DEFAULT_STATE.ship) p.set("sh", state.ship ?? "");
  if (state.mode !== DEFAULT_STATE.mode) p.set("m", state.mode);
  if (state.dampen !== DEFAULT_STATE.dampen) p.set("dm", String(Math.round(state.dampen)));
  if (state.targetDrive) p.set("td", state.targetDrive);
  if (state.myDrive) p.set("md", state.myDrive);
  if (state.standoff !== DEFAULT_STATE.standoff) p.set("so", String(Math.round(state.standoff)));
  if (!state.careArmistice) p.set("ar", "0");
  if (!state.careComms) p.set("cm", "0");
  if (state.fleet.length) p.set("f", state.fleet.map((m) => `${ROLE_CODE[m.role]}.${m.ship ?? ""}`).join(","));
  const weights = Object.entries(state.weights);
  if (weights.length) p.set("w", weights.map(([id, weight]) => `${id}:${weight}`).join(","));
  // Whole turns say nothing; a tenth of a degree is under a kilometre for any place that turns.
  const turns = Object.entries(state.turns)
    .map(([id, degrees]) => [id, Math.round((((degrees % 360) + 360) % 360) * 10) / 10] as const)
    .filter(([, degrees]) => degrees > 0 && degrees < 360);
  if (turns.length) p.set("t", turns.map(([id, degrees]) => `${id}:${degrees}`).join(","));
  return p.toString();
}

const list = (value: string | null) => (value ? value.split(",").filter(Boolean) : []);

function positive(value: string | null, fallback: number): number {
  const n = Number(value);
  return value !== null && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Decode a link. Anything missing or malformed falls back to the default. */
export function decodeState(query: string): PlanState {
  const p = new URLSearchParams(query.replace(/^[#?]/, ""));
  const sp = p.get("sp");
  const spread: SpreadMode =
    sp === "exact" || sp === "auto" || sp === null ? (sp ?? "auto") : Number.isFinite(Number(sp)) && Number(sp) >= 0 ? Number(sp) : "auto";
  const placement = Number(p.get("p"));

  return {
    channel: p.get("ch") === "ptu" ? "ptu" : "live",
    system: p.get("s") || DEFAULT_STATE.system,
    originIds: list(p.get("o")),
    destIds: list(p.get("d")).slice(0, 3),
    spread,
    drift: positive(p.get("dr"), DEFAULT_STATE.drift),
    radius: positive(p.get("r"), DEFAULT_STATE.radius),
    placement: p.get("p") !== null && Number.isFinite(placement) ? Math.min(1, Math.max(0, placement)) : DEFAULT_STATE.placement,
    activeLeg: Math.max(0, Math.floor(Number(p.get("l")) || 0)),
    ship: p.has("sh") ? p.get("sh") || undefined : DEFAULT_STATE.ship,
    mode: p.get("m") === "dampen" ? "dampen" : "snare",
    dampen: positive(p.get("dm"), DEFAULT_STATE.dampen),
    targetDrive: p.get("td") || undefined,
    myDrive: p.get("md") || undefined,
    standoff: p.get("so") !== null && Number.isFinite(Number(p.get("so"))) && Number(p.get("so")) >= 0 ? Number(p.get("so")) : DEFAULT_STATE.standoff,
    careArmistice: p.get("ar") !== "0",
    careComms: p.get("cm") !== "0",
    fleet: list(p.get("f"))
      .map((entry): FleetEntry | undefined => {
        const role = CODE_ROLE[entry[0]];
        return role && entry[1] === "." ? { role, ship: entry.slice(2) || undefined } : undefined;
      })
      .filter((m): m is FleetEntry => !!m)
      .slice(0, MAX_FLEET),
    turns: Object.fromEntries(
      list(p.get("t"))
        .map((entry) => {
          const cut = entry.lastIndexOf(":");
          return [entry.slice(0, cut), Number(entry.slice(cut + 1))] as const;
        })
        .filter(([id, degrees]) => /^[\w-]+$/.test(id) && Number.isFinite(degrees) && degrees > 0 && degrees < 360)
        .slice(0, 12),
    ),
    weights: Object.fromEntries(
      list(p.get("w"))
        .map((entry) => {
          const cut = entry.lastIndexOf(":");
          return [entry.slice(0, cut), Number(entry.slice(cut + 1))] as const;
        })
        .filter(([id, weight]) => id.length > 0 && Number.isFinite(weight) && weight >= 0),
    ),
  };
}
