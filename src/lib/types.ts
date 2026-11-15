import type { Vec3 } from "./vec";

export type BodyKind =
  | "star"
  | "planet"
  | "city"
  | "moon"
  | "lagrange"
  | "station"
  | "jump"
  | "asteroid"
  | "surface"
  /** An orbital marker (OM-1..6), derived at load: see lib/markers.ts. */
  | "marker"
  | "other";

export interface Body {
  id: string;
  name: string;
  kind: BodyKind;
  parent?: string;
  /**
   * Set on a surface location (a city, an outpost): the id of the planet or
   * moon it sits on. It shares that body's position and arrival radius, since
   * for quantum travel it is that body.
   */
  on?: string;
  /** Metres, system frame, star at the origin. */
  pos: Vec3;
  /** Ships travelling here drop out this far from the centre. */
  arrival?: number;
  /** A route passing closer than this is blocked. */
  obstruction?: number;
  adoption?: number;
  hidden?: boolean;
  /** Radius of the armistice zone around it, metres: no weapons inside. */
  armistice?: number;
  /** Radius inside which crime is seen and reported, metres (comm array, station). */
  monitored?: number;
  /**
   * Radius of a monitor zone jammer here, metres: a dead zone where crime goes unseen
   * whatever comm array or station covers the space around it (Grim HEX).
   */
  jammer?: number;
  /**
   * Set on a place that turns with a planet or moon, on its surface or in low orbit
   * inside its rotating zone: the id of that body. See lib/spin.ts.
   */
  rides?: string;
  /** With `rides`: offset from that body's centre with the body unturned, metres. */
  local?: Vec3;
  /** On a planet or moon: hours it takes to turn once. */
  spin?: number;
  /** On a planet or moon: radius of its rotating zone, metres. */
  grid?: number;
  /** Number of services the place offers (refuel, shops, ...), if any. */
  services?: number;
  /** Has a refinery: miners arrive here loaded. */
  refinery?: boolean;
  /** A full-service hub: hospital, XL hangars or a cargo dock. */
  hub?: boolean;
  /** A gateway or jump point into a system that is not in the game. */
  deadEnd?: boolean;
  /**
   * Relative traffic the place is worth: 10 for a planet with a city, 9 for a
   * refinery station, 8 for a hub, down to 0.25 for a comm array or asteroid
   * base. See `weightOf` in scripts/build-data.mjs.
   */
  weight?: number;
}

export interface StarSystem {
  name: string;
  bodies: Body[];
}

/** A ship that carries a quantum snare, a quantum dampener, or both. */
export interface Interdictor {
  id: string;
  name: string;
  /** Name of the fitted device. */
  device: string;
  /** Radius of the sphere that pulls ships out of quantum, metres. 0 if it has no snare. */
  snareRadius: number;
  /** Range inside which ships cannot spool a quantum drive, metres. */
  dampenRange: number;
  chargeTime: number;
  dischargeTime: number;
  cooldownTime: number;
  /** Id of the stock quantum drive. */
  drive?: string;
}

export interface QuantumDrive {
  id: string;
  name: string;
  size: number;
  grade: number;
  speed: number;
  accel1: number;
  accel2: number;
  spool: number;
  cooldown: number;
}

export interface Universe {
  build: string;
  extracted: string;
  rules: Record<string, number>;
  systems: StarSystem[];
  interdictors: Interdictor[];
  drives: QuantumDrive[];
}
