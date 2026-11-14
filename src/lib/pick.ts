/** Something under the pointer: how far its dot is in pixels, and how much its label matters. */
export interface PickCandidate<T> {
  item: T;
  /** Pixels from the pointer to the dot. */
  distance: number;
  /** Lower wins: the same order labels are placed in, so the pick matches the name on screen. */
  rank: number;
}

/**
 * Choose what the pointer is on. Zoomed out, a planet, its moons and its stations sit on the
 * same few pixels, and taking the nearest dot made the pick jump between them, so the label
 * under the pointer kept changing name. Dots within `stack` pixels of the nearest count as one
 * pile, and the pile gives up its most important member: the one whose label is already shown.
 * Zoomed in, dots are farther apart than that and the nearest one wins as before.
 * `previous` is what was picked last: among equals it is kept, so the pick does not flicker.
 */
export function pickNearest<T>(candidates: PickCandidate<T>[], previous?: T, reach = 14, stack = 6): T | undefined {
  const inReach = candidates.filter((c) => c.distance < reach);
  if (inReach.length === 0) return undefined;
  const closest = Math.min(...inReach.map((c) => c.distance));
  const pile = inReach.filter((c) => c.distance <= closest + stack);
  const top = Math.min(...pile.map((c) => c.rank));
  // Equals stacked together (two jump points on one spot): stay on the one already held.
  const held = pile.find((c) => c.item === previous && c.rank === top);
  if (held) return held.item;
  return pile.reduce((best, c) => (c.rank < best.rank || (c.rank === best.rank && c.distance < best.distance) ? c : best)).item;
}

/**
 * How much a place matters on the map, lower first: the order labels are placed in and the
 * order a pile of dots is picked in. Stars and planets are the landmarks; after them, places
 * by traffic weight, so a city or a core station comes before a comm array or a mining base.
 */
export function mapRank(kind: string, weight = 0): number {
  if (kind === "star") return 0;
  if (kind === "planet") return 1;
  return 2 + Math.max(0, 10 - weight);
}
