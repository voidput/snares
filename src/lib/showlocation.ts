import type { Vec3 } from "./vec";

/**
 * Read a position out of pasted `/showlocation` output, e.g.
 * `Coordinates: x:12850457093.0 y:-1234.5 z:0.0`. Falls back to the first
 * three numbers in the text, so a bare "x, y, z" works too. Metres.
 */
export function parseShowLocation(text: string): Vec3 | undefined {
  const number = "(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)";
  const labelled = new RegExp(`x\\s*[:=]\\s*${number}[\\s,;]*y\\s*[:=]\\s*${number}[\\s,;]*z\\s*[:=]\\s*${number}`, "i").exec(
    text,
  );
  const parts = labelled ? labelled.slice(1, 4) : (text.match(new RegExp(number, "g")) ?? []).slice(0, 3);
  if (parts.length < 3) return undefined;
  const values = parts.map(Number);
  return values.every(Number.isFinite) ? [values[0], values[1], values[2]] : undefined;
}
