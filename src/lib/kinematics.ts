/**
 * Quantum travel timing, as an estimate.
 *
 * The game accelerates a drive in two stages and brakes symmetrically. The
 * exact stage hand-over is not in the data, so this uses a single mean
 * acceleration: accelerate, cruise at drive speed if the trip is long enough,
 * brake. Good to a few seconds on system-scale trips, which is what matters
 * for "how long until the target reaches me".
 */

import type { QuantumDrive } from "./types";

const meanAccel = (drive: QuantumDrive) => (drive.accel1 + drive.accel2) / 2;

/** Seconds to cover a whole trip of `total` metres, excluding spool. */
export function travelTime(total: number, drive: QuantumDrive): number {
  return timeToReach(total, total, drive);
}

/** Seconds into a trip of `total` metres at which the ship has covered `covered`. */
export function timeToReach(covered: number, total: number, drive: QuantumDrive): number {
  const a = meanAccel(drive);
  if (!(a > 0) || !(total > 0)) return 0;
  const x = Math.min(Math.max(covered, 0), total);

  // Distance spent accelerating: to full speed, or to the midpoint if shorter.
  const ramp = Math.min((drive.speed * drive.speed) / (2 * a), total / 2);
  const peak = Math.sqrt(2 * a * ramp);
  const rampTime = peak / a;
  const cruise = total - 2 * ramp;

  if (x <= ramp) return Math.sqrt((2 * x) / a);
  if (x <= ramp + cruise) return rampTime + (x - ramp) / peak;
  // Braking: mirror of the ramp, measured back from the end.
  const left = total - x;
  return rampTime + cruise / peak + rampTime - Math.sqrt((2 * left) / a);
}

/** Speed in m/s at the point `covered` metres into a trip of `total`. */
export function speedAt(covered: number, total: number, drive: QuantumDrive): number {
  const a = meanAccel(drive);
  if (!(a > 0) || !(total > 0)) return 0;
  const x = Math.min(Math.max(covered, 0), total);
  const ramp = Math.min((drive.speed * drive.speed) / (2 * a), total / 2);
  const peak = Math.sqrt(2 * a * ramp);
  if (x <= ramp) return Math.sqrt(2 * a * x);
  if (x <= total - ramp) return peak;
  return Math.sqrt(2 * a * (total - x));
}
