import { useEffect, useMemo, useRef, useState } from "react";

import { LocationPicker } from "./components/LocationPicker";
import { withMarkers } from "./lib/markers";
import { Crosshair, FolderOpen, Navigation, PanelRightClose, PanelRightOpen, Radar, Route as RouteIcon, ScanSearch, Ship, Timer } from "lucide-react";
import { MapView, type MapHandle } from "./components/MapView";
import { TabList, TabPanel, type TabDef } from "./components/Tabs";
import { SiteFooter } from "./components/SiteFooter";
import { formatDistance, formatDuration, formatKm, formatPercent } from "./lib/format";
import { speedAt, timeToReach } from "./lib/kinematics";
import {
  anchorWeights,
  approaches,
  ARRIVAL_SLACK,
  arrivalOf,
  bestCatches,
  evaluateLeg,
  monitoredAt,
  scanTargets,
  solvePlan,
  weightOf,
  spreadOf,
  type Catch,
  type SpreadMode,
} from "./lib/plan";
import { ownHold, planFleet, type FleetShip } from "./lib/fleet";
import { exportPlans, loadPlans, mergePlans, parsePlanFile, storePlans, upsertPlan, type SavedPlan } from "./lib/plans";
import { decodeState, DEFAULT_STATE, encodeState, MAX_FLEET, type FleetRole, type PlanState } from "./lib/share";
import { parseShowLocation } from "./lib/showlocation";
import type { Body, Universe } from "./lib/types";
import { carrierOf, holdWindow, lastStops, rotateZ, turned, turnFrom, turnIn, turnSpeed } from "./lib/spin";
import { add, distance, dot, length, sub } from "./lib/vec";

/** Shown on a first visit, so the page opens on a solved plan rather than a form. */
const EXAMPLE: Partial<PlanState> = {
  system: "Stanton",
  originIds: ["Stanton1", "RR_HUR_L1", "RR_HUR_L2"],
  destIds: ["RR_ARC_L1"],
};

const CATCH_ORDER: Body["kind"][] = ["planet", "city", "jump", "station", "lagrange", "moon", "surface", "other", "asteroid", "star"];


/** How much the scout marks down a spot inside a monitored zone. */
const WATCHED_PENALTY = 0.2;

/** A fleeing ship's speed in m/s, for "how long until they reach safety". */
const RUN_SPEED = 1000;

const SPREADS: { label: string; value: SpreadMode }[] = [
  { label: "Auto", value: "auto" },
  { label: "Exact", value: "exact" },
  { label: "20 km", value: 20_000 },
  { label: "50 km", value: 50_000 },
  { label: "100 km", value: 100_000 },
];

type SetupTab = "scout" | "route" | "ship" | "plans";
type ResultTab = "details" | "fly" | "verify" | "timing";

/** Left: what you set. */
const SETUP_TABS: TabDef<SetupTab>[] = [
  { id: "scout", label: "Scout", icon: Radar },
  { id: "route", label: "Route", icon: RouteIcon },
  { id: "ship", label: "Ship", icon: Ship },
  { id: "plans", label: "Plans", icon: FolderOpen },
];

/** Right: what you get. */
const RESULT_TABS: TabDef<ResultTab>[] = [
  { id: "details", label: "Spot", icon: Crosshair },
  { id: "fly", label: "Fly in", icon: Navigation },
  { id: "verify", label: "Verify", icon: ScanSearch },
  { id: "timing", label: "Timing", icon: Timer },
];

const ROLE_LABEL: Record<FleetShip["role"], string> = { lead: "Lead", split: "Split", hold: "Hold", backstop: "Backstop" };
const ROLE_OPTIONS: { value: FleetRole; label: string }[] = [
  { value: "split", label: "Split the routes" },
  { value: "hold", label: "Hold the catch" },
  { value: "backstop", label: "Backstop" },
];

const RESULTS_OPEN_KEY = "snares.results.open";

/**
 * How the workspace is arranged, from the width on hand.
 * wide: setup left, result right, map between. docked: one sidebar carries both, the map gets
 * the rest. stacked: phone, everything in a column.
 */
type LayoutMode = "wide" | "docked" | "stacked";
const WIDE_QUERY = "(min-width: 1600px)";
const STACKED_QUERY = "(max-width: 820px)";

function readLayout(): LayoutMode {
  if (window.matchMedia(STACKED_QUERY).matches) return "stacked";
  return window.matchMedia(WIDE_QUERY).matches ? "wide" : "docked";
}

function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(readLayout);
  useEffect(() => {
    const queries = [window.matchMedia(WIDE_QUERY), window.matchMedia(STACKED_QUERY)];
    const onChange = () => setMode(readLayout());
    for (const q of queries) q.addEventListener("change", onChange);
    return () => {
      for (const q of queries) q.removeEventListener("change", onChange);
    };
  }, []);
  return mode;
}

/** Imports are read whole into memory, so cap what gets read. */
const MAX_IMPORT_BYTES = 2_000_000;

/** Storage can throw on access alone when the browser blocks site data. */
function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function initialState(): PlanState {
  const hash = window.location.hash;
  return hash.length > 1 ? decodeState(hash) : { ...DEFAULT_STATE, ...EXAMPLE };
}

