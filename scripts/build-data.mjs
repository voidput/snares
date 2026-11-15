#!/usr/bin/env node
/**
 * Bake the game data the planner needs into public/data/universe.json.
 *
 * Source is sc-gamedata's parsed output (game-starmap, game-ship-components,
 * game-quantum). Nothing here reads the game: run `make all` in sc-gamedata
 * first. The baked file is committed, so the site builds without game files.
 *
 *   node scripts/build-data.mjs [--data ../sc-gamedata/data]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flag = process.argv.indexOf("--data");
const dataDir = path.resolve(
  flag >= 0 ? process.argv[flag + 1] : (process.env.SC_GAMEDATA_DIR ?? path.join(root, "..", "sc-gamedata", "data")),
);

const read = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, `${name}.json`), "utf-8"));
const starmap = read("game-starmap");
const components = read("game-ship-components");
const quantum = read("game-quantum");
const ships = read("game-ships");

const key = (recordName) => recordName.slice(recordName.indexOf(".") + 1);

function kindOf(location) {
  const { type, name } = location;
  if (type === "Star") return "star";
  if (type === "Planet") return "planet";
  if (type === "Moon") return "moon";
  if (type === "JumpPoint" || /jump point|gateway/i.test(name)) return "jump";
  if (/\bL[1-5]\b/.test(name) && type?.startsWith("Asteroid") && !/L[1-5]-/.test(name)) return "lagrange";
  if (type?.startsWith("Manmade")) return "station";
  if (type?.startsWith("Asteroid")) return "asteroid";
  return "other";
}

const positioned = starmap.locations.filter((l) => l.position);
if (positioned.length === 0) {
  throw new Error(
    `${dataDir}/game-starmap.json has no positions. Rebuild it with an sc-gamedata that reads object containers.`,
  );
}

/** For a place that turns with a body: the body and the offset from its centre. */
function turning(location) {
  if (!location.local || !location.turnsWith) return {};
  return { rides: key(location.turnsWith), local: [location.local.x, location.local.y, location.local.z].map((v) => Math.round(v)) };
}

const systems = new Map();
for (const location of positioned) {
  const kind = kindOf(location);
  const system = location.system ?? location.name.replace(/\s+Star$/i, "");
  if (!systems.has(system)) systems.set(system, []);
  const q = location.quantum ?? {};
  systems.get(system).push({
    id: key(location.recordName),
    name: location.name,
    kind,
    parent: location.parent ? key(location.parent) : undefined,
    pos: [location.position.x, location.position.y, location.position.z].map((v) => Math.round(v)),
    arrival: q.arrivalRadius,
    obstruction: q.obstructionRadius,
    adoption: q.adoptionRadius,
    hidden: location.hiddenInStarmap || undefined,
    services: location.amenities?.length || undefined,
    refinery: location.amenities?.includes("Refinery") || undefined,
    // A full-service hub: a hospital, hangars for the largest ships, or a cargo dock.
    hub:
      location.amenities?.some((a) => a === "Hospital" || a === "Hangar XL" || a === "Commodity Trading - Loading Dock") ||
      undefined,
    armistice: location.armisticeRadius,
    monitored: location.monitoredRadius,
    jammer: location.jammerRadius,
    // Inside its body's rotating zone: it turns with the body (see src/lib/spin.ts).
    ...turning(location),
    spin: location.rotationHours,
    grid: location.gridRadius,
  });
}

// Surface locations turn with their body and have no place of their own in
// space. For quantum travel they are the body: ships leave from orbit above it
// and arrive at its arrival radius. So each is baked as an alias of the nearest
// placed planet or moon above it, sharing that body's position and radii.
const byRecord = new Map(starmap.locations.map((l) => [l.recordName, l]));
const SURFACE = { LandingZone: "city", Outpost: "surface", PointOfInterest: "surface" };
for (const location of starmap.locations) {
  const kind = SURFACE[location.type];
  if (!kind || location.position || location.hiddenInStarmap || !location.system) continue;
  let body = byRecord.get(location.parent);
  while (body && !body.position) body = byRecord.get(body.parent);
  if (!body || (body.type !== "Planet" && body.type !== "Moon") || !systems.has(location.system)) continue;
  systems.get(location.system).push({
    id: key(location.recordName),
    name: location.name,
    kind,
    parent: key(body.recordName),
    on: key(body.recordName),
    pos: [body.position.x, body.position.y, body.position.z].map((v) => Math.round(v)),
    arrival: body.quantum?.arrivalRadius,
    ...turning(location),
  });
}

/**
 * Player ships that carry a quantum enforcement device, each with what the
 * device does. A snare (`snareRadius`) pulls ships out of quantum; a dampener
 * (`dampenRange`) stops ships near it from spooling. The game stores "no
 * snare" as a 1 m radius. AI, test and salvage variants of a ship are skipped,
 * as are ships carrying only the prototype device.
 */