export function App() {
  const [universe, setUniverse] = useState<Universe>();
  const [error, setError] = useState<string>();
  const [state, setState] = useState<PlanState>(initialState);
  const [locationText, setLocationText] = useState("");
  const [startId, setStartId] = useState<string>();
  const [approachIndex, setApproachIndex] = useState(0);
  const [menu, setMenu] = useState<{ body: Body; x: number; y: number }>();
  const [copied, setCopied] = useState<string>();
  const [catches, setCatches] = useState<{ key: string; list: Catch[] }>();
  const [allChips, setAllChips] = useState(false);
  const [scan, setScan] = useState<{
    key: string;
    done: number;
    total: number;
    results: { destId: string; best: Catch; value: number; watched: boolean }[];
  }>();
  /** What a second press will wipe: "reset", or the id of a saved plan. */
  const [armed, setArmed] = useState<string>();
  const [plans, setPlans] = useState<SavedPlan[]>(() => loadPlans(browserStorage()));
  const [planName, setPlanName] = useState("");
  const [planNote, setPlanNote] = useState<string>();
  const importInput = useRef<HTMLInputElement>(null);
  const [setupTab, setSetupTab] = useState<SetupTab>("route");
  const [resultTab, setResultTab] = useState<ResultTab>("details");
  const [dockSide, setDockSide] = useState<"setup" | "result">("setup");
  const layout = useLayoutMode();
  const [resultsOpen, setResultsOpen] = useState(() => {
    try {
      return browserStorage()?.getItem(RESULTS_OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggleResults = () => {
    const next = !resultsOpen;
    setResultsOpen(next);
    try {
      browserStorage()?.setItem(RESULTS_OPEN_KEY, next ? "1" : "0");
    } catch {
      // A per-viewer convenience: without storage the panel just opens again next visit.
    }
  };
  const scanRun = useRef(0);
  const map = useRef<MapHandle>(null);

  useEffect(() => {
    const controller = new AbortController();
    const file = state.channel === "ptu" ? "universe-ptu.json" : "universe.json";
    setError(undefined);
    fetch(`${import.meta.env.BASE_URL}data/${file}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Universe) => setUniverse(data))
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [state.channel]);

  // The link is the plan: keep the address bar current without adding history.
  const encoded = encodeState(state);
  useEffect(() => {
    window.history.replaceState(null, "", `#${encoded}`);
  }, [encoded]);

  const system = universe?.systems.find((s) => s.name === state.system) ?? universe?.systems[0];
  // Orbital markers are not in the data file: they are derived from each body.
  // Places in a body's rotating zone sit where the plan's turn of that body puts them.
  const turnsKey = JSON.stringify(state.turns);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the turns' content, not the object
  const bodies = useMemo(() => withMarkers(turned(system?.bodies ?? [], state.turns)), [system, turnsKey]);
  const byId = useMemo(() => new Map(bodies.map((b) => [b.id, b])), [bodies]);

  // Not caring about armistice means planning as if no zone were there.
  const standoff = state.careArmistice ? state.standoff : 0;
  const legs = useMemo(
    () =>
      solvePlan({
        bodies,
        originIds: state.originIds,
        destIds: state.destIds,
        spread: state.spread,
        drift: state.drift,
        radius: state.radius,
        placement: state.placement,
        mode: state.mode,
        dampenRange: state.dampen,
        standoff,
      }),
    [bodies, state.originIds, state.destIds, state.spread, state.drift, state.radius, state.placement, state.mode, state.dampen, standoff],
  );
  const activeLeg = Math.min(state.activeLeg, Math.max(0, legs.length - 1));
  const baseLeg = legs[activeLeg];

  // The fleet: the lead as solved, plus whatever ships were added, each with a leg of its own.
  const interdictors = universe?.interdictors;
  const fleetPlan = useMemo(() => {
    if (!baseLeg) return undefined;
    const lead = { name: interdictors?.find((i) => i.id === state.ship)?.name ?? "Custom", radius: state.radius, dampen: state.dampen };
    const members = state.fleet.map((m) => {
      const found = interdictors?.find((i) => i.id === m.ship);
      return { role: m.role, device: found ? { name: found.name, radius: found.snareRadius, dampen: found.dampenRange } : lead };
    });
    return planFleet(baseLeg, lead, members, { bodies, placement: state.placement, standoff });
  }, [baseLeg, interdictors, state.ship, state.radius, state.dampen, state.fleet, bodies, state.placement, standoff]);
  const [shipIndex, setShipIndex] = useState(0);
  const ships = fleetPlan?.ships ?? [];
  // An idle ship has no spot to look at, so focus falls back to the lead.
  const focus = ships[shipIndex] && !ships[shipIndex].idle ? shipIndex : 0;
  const focusShip = ships[focus];
  // Everything below reads `leg`: with a fleet, that is the ship in focus.
  const leg = focusShip?.leg ?? baseLeg;
  const fleetOn = ships.length > 1;
  const others = useMemo(
    () => ships.map((sh, i) => ({ sh, i })).filter(({ sh, i }) => i !== focus && !sh.idle).map(({ sh, i }) => ({ leg: sh.leg, label: `${i + 1} ${ROLE_LABEL[sh.role].toUpperCase()}` })),
    [ships, focus],
  );
  const mapLegs = useMemo(() => legs.map((l, i) => (i === activeLeg && leg ? leg : l)), [legs, activeLeg, leg]);

  const start = startId ? byId.get(startId) : undefined;
  const routesIn = useMemo(
    () => (leg ? approaches(leg.snare, bodies, { from: start, limit: 4 }) : []),
    [leg, bodies, start],
  );
  const approach = routesIn[Math.min(approachIndex, routesIn.length - 1)];

  const player = useMemo(() => parseShowLocation(locationText), [locationText]);
  const playerCheck = useMemo(() => {
    if (!player || !leg) return undefined;
    const rel = sub(player, leg.dest.pos);
    const along = dot(rel, leg.direction);
    return {
      evaluation: evaluateLeg(leg, player),
      toSnare: distance(player, leg.snare),
      along: along - leg.distance,
      lateral: Math.sqrt(Math.max(0, length(rel) ** 2 - along ** 2)),
    };
  }, [player, leg]);

  const update = (patch: Partial<PlanState>) => setState((s) => ({ ...s, ...patch }));
  const origins = state.originIds.map((id) => byId.get(id)).filter((b): b is Body => !!b);
  const dests = state.destIds.map((id) => byId.get(id)).filter((b): b is Body => !!b);

  // Picked places that turn with a planet or moon, by the body carrying them.
  const pickedKey = `${state.originIds.join()}|${state.destIds.join()}`;
  const carriers = useMemo(() => {
    const found = new Map<string, { body: Body; places: Body[] }>();
    for (const id of pickedKey.split(/[|,]/)) {
      const place = byId.get(id);
      const body = place ? carrierOf(place, byId) : undefined;
      if (!place || !body) continue;
      const entry = found.get(body.id) ?? { body, places: [] };
      if (!entry.places.includes(place)) entry.places.push(place);
      found.set(body.id, entry);
    }
    return [...found.values()];
  }, [pickedKey, byId]);

  // How long the planned spot keeps its cover while those places turn away.
  const hold = useMemo(() => {
    const movers = carriers.filter((c) => c.places.some((p) => !p.on));
    const role = focusShip?.role;
    if (!leg || !system || movers.length === 0 || leg.routes.length === 0 || leg.evaluation.coverage <= 0) return undefined;
    if (role === "hold" || role === "backstop") return undefined;
    const ids = new Set(leg.routes.map((r) => r.id));
    const picked = new Set(pickedKey.split(/[|,]/));
    // Enough of the system to plot routes: what can block a jump, and what was picked.
    const few = system.bodies.filter((b) => picked.has(b.id) || b.kind === "star" || b.kind === "planet" || b.kind === "moon");
    // A ship at rest inside a body's rotating zone turns with it.
    const host = movers.map((c) => c.body).find((b) => b.grid && distance(leg.snare, b.pos) < b.grid);
    const coverAt = (seconds: number) => {
      const turns = { ...state.turns };
      for (const c of movers) turns[c.body.id] = (turns[c.body.id] ?? 0) + turnIn(c.body, seconds);
      const then = solvePlan({
        bodies: withMarkers(turned(few, turns)),
        originIds: state.originIds,
        destIds: state.destIds,
        spread: state.spread,
        drift: state.drift,
        radius: state.radius,
        placement: state.placement,
        mode: state.mode,
        dampenRange: state.dampen,
        standoff,
      })[activeLeg];
      if (!then) return 0;
      const spot = host ? add(host.pos, rotateZ(sub(leg.snare, host.pos), turnIn(host, seconds))) : leg.snare;
      const routes = then.routes.filter((r) => ids.has(r.id));
      return evaluateLeg({ ...then, routes, drops: then.drops.filter((d) => ids.has(d.id)) }, spot).coverage;
    };
    const limit = 3600;
    const window = holdWindow(coverAt, leg.evaluation.coverage * 0.98, 10, limit);
    const fastest = Math.max(...movers.flatMap((c) => c.places.filter((p) => !p.on).map((p) => turnSpeed(p, c.body))));
    return { seconds: window.before + window.after, always: window.before >= limit && window.after >= limit, host, fastest, movers };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state fields listed one by one
  }, [carriers, leg, system, focusShip?.role, pickedKey, turnsKey, state.spread, state.drift, state.radius, state.placement, state.mode, state.dampen, standoff, activeLeg]);
  const targetDrive = universe?.drives.find((d) => d.id === state.targetDrive);
  const myDrive = universe?.drives.find((d) => d.id === state.myDrive);
  const monitorReach = bodies.find((b) => b.monitored)?.monitored ?? 50_000_000;
  const ship = universe?.interdictors.find((i) => i.id === state.ship);
  const dampening = state.mode === "dampen";
  // Values typed over the ship's own are a custom fit, and say so.
  const stock = !!ship && (ship.snareRadius === 0 || ship.snareRadius === state.radius) && ship.dampenRange === state.dampen;

  // Suggestions belong to one destination, snare and spread; anything else is stale.
  // Hand-set weights travel in the link as `id:weight` pairs; that string is also their identity.
  const weightsKey = Object.entries(state.weights)
    .map(([id, weight]) => `${id}:${weight}`)
    .join(",");
  const weights = useMemo(() => anchorWeights(bodies, state.weights), [bodies, weightsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const deviceKey = `${system?.name}|${state.radius}|${state.spread}|${state.mode}|${state.dampen}|${weightsKey}|${standoff}|${state.careComms}`;
  const catchKey = `${deviceKey}|${state.destIds[0] ?? ""}`;
  const catchOptions = { radius: state.radius, spread: state.spread, mode: state.mode, dampenRange: state.dampen, weights, standoff, drift: state.drift };

  // A scan belongs to one system and one device; a change to either stops it.
  useEffect(() => () => void scanRun.current++, [deviceKey]);
  const scanned = scan?.key === deviceKey ? scan : undefined;
  const runScan = () => {
    const run = ++scanRun.current;
    const targets = scanTargets(bodies);
    const found: { destId: string; best: Catch; value: number; watched: boolean }[] = [];
    let next = 0;
    // In slices, so the page stays responsive and the list fills in as it goes.
    const slice = () => {
      if (run !== scanRun.current) return;
      const started = performance.now();
      while (next < targets.length && performance.now() - started < 40) {
        const [best] = bestCatches(bodies, targets[next], { ...catchOptions, limit: 1 });
        // Traffic on a route scales with both ends: busy origins into a busy stop.
        if (best) {
          // The spot sits a few hundred km from its destination at most, far
          // inside any monitored zone's reach, so the destination stands for it.
          // A jammer's dead zone is tens of km across, so there the planned spot itself decides.
          const dest = targets[next];
          const spot = dest.jammer
            ? solvePlan({
                bodies,
                originIds: best.originIds,
                destIds: [dest.id],
                spread: state.spread,
                drift: state.drift,
                radius: state.radius,
                placement: state.placement,
                mode: state.mode,
                dampenRange: state.dampen,
                standoff,
              })[0]?.snare
            : undefined;
          const watched = monitoredAt(spot ?? dest.pos, bodies).length > 0;
          // Watched space is a worse place to work, when that matters to you.
          const penalty = state.careComms && watched ? WATCHED_PENALTY : 1;
          found.push({ destId: targets[next].id, best, value: best.score * weightOf(targets[next], weights) * penalty, watched });
        }
        next++;
      }
      found.sort(
        (a, b) =>
          b.value - a.value ||
          b.best.originIds.length - a.best.originIds.length ||
          b.best.maxDistance - a.best.maxDistance ||
          b.best.margin - a.best.margin,
      );
      setScan({ key: deviceKey, done: next, total: targets.length, results: found.slice(0, 8) });
      if (next < targets.length) window.setTimeout(slice, 0);
    };
    slice();
  };
  const suggestions = catches?.key === catchKey ? catches.list : undefined;
  const findCatches = () => {
    const dest = byId.get(state.destIds[0] ?? "");
    if (!dest) return;
    const list = bestCatches(bodies, dest, catchOptions);
    setCatches({ key: catchKey, list });
    if (list[0]) update({ originIds: list[0].originIds, activeLeg: 0 });
  };
  const describeCatch = (c: Catch) => {
    const names = c.originIds
      .map((id) => byId.get(id))
      .filter((b): b is Body => !!b && b.kind !== "asteroid")
      // Lead with the places that carry the weight.
      .sort((a, b) => weightOf(b, weights) - weightOf(a, weights) || CATCH_ORDER.indexOf(a.kind) - CATCH_ORDER.indexOf(b.kind))
      .map((b) => b.name);
    const bases = c.originIds.length - c.major;
    return {
      weight: Math.round(c.score),
      title: `${c.major} location${c.major === 1 ? "" : "s"}${bases ? ` + ${bases} asteroid base${bases === 1 ? "" : "s"}` : ""}`,
      names: names.slice(0, 6).join(", ") + (names.length > 6 ? `, +${names.length - 6} more` : ""),
    };
  };

  // A first press arms a destructive button, a second within a few seconds goes through.
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(undefined), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  /** Drop everything worked out for the plan on screen, ready for a different one. */
  const clearWork = () => {
    scanRun.current++;
    setArmed(undefined);
    setLocationText("");
    setStartId(undefined);
    setApproachIndex(0);
    setShipIndex(0);
    setMenu(undefined);
    setCatches(undefined);
    setAllChips(false);
    setScan(undefined);
  };

  /** Back to a blank plan: every setting, weight, scan result and pasted position. Saved plans stay. */
  const resetAll = () => {
    if (armed !== "reset") {
      setArmed("reset");
      return;
    }
    clearWork();
    setState({ ...DEFAULT_STATE, channel: state.channel, system: system?.name ?? DEFAULT_STATE.system });
    setPlanName("");
    map.current?.fitSystem();
  };

  const commitPlans = (next: SavedPlan[], note: string) => {
    setPlans(next);
    setPlanNote(
      storePlans(browserStorage(), next) ? note : "This browser is blocking storage, so plans last only until the tab closes. Export to keep them.",
    );
  };

  const defaultPlanName =
    dests.length > 0
      ? `${origins.length} ${origins.length === 1 ? "origin" : "origins"} → ${dests.map((d) => d.name).join(" → ")}`
      : `${system?.name ?? "New"} plan`;

  const savePlan = () => {
    const name = planName.trim() || defaultPlanName;
    const next = upsertPlan(plans, name, state);
    commitPlans(next, next.length === plans.length ? `Updated "${name}".` : `Saved "${name}".`);
    setPlanName("");
  };

  const openPlan = (plan: SavedPlan) => {
    clearWork();
    setState(plan.state);
    setPlanNote(undefined);
  };

  const deletePlan = (plan: SavedPlan) => {
    if (armed !== plan.id) {
      setArmed(plan.id);
      return;
    }
    setArmed(undefined);
    commitPlans(plans.filter((p) => p.id !== plan.id), `Deleted "${plan.name}".`);
  };

  const exportAll = () => {
    const now = new Date();
    const list = plans.length > 0 ? plans : [{ name: defaultPlanName, savedAt: now.toISOString(), state }];
    const url = URL.createObjectURL(new Blob([exportPlans(list, now)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `snares-plans-${now.toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setPlanNote(`Exported ${list.length} ${list.length === 1 ? "plan" : "plans"}.`);
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("That file is too large to be a plan file.");
      const incoming = parsePlanFile(await file.text());
      const next = mergePlans(plans, incoming);
      const added = next.length - plans.length;
      commitPlans(next, added > 0 ? `Imported ${added} ${added === 1 ? "plan" : "plans"}.` : "Those plans are already saved here.");
    } catch (err) {
      setPlanNote(`Import failed. ${err instanceof Error ? err.message : ""}`.trim());
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  };

  const copy = (label: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied((c) => (c === label ? undefined : c)), 1400);
    });
  };

  if (error) return <div className="splash">Could not load game data: {error}</div>;
  if (!universe || !system) return <div className="splash">Loading game data…</div>;

  const blockedBy = new Map<string, string[]>();
  for (const b of leg?.blocked ?? []) blockedBy.set(b.routeId, [...(blockedBy.get(b.routeId) ?? []), b.by.name]);
  // With a fleet the verdict is the fleet's: each route counts its best net.
  const coverage = (fleetOn ? fleetPlan?.coverage : leg?.evaluation.coverage) ?? 0;
  const covered = fleetOn ? coverage >= 0.999 : !!leg?.corridor.feasible;
  const status = !baseLeg || baseLeg.routes.length === 0 ? "none" : covered ? "full" : coverage > 0 ? "partial" : "miss";
  const nets = ships.filter((sh) => !sh.idle && sh.role !== "hold").length;
  const missed = fleetOn ? (fleetPlan?.routes.filter((r) => r.coverage < 0.999) ?? []) : [];
  // What this view is about: the focused ship's own mode, which for a holder is dampening.
  const spotDampening = leg?.mode === "dampen";
  const own = leg && leg.mode === "snare" && focusShip && leg.routes.length > 0 ? ownHold(leg, focusShip.device.dampen) : undefined;
  const addShip = (role: FleetRole) => {
    if (state.fleet.length < MAX_FLEET) update({ fleet: [...state.fleet, { role }] });
  };

  // The three blocks every layout arranges: what you set, the verdict, and what you get.
  const setupContent = (
    <>
          {setupTab === "scout" && (
            <>
        <section>
          <h2>Scout {system.name}</h2>
          <button className="catch-go" onClick={runScan} disabled={!!scanned && scanned.done < scanned.total}>
            {scanned && scanned.done < scanned.total
              ? `Scanning… ${scanned.done} / ${scanned.total}`
              : `Find the best ${dampening ? "dampening" : "snare"} spots in ${system.name}`}
          </button>
          <p className="note">
            Checks every destination in the system and ranks the spots where one {dampening ? "dampener" : "snare"} takes
            the most traffic. Uses your ship and departure spread.
          </p>
          <p className="note">
            Weighting. Hot: city planet 10, refinery station 9, full-service hub 8, gateway into a live system 7.
            Lesser: other serviced station 4, planet 3, moon 2. Cold: gateway to a system not in the game 0.5, comm array
            or asteroid base 0.25. A spot scores its origins' weights times the destination's.
          </p>
          <label className="field-label" title="Raise a place for an event or hotspot, or set 0 to ignore it">
            Priorities
          </label>
          {Object.keys(state.weights).length === 0 && (
            <p className="note first">
              Event on, or a hotspot you want to hunt? Give a place its own weight and both searches favour spots that catch
              traffic from it. 0 ignores a place.
            </p>
          )}
          {Object.entries(state.weights).map(([id, weight]) => {
            const body = byId.get(id);
            if (!body) return null;
            return (
              <div key={id} className="dest-row weight-row">
                <span className={`dot kind-${body.kind}`} />
                <span className="dest-name">
                  {body.name}
                  <span className="stock"> normally {body.weight ?? 1}</span>
                </span>
                <input
                  type="number"
                  min={0}
                  step={5}
                  aria-label={`Weight for ${body.name}`}
                  value={weight}
                  onChange={(e) =>
                    update({ weights: { ...state.weights, [id]: Math.max(0, Number(e.target.value) || 0) } })
                  }
                />
                <button
                  className="x-button"
                  title="Back to normal weight"
                  onClick={() => update({ weights: Object.fromEntries(Object.entries(state.weights).filter(([k]) => k !== id)) })}
                >
                  ×
                </button>
              </div>
            );
          })}
          <LocationPicker
            bodies={bodies}
            exclude={Object.keys(state.weights)}
            placeholder="Prioritise a place…"
            onPick={(b) => update({ weights: { ...state.weights, [b.id]: Math.max(50, (b.weight ?? 1) * 5) } })}
          />

          {scanned && scanned.done >= scanned.total && scanned.results.length === 0 && (
            <p className="warn">Nothing in {system.name} can be covered with this ship.</p>
          )}
          {scanned && scanned.results.length > 0 && (
            <ol className="approaches">
              {scanned.results.map(({ destId, best, watched }, index) => {
                const dest = byId.get(destId);
                if (!dest) return null;
                const text = describeCatch(best);
                const on =
                  state.destIds.length === 1 &&
                  state.destIds[0] === destId &&
                  best.originIds.length === state.originIds.length &&
                  best.originIds.every((id) => state.originIds.includes(id));
                return (
                  <li key={destId}>
                    <button
                      className={on ? "approach on" : "approach"}
                      onClick={() => update({ destIds: [destId], originIds: best.originIds, activeLeg: 0 })}
                    >
                      <span className="approach-line">
                        <span className="rank">{index + 1}</span>
                        {dest.name}
                        {state.careComms && <span className={watched ? "tag watched" : "tag dark"}>{watched ? "watched" : "dark"}</span>}
                        <span className="count">weight {Math.round(scanned.results[index].value)}</span>
                      </span>
                      <span className="approach-detail">
                        {text.title}: {text.names}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
            </>
          )}
          {setupTab === "route" && (
            <>
        <section>
          <h2>Route</h2>
          <label className="field-label">Targets come from</label>
          <div className="chips">
            {Array.isArray(origins) &&
              (allChips || origins.length <= 10 ? origins : origins.slice(0, 8)).map((o) => (
                <button
                  key={o.id}
                  className="chip"
                  title="Remove"
                  onClick={() => update({ originIds: state.originIds.filter((id) => id !== o.id) })}
                >
                  <span className={`dot kind-${o.kind}`} />
                  {o.name}
                  <span className="x">×</span>
                </button>
              ))}
            {origins.length > 10 && (
              <button className="chip more" onClick={() => setAllChips((v) => !v)}>
                {allChips ? "show fewer" : `+${origins.length - 8} more`}
              </button>
            )}
          </div>
          <LocationPicker
            bodies={bodies}
            exclude={[...state.originIds, state.destIds[0] ?? ""]}
            placeholder="Add an origin…"
            onPick={(b) => update({ originIds: [...state.originIds, b.id] })}
          />
          <div className="quick">
            <button
              onClick={() =>
                update({
                  originIds: [
                    ...new Set([
                      ...state.originIds,
                      ...bodies.filter((b) => b.kind === "planet" && b.id !== state.destIds[0]).map((b) => b.id),
                    ]),
                  ],
                })
              }
            >
              + planets
            </button>
            <button
              onClick={() =>
                update({
                  originIds: [
                    ...new Set([
                      ...state.originIds,
                      ...bodies.filter((b) => b.kind === "jump" && b.id !== state.destIds[0]).map((b) => b.id),
                    ]),
                  ],
                })
              }
            >
              + jump points
            </button>
            <button onClick={() => update({ originIds: [] })} disabled={state.originIds.length === 0}>
              clear
            </button>
          </div>

          <label className="field-label">Heading to</label>
          {Array.isArray(dests) &&
            dests.map((d, index) => (
              <div key={`${d.id}-${index}`} className="dest-row">
                <span className="leg-no">{dests.length > 1 ? index + 1 : "→"}</span>
                <span className={`dot kind-${d.kind}`} />
                <span className="dest-name">{d.name}</span>
                {index < dests.length - 1 && <span className="via">route change</span>}
                <button
                  className="x-button"
                  title="Remove"
                  onClick={() => update({ destIds: state.destIds.filter((_, i) => i !== index), activeLeg: 0 })}
                >
                  ×
                </button>
              </div>
            ))}
          {dests.length < 3 && (
            <LocationPicker
              bodies={bodies}
              exclude={[state.destIds[state.destIds.length - 1] ?? ""]}
              placeholder={dests.length === 0 ? "Pick the destination…" : "Then they re-route to… (optional)"}
              onPick={(b) => update({ destIds: [...state.destIds, b.id] })}
            />
          )}
          {dests.length > 1 && (
            <div className="row">
              <label htmlFor="drift">Drift after a drop-out</label>
              <span className="unit-input">
                <input
                  id="drift"
                  type="number"
                  min={0}
                  step={10}
                  value={Math.round(state.drift / 1000)}
                  onChange={(e) => update({ drift: Math.max(0, Number(e.target.value) || 0) * 1000 })}
                />
                km
              </span>
            </div>
          )}

          {Array.isArray(carriers) &&
            carriers.map(({ body, places }) => {
              const inSpace = places.filter((p) => !p.on);
              const onGround = places.filter((p) => p.on);
              const degrees = Math.round((((state.turns[body.id] ?? 0) % 360) + 360) % 360);
              const setTurn = (value: number) => update({ turns: { ...state.turns, [body.id]: value } });
              const stopsFor = places.find((p) => dests.includes(p));
              const stops = stopsFor ? lastStops(stopsFor, body, bodies) : [];
              return (
                <div className="turning" key={body.id}>
                  <h3>{body.name} turns</h3>
                  <p className="note">
                    Once every {formatDuration((body.spin ?? 0) * 3600)}, and {places.map((p) => p.name).join(", ")} with it
                    {inSpace.length > 0 && `: ${inSpace.map((p) => `${p.name} at ${formatDistance(turnSpeed(p, body) * 60)} a minute`).join(", ")}`}. The game
                    files give the rate, not where the turn is right now.
                  </p>
                  {inSpace.length > 0 && (
                    <>
                      <div className="row">
                        <label htmlFor={`turn-${body.id}`}>Turn</label>
                        <input
                          id={`turn-${body.id}`}
                          type="range"
                          min={0}
                          max={359}
                          step={1}
                          value={degrees}
                          onChange={(e) => setTurn(Number(e.target.value))}
                        />
                        <span className="turn-value">{degrees}°</span>
                      </div>
                      <input
                        className="turn-paste"
                        type="text"
                        aria-label={`Paste /showlocation while at ${inSpace[0].name}`}
                        placeholder={`At ${inSpace[0].name}? Paste /showlocation to set the turn`}
                        onChange={(e) => {
                          const at = parseShowLocation(e.target.value);
                          const found = at ? turnFrom(at, inSpace[0], body) : undefined;
                          if (found !== undefined) setTurn(found);
                        }}
                      />
                    </>
                  )}
                  {onGround.length > 0 && (
                    <p className="note">
                      {onGround.map((p) => p.name).join(", ")} {onGround.length === 1 ? "is" : "are"} on the ground. The plan aims at {body.name}'s
                      centre; real traffic aims at the place itself, up to {formatDistance(Math.max(...onGround.map((p) => length(p.local ?? [0, 0, 0]))))} off
                      that line near {body.name} and moving {formatDistance(Math.max(...onGround.map((p) => turnSpeed(p, body))) * 60)} a minute. So a
                      spot close to {body.name} is a rough one. For a spot that holds, catch at the marker the jump stops at.
                    </p>
                  )}
                  {stopsFor && stops.length > 0 && (
                    <>
                      <p className="note">When {stopsFor.name} is on the far side, the jump stops at the nearest orbital marker first:</p>
                      <ul className="stops">
                        {stops.map(({ marker, share }) => (
                          <li key={marker.id}>
                            <span className="dot kind-marker" />
                            <span className="stop-name">{marker.name}</span>
                            <span className="stop-share">{share >= 0.995 ? "always" : `${formatPercent(share)} of a turn`}</span>
                            <button type="button" className="linkish" onClick={() => update({ destIds: [marker.id], activeLeg: 0 })}>
                              catch it there
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              );
            })}

          {dests.length > 0 && (
            <div className="catch">
              <button className="catch-go" onClick={findCatches}>
                Find the best catch into {dests[0].name}
              </button>
              <p className="note">
                Don't know where targets come from? This picks the origins for you: the largest sets of places a single
                {dampening ? " dampener position holds" : " snare position covers"} in full.
              </p>
              {suggestions && suggestions.length === 0 && (
                <p className="warn">No clear route into {dests[0].name} can be covered with this {dampening ? "dampener" : "snare"}.</p>
              )}
              {suggestions && suggestions.length > 0 && (
                <ol className="approaches">
                  {suggestions.map((c, index) => {
                    const text = describeCatch(c);
                    const on =
                      c.originIds.length === state.originIds.length && c.originIds.every((id) => state.originIds.includes(id));
                    return (
                      <li key={index}>
                        <button
                          className={on ? "approach on" : "approach"}
                          onClick={() => update({ originIds: c.originIds, activeLeg: 0 })}
                        >
                          <span className="approach-line">
                            {text.title}
                            <span className="count">weight {text.weight}</span>
                          </span>
                          <span className="approach-detail">
                            {text.names} ·{" "}
                            {dampening ? (
                              <>
                                <b>{formatDistance(c.margin)}</b> of range to spare
                              </>
                            ) : (
                              <>
                                snare up to <b>{formatDistance(c.maxDistance)}</b> out
                              </>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}

          <label className="field-label" title="How far from an origin's centre a target may start its jump">
            Departure spread
          </label>
          <div className="segmented">
            {SPREADS.map((option) => (
              <button
                key={option.label}
                className={state.spread === option.value ? "on" : undefined}
                onClick={() => update({ spread: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="note">
            {state.spread === "auto"
              ? "Auto: anywhere in orbit around a planet or moon (cities and outposts count as their body), within 10 km of a station."
              : state.spread === "exact"
                ? "Exact: every target leaves from the dead centre of its origin."
                : `Targets leave from within ${formatDistance(state.spread)} of each origin.`}
          </p>
        </section>
            </>
          )}
          {setupTab === "ship" && (
            <>
        <section>
          <h2>Your ship</h2>
          <div className="row first">
            <label htmlFor="ship">Interdictor</label>
            <select
              id="ship"
              value={state.ship ?? ""}
              onChange={(e) => {
                const picked = universe.interdictors.find((i) => i.id === e.target.value);
                if (!picked) return update({ ship: undefined });
                update({
                  ship: picked.id,
                  radius: picked.snareRadius || state.radius,
                  dampen: picked.dampenRange,
                  // A ship with no snare can only dampen.
                  mode: picked.snareRadius ? state.mode : "dampen",
                  myDrive: universe.drives.some((d) => d.id === picked.drive) ? picked.drive : state.myDrive,
                });
              }}
            >
              {Array.isArray(universe.interdictors) &&
                universe.interdictors.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} · {i.snareRadius ? `snare ${formatDistance(i.snareRadius)}` : `dampener ${formatDistance(i.dampenRange)}`}
                  </option>
                ))}
              <option value="">Custom</option>
            </select>
          </div>

          <label className="field-label">Plan for</label>
          <div className="segmented mode">
            <button
              className={!dampening ? "on" : undefined}
              disabled={!!ship && ship.snareRadius === 0}
              title={ship && ship.snareRadius === 0 ? `${ship.name} has no snare` : undefined}
              onClick={() => update({ mode: "snare" })}
            >
              <span className="mode-name">Snare</span>
              <span className="mode-what">pull from quantum</span>
            </button>
            <button className={dampening ? "on" : undefined} onClick={() => update({ mode: "dampen", activeLeg: activeLeg })}>
              <span className="mode-name">Dampen</span>
              <span className="mode-what">hold at arrival</span>
            </button>
          </div>
          <p className="note">
            {dampening
              ? "A dampener pulls nothing out of quantum. It stops ships inside its range from spooling, so the plan is where to wait so targets drop out next to you and cannot leave."
              : "A snare pulls every ship whose quantum path crosses its sphere out of quantum, so the plan is where on the routes to wait."}
          </p>

          {!(ship && ship.snareRadius === 0) && (
            <div className="row">
              <label htmlFor="radius">Snare radius</label>
              <span className="unit-input">
                <input
                  id="radius"
                  type="number"
                  min={0.1}
                  step={1}
                  value={Math.round(state.radius / 100) / 10}
                  onChange={(e) => update({ radius: Math.max(0.1, Number(e.target.value) || 0) * 1000 })}
                />
                km
              </span>
            </div>
          )}
          <div className="row">
            <label htmlFor="dampen">Dampener range</label>
            <span className="unit-input">
              <input
                id="dampen"
                type="number"
                min={0.1}
                step={0.25}
                value={Math.round(state.dampen / 10) / 100}
                onChange={(e) => update({ dampen: Math.max(0.1, Number(e.target.value) || 0) * 1000 })}
              />
              km
            </span>
          </div>
          {ship && (
            <p className="note">
              <span className="device">{ship.device}</span>
              {stock ? " as the game files have it" : " — values changed from the game files"}: {ship.chargeTime}s to charge,{" "}
              {ship.dischargeTime}s to discharge.
              {ship.snareRadius === 0 && " No snare: it cannot pull ships out of quantum."}
            </p>
          )}
        </section>
        <section>
          <h2>Fleet</h2>
          <p className="note first">
            More than one ship? Add them and each gets its own spot. Ship 1 is yours, above.
          </p>
          {state.fleet.map((member, i) => (
            <div key={i} className="fleet-row">
              <span className="fleet-n">{i + 2}</span>
              <select
                aria-label={`Ship ${i + 2} role`}
                value={member.role}
                onChange={(e) => update({ fleet: state.fleet.map((m, j) => (j === i ? { ...m, role: e.target.value as FleetRole } : m)) })}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Ship ${i + 2} interdictor`}
                value={member.ship ?? ""}
                onChange={(e) => update({ fleet: state.fleet.map((m, j) => (j === i ? { ...m, ship: e.target.value || undefined } : m)) })}
              >
                <option value="">Same as ship 1</option>
                {Array.isArray(universe.interdictors) &&
                  universe.interdictors.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
              <button className="ghost icon" aria-label={`Remove ship ${i + 2}`} onClick={() => update({ fleet: state.fleet.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}
          <div className="fleet-add">
            {ROLE_OPTIONS.map((r) => (
              <button key={r.value} className="chip" disabled={state.fleet.length >= MAX_FLEET} onClick={() => addShip(r.value)}>
                + {r.label.toLowerCase()}
              </button>
            ))}
          </div>
          <p className="note">
            <b>Split</b>: another net, when one spot cannot cover every route. <b>Hold</b>: a dampener where a net's catch
            comes to rest, so it cannot spool away. <b>Backstop</b>: a second net behind another, nearer the destination.
            {dampening ? " While dampening, every extra ship is another dampener on the arrivals." : ""}
          </p>
        </section>
        <section>
          <h2>Law</h2>
          <label className="check-row">
            <input type="checkbox" checked={state.careArmistice} onChange={(e) => update({ careArmistice: e.target.checked })} />
            <span>
              Keep clear of armistice zones
              <small>A target pulled out beside one just flies in and is safe.</small>
            </span>
          </label>
          {state.careArmistice && (
            <div className="row">
              <label htmlFor="standoff">Stand-off from the zone</label>
              <span className="unit-input">
                <input
                  id="standoff"
                  type="number"
                  min={0}
                  step={5}
                  value={Math.round(state.standoff / 1000)}
                  onChange={(e) => update({ standoff: Math.max(0, Number(e.target.value) || 0) * 1000 })}
                />
                km
              </span>
            </div>
          )}
          <label className="check-row">
            <input type="checkbox" checked={state.careComms} onChange={(e) => update({ careComms: e.target.checked })} />
            <span>
              Avoid monitored space
              <small>
                Comm arrays and stations see crime within {formatDistance(monitorReach)}, except inside a jammer's dead zone (Grim HEX).
                The scout marks watched spots down.
              </small>
            </span>
          </label>
        </section>
            </>
          )}
          {setupTab === "plans" && (
            <>
        <section>
          <h2>Plans</h2>
          <div className="plan-save">
            <input
              type="text"
              value={planName}
              maxLength={60}
              placeholder={defaultPlanName}
              aria-label="Plan name"
              onChange={(e) => setPlanName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") savePlan();
              }}
            />
            <button onClick={savePlan}>Save</button>
          </div>
          {plans.length > 0 && (
            <ul className="plans">
              {plans.map((plan) => (
                <li key={plan.id} className={encodeState(plan.state) === encoded ? "on" : undefined}>
                  <button className="plan-open" onClick={() => openPlan(plan)} title={`Open "${plan.name}"`}>
                    <span className="plan-name">{plan.name}</span>
                    <span className="plan-meta">
                      {plan.state.system} · {plan.state.mode === "dampen" ? "dampen" : "snare"} · {plan.savedAt.slice(0, 10)}
                    </span>
                  </button>
                  <button
                    className={armed === plan.id ? "ghost plan-delete armed" : "ghost plan-delete"}
                    onClick={() => deletePlan(plan)}
                    aria-label={`Delete "${plan.name}"`}
                  >
                    {armed === plan.id ? "Sure?" : "×"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="plan-io">
            <button className="ghost" onClick={exportAll}>
              {plans.length > 0 ? "Export all (JSON)" : "Export this plan (JSON)"}
            </button>
            <button className="ghost" onClick={() => importInput.current?.click()}>
              Import
            </button>
            <input
              ref={importInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => void importFile(e.target.files?.[0])}
            />
          </div>
          <p className="note" role="status">
            {planNote ?? "Saved plans live in this browser only. Export to back them up or hand them to someone else."}
          </p>
        </section>
            </>
          )}
    </>
  );
  const verdictHead = (
        <section className={`verdict-head status-${status}`}>
          <h2>Position</h2>
          {legs.length > 1 && (
            <div className="segmented legs">
              {legs.map((l, index) => (
                <button key={l.dest.id + index} className={index === activeLeg ? "on" : undefined} onClick={() => update({ activeLeg: index })}>
                  Leg {index + 1} → {l.dest.name}
                </button>
              ))}
            </div>
          )}
          {status === "none" && <p className="empty">Pick at least one origin and a destination.</p>}
          {leg && status !== "none" && (
            <>
              <div className="verdict">
                <span className="verdict-value">{formatPercent(coverage)}</span>
                <span className="verdict-text">
                  {fleetOn
                    ? `of ${dampening ? "arrivals held" : "routes covered"} by ${nets} ${nets === 1 ? "ship" : "ships"}${status === "full" ? ", in full" : ""}`
                    : dampening
                    ? status === "full"
                      ? "of arrivals held, in full"
                      : "held — no spot reaches every arrival point"
                    : status === "full"
                      ? "of routes covered, in full"
                      : status === "partial"
                        ? "covered — no spot catches every route"
                        : "covered — these routes cannot be snared here"}
                </span>
              </div>
              {status !== "full" && !fleetOn && dampening && (
                <p className="warn">
                  These routes drop out farther apart than the dampener reaches ({formatDistance(state.dampen)}) around{" "}
                  {leg.dest.name}'s arrival sphere ({formatDistance(arrivalOf(leg.dest))}). Showing the spot that holds the most.
                  Cover fewer origins, or{" "}
                  <button className="linkish" onClick={() => addShip("split")}>
                    add a second ship
                  </button>
                  .
                </p>
              )}
              {status !== "full" && !fleetOn && !dampening && (
                <p className="warn">
                  The routes spread wider than the snare before they clear {leg.dest.name}'s arrival radius (
                  {formatDistance(arrivalOf(leg.dest))}). Showing the spot that catches the most. Drop an outlying origin,
                  tighten the departure spread, or{" "}
                  <button className="linkish" onClick={() => addShip("split")}>
                    add a ship to split the routes
                  </button>
                  .
                </p>
              )}
              {fleetOn && missed.length > 0 && (
                <p className="warn">
                  Not covered in full by any ship: {missed.slice(0, 4).map((r) => r.label).join(", ")}
                  {missed.length > 4 ? ` and ${missed.length - 4} more` : ""}. Add a ship to split the routes, or drop an origin.
                </p>
              )}
              {fleetOn && (
                <>
                  <div className="segmented ships" role="group" aria-label="Ship in focus">
                    {ships.map((sh, i) => (
                      <button
                        key={i}
                        className={i === focus ? "on" : undefined}
                        disabled={sh.idle}
                        title={sh.idle ? sh.note : `${sh.device.name}: ${ROLE_LABEL[sh.role].toLowerCase()}`}
                        onClick={() => setShipIndex(i)}
                      >
                        <span className="mode-name">Ship {i + 1}</span>
                        <span className="mode-what">{ROLE_LABEL[sh.role]}</span>
                      </button>
                    ))}
                  </div>
                  {focusShip && (
                    <p className="note">
                      Ship {focus + 1}, {focusShip.device.name}:{" "}
                      {focusShip.role === "hold"
                        ? `holds what ship ${(focusShip.supports ?? 0) + 1} pulls out, ${formatPercent(leg.evaluation.coverage)} of it.`
                        : focusShip.role === "backstop"
                          ? `second net behind ship ${(focusShip.supports ?? 0) + 1}, on the same ${leg.routes.length} ${leg.routes.length === 1 ? "route" : "routes"}.`
                          : `covers ${leg.routes.length} of ${baseLeg?.routes.length ?? 0} routes${leg.corridor.feasible ? " in full" : ""}.`}
                      {focusShip.note ? ` ${focusShip.note}` : ""}
                    </p>
                  )}
                  {ships.some((sh) => sh.idle) && (
                    <p className="note">
                      {ships
                        .map((sh, i) => (sh.idle ? `Ship ${i + 1} stands by: ${sh.note}` : ""))
                        .filter(Boolean)
                        .join(" ")}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </section>
  );
  // Built only when there is a position: every tab in here reads the active leg.
  const resultContent = leg && status !== "none" ? (
    <>
                  {resultTab === "details" && (
                    <section>
              <dl className="facts">
                <dt>From {leg.dest.name}</dt>
                <dd>{formatDistance(leg.distance)}</dd>
                <dt>Room for error</dt>
                <dd className={leg.evaluation.margin < 0 ? "bad" : undefined}>
                  {leg.evaluation.margin >= 0 ? `±${formatDistance(leg.evaluation.margin)}` : "none"}
                </dd>
                <dt>Coordinates</dt>
                <dd>
                  <button
                    className="coords"
                    title="Copy as x y z in metres"
                    onClick={() => copy("coords", leg.snare.map((v) => Math.round(v)).join(" "))}
                  >
                    {copied === "coords" ? "copied" : `${leg.snare.map(formatKm).join(", ")} km`}
                  </button>
                </dd>
              </dl>

              {(state.careArmistice || state.careComms) && (
                <div className="law">
                  {state.careArmistice &&
                    (leg.security.armistice ? (
                      <p className={leg.security.armistice.gap < state.standoff ? "law-line bad" : "law-line good"}>
                        <b>Armistice</b>
                        {leg.security.armistice.gap < 0
                          ? `Overlaps ${leg.security.armistice.body.name}'s zone by ${formatDistance(-leg.security.armistice.gap)}. Targets land inside it.`
                          : `${leg.security.armistice.body.name}'s zone is ${formatDistance(leg.security.armistice.gap)} from ${
                              spotDampening ? "you" : "the snare's edge"
                            }: about ${formatDuration(leg.security.armistice.gap / RUN_SPEED)} for a target running at ${RUN_SPEED} m/s.`}
                        {leg.security.armistice.gap >= 0 && leg.security.armistice.gap < state.standoff && " Closer than your stand-off."}
                      </p>
                    ) : (
                      <p className="law-line good">
                        <b>Armistice</b>No armistice zone in open space in {system.name}.
                      </p>
                    ))}
                  {state.careComms &&
                    (leg.security.jammedBy.length > 0 ? (
                      <p className="law-line good">
                        <b>Dark</b>
                        Inside {leg.security.jammedBy[0].name}'s jammer dead zone ({formatDistance(leg.security.jammedBy[0].jammer ?? 0)}).
                        Comm arrays do not see crime here.
                      </p>
                    ) : leg.security.monitoredBy.length > 0 ? (
                      <p className="law-line warnish">
                        <b>Watched</b>
                        Inside the monitored zone of {leg.security.monitoredBy.slice(0, 3).map((b) => b.name).join(", ")}
                        {leg.security.monitoredBy.length > 3 ? ` and ${leg.security.monitoredBy.length - 3} more` : ""}. Crime here is
                        reported unless the comm array is down.
                        {leg.dest.jammer
                          ? ` ${leg.dest.name} jams monitoring within ${formatDistance(leg.dest.jammer)}; this spot is ${formatDistance(
                              Math.max(0, distance(leg.snare, leg.dest.pos) - leg.dest.jammer),
                            )} outside that.`
                          : ""}
                      </p>
                    ) : (
                      <p className="law-line good">
                        <b>Dark</b>No monitored zone reaches this spot.
                      </p>
                    ))}
                </div>
              )}

              {own && focusShip && (
                <div className="law">
                  <p className={own.gap === 0 ? "law-line good" : "law-line warnish"}>
                    <b>Dampener</b>
                    {own.gap === 0
                      ? `Yours (${formatDistance(focusShip.device.dampen)}) reaches past the snare's edge: a pulled target cannot spool again.`
                      : `Pulled targets stop about ${formatDistance(leg.reach)} from you, ${formatDistance(own.gap)} beyond your ${formatDistance(
                          focusShip.device.dampen,
                        )} dampener. Close that gap before they spool again, or post a holding ship there.`}
                    {own.gap > 0 && !ships.some((sh) => sh.role === "hold" && sh.supports === focus) && state.fleet.length < MAX_FLEET && (
                      <>
                        {" "}
                        <button className="linkish" onClick={() => addShip("hold")}>
                          Add a holding ship
                        </button>
                      </>
                    )}
                  </p>
                </div>
              )}

              {hold && (
                <div className="law">
                  <p className={hold.always || hold.seconds >= 600 ? "law-line good" : "law-line warnish"}>
                    <b>Holds</b>
                    {hold.always
                      ? `${hold.movers.flatMap((c) => c.places.filter((p) => !p.on).map((p) => p.name)).join(", ")} turn${hold.movers.length === 1 && hold.movers[0].places.length === 1 ? "s" : ""} with ${hold.movers.map((c) => c.body.name).join(", ")}, but this spot keeps its cover through it.`
                      : `About ${formatDuration(hold.seconds)} around this moment, then the turn carries the lines off the spot (${hold.movers
                          .flatMap((c) => c.places.filter((p) => !p.on).map((p) => p.name))
                          .join(", ")} at up to ${formatDistance(hold.fastest * 60)} a minute). Set the turn again and re-plan.`}
                    {hold.host && ` Parked here you are inside ${hold.host.name}'s rotating zone and turn with it; that is counted.`}
                  </p>
                </div>
              )}

              {leg.corridor.feasible && !spotDampening && (!focusShip || focusShip.role === "lead" || focusShip.role === "split") && (
                <div className="slider">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.005}
                    value={state.placement}
                    aria-label="Where in the corridor to sit"
                    onChange={(e) => update({ placement: Number(e.target.value) })}
                  />
                  <div className="slider-ends">
                    <span>{formatDistance(leg.corridor.minDistance)}</span>
                    <span>{formatDistance(leg.corridor.maxDistance)}</span>
                  </div>
                  <p className="note">
                    Anywhere on this stretch catches every route. Closer to {leg.dest.name} leaves more room for error; farther
                    out catches targets earlier.
                  </p>
                </div>
              )}

              <div className="table-scroll">
              <table className="routes">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th title={spotDampening ? "Distance from you to where this route drops out" : "Distance from the snare to the route's centre line"}>
                      {spotDampening ? "Drops at" : "Off line"}
                    </th>
                    <th title="Width of the route's possible paths at that point">Width</th>
                    <th>Cover</th>
                  </tr>
                </thead>
                <tbody>
                  {leg.routes.map((route, index) => {
                    const r = leg.evaluation.routes[index];
                    const blocks = blockedBy.get(route.id);
                    return (
                      <tr key={route.id} className={r.coverage >= 1 ? undefined : "short"}>
                        <td>
                          {route.label}
                          {blocks && (
                            <span className="blocked" title={`The straight line passes through ${blocks.join(", ")}; the game will not plot this jump directly.`}>
                              blocked by {blocks.join(", ")}
                            </span>
                          )}
                          {route.via && route.via.length > 0 && (
                            <span
                              className="rerouted"
                              title={`A body is in the way, so the game plots this jump through ${route.via.map((v) => v.name).join(", then ")}. The target drops out there and spools again.`}
                            >
                              stops at {route.via.length === 1 ? "the marker" : `${route.via.length} markers`} first
                              {leg.index === 0 && (
                                <>
                                  {" · "}
                                  <button
                                    type="button"
                                    className="linkish"
                                    title={`Plan the catch at ${route.via[0].name} instead: everything on this plan that stops there first.`}
                                    onClick={() => {
                                      const stop = route.via?.[0]?.id;
                                      if (!stop) return;
                                      update({
                                        originIds: leg.routes.filter((r) => r.via?.[0]?.id === stop).map((r) => r.id),
                                        destIds: [stop],
                                        activeLeg: 0,
                                      });
                                    }}
                                  >
                                    catch it there
                                  </button>
                                </>
                              )}
                            </span>
                          )}
                        </td>
                        <td>{formatDistance(r.offset)}</td>
                        <td>±{formatDistance(r.coneRadius)}</td>
                        <td>{formatPercent(r.coverage)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>

              <div className="buttons">
                <button onClick={() => map.current?.focusSnare()}>Zoom to {spotDampening ? "position" : "snare"}</button>
                <button onClick={() => map.current?.fitPlan()}>Show routes</button>
                <button onClick={() => map.current?.fitSystem()}>System</button>
                <button onClick={() => map.current?.topDown()}>Top-down</button>
                <button title="Lean the view over: what sits above and below a planet comes apart from it" onClick={() => map.current?.tilt()}>
                  Tilt
                </button>
              </div>
                    </section>
                  )}
                  {resultTab === "fly" && (
                    <>
          <section>
            <h2>Getting there</h2>
            <p className="note">Quantum toward a marker and cut the drive early. Pick where you start, or see the closest lines from anywhere.</p>
            <div className="dest-row">
              <span className="leg-no">⌂</span>
              {start ? (
                <>
                  <span className={`dot kind-${start.kind}`} />
                  <span className="dest-name">{start.name}</span>
                  <button className="x-button" title="Any start" onClick={() => setStartId(undefined)}>
                    ×
                  </button>
                </>
              ) : (
                <span className="dest-name muted">starting anywhere</span>
              )}
            </div>
            {!start && (
              <LocationPicker
                bodies={bodies}
                placeholder="I'm starting from…"
                onPick={(b) => {
                  setStartId(b.id);
                  setApproachIndex(0);
                }}
              />
            )}
            <ol className="approaches">
              {routesIn.length === 0 && <li className="empty">No clear quantum line passes this spot from there.</li>}
              {routesIn.map((a, index) => {
                const total = distance(a.from.pos, a.to.pos);
                const eta = myDrive ? myDrive.spool + timeToReach(total - a.remaining, total, myDrive) : undefined;
                return (
                  <li key={`${a.from.id}-${a.to.id}`}>
                    <button className={index === approachIndex ? "approach on" : "approach"} onClick={() => setApproachIndex(index)}>
                      <span className="approach-line">
                        {a.from.name} <span className="arrow">→</span> {a.to.name}
                      </span>
                      <span className="approach-detail">
                        {a.remaining <= arrivalOf(a.to) + ARRIVAL_SLACK ? (
                          <>
                            <b>finish the jump</b>
                          </>
                        ) : (
                          <>
                            drop out with <b>{formatDistance(a.remaining)}</b> to go
                          </>
                        )}
                        {a.miss > 500 ? `, then ${formatDistance(a.miss)} sublight` : ", dead on"}
                        {eta !== undefined && ` · ${formatDuration(eta)}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="row">
              <label htmlFor="mydrive">Your drive</label>
              <DriveSelect id="mydrive" universe={universe} value={state.myDrive} onChange={(id) => update({ myDrive: id })} />
            </div>
          </section>
                    </>
                  )}
                  {resultTab === "verify" && (
                    <>
          <section>
            <h2>Check your position</h2>
            <p className="note">
              Type <code>/showlocation</code> in game chat and paste the result.
            </p>
            <textarea
              rows={2}
              spellCheck={false}
              placeholder="Coordinates: x:… y:… z:…"
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
            />
            {locationText.trim() !== "" && !player && <p className="warn">No coordinates found in that text.</p>}
            {playerCheck && (
              <div className={`check ${playerCheck.evaluation.margin >= 0 ? "good" : "off"}`}>
                <strong>
                  {playerCheck.evaluation.margin >= 0
                    ? `In position — every ${spotDampening ? "arrival held" : "route covered"}, ${formatDistance(playerCheck.evaluation.margin)} to spare.`
                    : `Out of position — ${spotDampening ? "holding" : "covering"} ${formatPercent(playerCheck.evaluation.coverage)} from here.`}
                </strong>
                <span>
                  {formatDistance(playerCheck.toSnare)} from the planned spot
                  {spotDampening
                    ? "."
                    : `: ${formatDistance(Math.abs(playerCheck.along))} ${playerCheck.along > 0 ? "too far out from" : "too close to"} ${leg.dest.name}, ${formatDistance(playerCheck.lateral)} off the corridor line.`}
                </span>
                {playerCheck.evaluation.margin < 0 && (
                  <ul>
                    {leg.routes.map((route, index) => {
                      const r = playerCheck.evaluation.routes[index];
                      return r.coverage >= 1 ? null : (
                        <li key={route.id}>
                          {route.label}: {formatPercent(r.coverage)} — {spotDampening ? "drops out" : "line passes"} {formatDistance(r.offset)} away
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>
                    </>
                  )}
                  {resultTab === "timing" && (
                    <>
          <section>
            <h2>Target timing</h2>
            <div className="row">
              <label htmlFor="targetdrive">Target's drive</label>
              <DriveSelect id="targetdrive" universe={universe} value={state.targetDrive} onChange={(id) => update({ targetDrive: id })} />
            </div>
            {targetDrive ? (
              <table className="routes">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th title="From the moment the target's drive engages">Reaches you in</th>
                    <th>At</th>
                  </tr>
                </thead>
                <tbody>
                  {leg.routes.map((route, index) => {
                    const r = leg.evaluation.routes[index];
                    const total = Math.max(1, distance(route.origin, leg.dest.pos) - arrivalOf(leg.dest));
                    // A dampener waits at the end of the trip; a snare cuts it short.
                    const covered = spotDampening ? total : Math.min(total, Math.max(0, distance(route.origin, leg.dest.pos) - r.along));
                    return (
                      <tr key={route.id}>
                        <td>{route.label}</td>
                        <td>{formatDuration(targetDrive.spool + timeToReach(covered, total, targetDrive))}</td>
                        <td>{Math.round(speedAt(covered, total, targetDrive) / 1000).toLocaleString("en-US")} km/s</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="note">Pick a drive to see how long each route takes to reach you.</p>
            )}
            <p className="note">Timing is an estimate: it uses the drive's mean acceleration, not the game's exact two-stage curve.</p>
          </section>
                    </>
                  )}
    </>
  ) : null;

  const hasResult = !!leg && status !== "none";
  const railTabs = SETUP_TABS.map((t) => (t.id === "plans" && plans.length > 0 ? { ...t, badge: plans.length } : t));
  // Docked: one rail carries both groups, and the panel shows whichever was picked last.
  const dockTabs: TabDef<SetupTab | ResultTab>[] = [...railTabs, ...RESULT_TABS.map((t) => ({ ...t, disabled: !hasResult }))];
  const dockShowsResult = dockSide === "result" && hasResult;
  const dockValue = dockShowsResult ? resultTab : setupTab;
  const pickDockTab = (id: SetupTab | ResultTab) => {
    const setup = SETUP_TABS.find((t) => t.id === id);
    if (setup) {
      setSetupTab(setup.id);
      setDockSide("setup");
    } else {
      setResultTab(id as ResultTab);
      setDockSide("result");
    }
  };

  return (
    <div className={`app layout-${layout}`}>
      <header>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>Snares</h1>
          <span className="tagline">quantum interdiction planner</span>
        </div>
        <nav className="systems" aria-label="Star system">
          {Array.isArray(universe.systems) &&
            universe.systems.map((s) => (
              <button
                key={s.name}
                className={s.name === system.name ? "on" : undefined}
                onClick={() => {
                  if (s.name === system.name) return;
                  setStartId(undefined);
                  setMenu(undefined);
                  update({ system: s.name, originIds: [], destIds: [], activeLeg: 0, weights: {} });
                }}
              >
                {s.name}
              </button>
            ))}
        </nav>
        <nav className="systems channel" aria-label="Game build">
          {(["live", "ptu"] as const).map((ch) => (
            <button
              key={ch}
              className={ch === state.channel ? "on" : undefined}
              title={ch === "ptu" ? `Public test universe data${state.channel === "ptu" ? ` (${universe.build})` : ""}` : "Live servers data"}
              onClick={() => {
                if (ch === state.channel) return;
                setStartId(undefined);
                setMenu(undefined);
                update({ channel: ch });
              }}
            >
              {ch.toUpperCase()}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <button className="ghost" onClick={() => copy("link", window.location.href)}>
            {copied === "link" ? "Link copied" : "Copy link"}
          </button>
          <button
            className={armed === "reset" ? "ghost reset armed" : "ghost reset"}
            onClick={resetAll}
            title="Clear the route, ship, weights, law settings, scan results and pasted position. Saved plans stay."
          >
            {armed === "reset" ? "Click again to reset" : "Reset all"}
          </button>
        </div>
      </header>

      {layout === "docked" ? (
        <>
          <TabList name="dock" label="Plan setup and result" orientation="vertical" className="rail docked" tabs={dockTabs} value={dockValue} onChange={pickDockTab} />
          <aside className="panel setup" aria-label="Plan">
            {verdictHead}
            <TabPanel name="dock" id={dockValue} className="panel-scroll">
              {dockShowsResult ? resultContent : setupContent}
            </TabPanel>
          </aside>
        </>
      ) : (
        <>
          <TabList name="setup" label="Plan setup" orientation="vertical" className="rail" tabs={railTabs} value={setupTab} onChange={setSetupTab} />
          <aside className="panel setup" aria-label="Plan setup">
            <TabPanel name="setup" id={setupTab} className="panel-scroll">
              {setupContent}
            </TabPanel>
          </aside>
          <aside className={resultsOpen ? "panel results" : "panel results closed"} aria-label="Result">
            <button
              className="panel-toggle"
              onClick={toggleResults}
              aria-expanded={resultsOpen}
              aria-label={resultsOpen ? "Hide result panel" : "Show result panel"}
              title={resultsOpen ? "Hide result panel" : "Show result panel"}
            >
              {resultsOpen ? <PanelRightClose size={16} aria-hidden /> : <PanelRightOpen size={16} aria-hidden />}
            </button>
            {resultsOpen && (
              <>
                {verdictHead}
                {hasResult && (
                  <>
                    <TabList name="result" label="Result" className="result-tabs" tabs={RESULT_TABS} value={resultTab} onChange={setResultTab} />
                    <TabPanel name="result" id={resultTab} className="panel-scroll">
                      {resultContent}
                    </TabPanel>
                  </>
                )}
              </>
            )}
          </aside>
        </>
      )}

      <main>
        <MapView
          ref={map}
          bodies={bodies}
          legs={mapLegs}
          activeLeg={activeLeg}
          dampen={focusShip?.device.dampen ?? state.dampen}
          others={others}
          focusLabel={fleetOn && focusShip ? `${focus + 1} ${ROLE_LABEL[focusShip.role].toUpperCase()}` : undefined}
          showArmistice={state.careArmistice}
          showMonitored={state.careComms}
          player={player}
          approach={approach}
          fitKey={`${system.name}|${state.originIds.join(",")}|${state.destIds.join(",")}`}
          onPick={(body, anchor) => setMenu({ body, ...anchor })}
        />
        {menu && (
          <div className="pick-menu" style={{ left: menu.x, top: menu.y }}>
            <div className="pick-title">
              <span className={`dot kind-${menu.body.kind}`} />
              {menu.body.name}
            </div>
            <div className="pick-meta">
              arrival {formatDistance(arrivalOf(menu.body))} · auto spread {formatDistance(spreadOf(menu.body, "auto"))}
            </div>
            <button
              disabled={state.originIds.includes(menu.body.id)}
              onClick={() => {
                update({ originIds: [...state.originIds, menu.body.id] });
                setMenu(undefined);
              }}
            >
              Add as origin
            </button>
            <button
              onClick={() => {
                update({ destIds: [menu.body.id], originIds: state.originIds.filter((id) => id !== menu.body.id), activeLeg: 0 });
                setMenu(undefined);
              }}
            >
              Set as destination
            </button>
            <button className="ghost" onClick={() => setMenu(undefined)}>
              Close
            </button>
          </div>
        )}
      </main>

      <SiteFooter build={universe.build} extracted={universe.extracted} />
    </div>
  );
}

function DriveSelect({
  id,
  universe,
  value,
  onChange,
}: {
  id: string;
  universe: Universe;
  value?: string;
  onChange(id: string | undefined): void;
}) {
  const sizes = [...new Set(universe.drives.map((d) => d.size))].sort((a, b) => a - b);
  return (
    <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">—</option>
      {sizes.map((size) => (
        <optgroup key={size} label={`Size ${size}`}>
          {universe.drives
            .filter((d) => d.size === size)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {Math.round(d.speed / 1e6)} Mm/s
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