function interdictors() {
  const devices = new Map(
    components.quantumEnforcement.filter((d) => !d.isTemplate).map((d) => [key(d.recordName).toLowerCase(), d]),
  );
  const found = [];
  for (const ship of ships.vehicles) {
    const id = key(ship.recordName);
    if (/_AI_|_PU_|Unmanned|_Test|_BIS\d|Collector/i.test(id) || !ship.displayName) continue;
    const fitted = ship.loadout?.quantumEnforcement?.[0];
    const device = fitted && devices.get(fitted.item.toLowerCase());
    if (!device) continue;
    const snare = device.stats.radiusMeters > 100 ? device.stats.radiusMeters : 0;
    found.push({
      id,
      name: ship.displayName,
      device: device.name,
      snareRadius: snare,
      dampenRange: device.stats.jammerRange ?? 0,
      chargeTime: device.stats.chargeTimeSecs,
      dischargeTime: device.stats.dischargeTimeSecs,
      cooldownTime: device.stats.cooldownTimeSecs,
      drive: ship.loadout?.quantumDrives?.[0]?.item,
    });
  }
  // Snare ships first, then by reach.
  return found.sort((a, b) => b.snareRadius - a.snareRadius || b.dampenRange - a.dampenRange);
}

/**
 * How much traffic a place is worth, relative to the others, in three tiers.
 * The game files hold no traffic figures, so this is read off what they do
 * say about a place.
 *
 * Hot: a planet with a city (10); a station with a refinery (9), where miners
 * arrive loaded; a full-service hub with a hospital, XL hangars or a cargo
 * dock (8); a gateway or jump point into a system that is in the game (7, 6).
 * Lesser: any other station with services (4), a planet without a city (3),
 * a moon (2), a bare marker or unserviced station (1).
 * Cold: a gateway or jump point that leads to a system not in the game, where
 * nobody is going, whatever it sells (0.5); comm arrays and asteroid bases
 * (0.25).
 */
function weightOf(body, hasCity, deadEnd) {
  switch (body.kind) {
    case "planet":
      return hasCity ? 10 : 3;
    case "jump":
      if (deadEnd) return 0.5;
      if (body.refinery) return 9;
      return body.services ? 7 : 6;
    case "station":
      if (body.refinery) return 9;
      if (body.hub) return 8;
      if (body.services) return 4;
      return /comm array|relay|probe/i.test(body.name) ? 0.25 : 1;
    case "moon":
      return 2;
    case "lagrange":
      return 1;
    case "asteroid":
      return 0.25;
    default:
      return 0.5;
  }
}

/**
 * True for a gateway or jump point whose far side is not in the game: its name
 * mentions no system the data has, other than the one it sits in.
 */
function isDeadEnd(body, system, systemNames) {
  if (body.kind !== "jump") return false;
  return !systemNames.some((name) => name !== system && new RegExp(`\\b${name}\\b`, "i").test(body.name));
}

const systemNames = [...systems.keys()];
for (const [system, bodies] of systems) {
  const cityPlanets = new Set(bodies.filter((b) => b.kind === "city").map((b) => b.on));
  for (const body of bodies) {
    if (body.on) continue;
    const deadEnd = isDeadEnd(body, system, systemNames);
    if (deadEnd) body.deadEnd = true;
    // A surface location weighs what its body does: it is the same route.
    body.weight = weightOf(body, cityPlanets.has(body.id), deadEnd);
  }
  const byId = new Map(bodies.map((b) => [b.id, b]));
  for (const body of bodies) if (body.on) body.weight = byId.get(body.on)?.weight ?? 1;
}

const order = ["star", "planet", "city", "moon", "lagrange", "station", "jump", "asteroid", "surface", "other"];
const out = {
  build: starmap._build,
  extracted: starmap._extracted,
  rules: quantum.rules,
  systems: [...systems.entries()]
    .map(([name, bodies]) => ({
      name,
      bodies: bodies.sort(
        (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name, "en", { numeric: true }),
      ),
    }))
    .sort((a, b) => b.bodies.length - a.bodies.length),
  interdictors: interdictors(),
  drives: components.quantumDrives
    .filter((d) => !d.isTemplate && d.stats?.driveSpeed > 0 && d.manufacturer)
    .map((d) => ({
      id: key(d.recordName),
      name: d.name,
      size: d.size,
      grade: d.grade,
      speed: d.stats.driveSpeed,
      accel1: d.stats.stageOneAccelRate,
      accel2: d.stats.stageTwoAccelRate,
      spool: d.stats.spoolUpTime,
      cooldown: d.stats.cooldownTime,
    }))
    .sort((a, b) => a.size - b.size || a.name.localeCompare(b.name)),
};

const file = path.join(root, "public", "data", "universe.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));

const ids = new Set();
for (const system of out.systems) for (const body of system.bodies) {
  if (ids.has(`${system.name}/${body.id}`)) throw new Error(`duplicate body id ${body.id}`);
  ids.add(`${system.name}/${body.id}`);
}
console.log(
  `build ${out.build}: ${out.systems.map((s) => `${s.name} ${s.bodies.length}`).join(", ")}; ` +
    `${out.interdictors.map((i) => i.name).join(", ")}; ${out.drives.length} drives -> ${path.relative(root, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} kB)`,
);
