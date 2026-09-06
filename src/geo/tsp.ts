import { haversine, type LatLng } from './haversine';

// Route ordering (spec §7.3): nearest-neighbour seed + 2-opt cleanup over an
// open path. N ≤ MAX_STOPS so nothing heavier is warranted. The distance
// function is injectable: haversine now, cached road-time matrix lookups in
// Phase 4 with no algorithm change.
//
// The path has a fixed start (the anchor) and, in route mode (issue #15), a
// fixed end too — the journey's destination, pinned as the terminal node. Both
// cases are the same algorithm; the end is simply one more immovable neighbour
// in the 2-opt delta, absent in point mode.

export type DistanceFn = (a: LatLng, b: LatLng) => number;

/**
 * Order `stops` into an efficient open path from `from` to `to` — neither
 * endpoint appears in the returned array. Pass `to` as null/undefined for a
 * free end (point mode), where the path just stops at the last site.
 * Deterministic for a given input.
 */
export function orderRoute<T extends LatLng>(
  from: LatLng,
  stops: T[],
  to?: LatLng | null,
  dist: DistanceFn = haversine,
): T[] {
  if (stops.length <= 1) return [...stops];

  // Nearest-neighbour from the fixed start.
  const remaining = [...stops];
  const tour: T[] = [];
  let cursor: LatLng = from;
  while (remaining.length) {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = dist(cursor, remaining[i]);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    tour.push(next);
    cursor = next;
  }

  // 2-opt on the path [from, tour[0..n-1], to?]: reverse tour[i..j] whenever it
  // shortens the total. Only the two edges bounding the segment change, so the
  // delta needs just its immediate neighbours — the stop before it (the anchor
  // at i = 0) and the one after it (the destination at j = n-1, or nothing at
  // all when the end is free).
  const n = tour.length;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const before = i === 0 ? from : tour[i - 1];
        const after = j < n - 1 ? tour[j + 1] : to;
        const delta =
          dist(before, tour[j]) -
          dist(before, tour[i]) +
          (after ? dist(tour[i], after) - dist(tour[j], after) : 0);
        if (delta < -1e-9) {
          reverse(tour, i, j);
          improved = true;
        }
      }
    }
  }

  return tour;
}

function reverse<T>(arr: T[], i: number, j: number): void {
  while (i < j) {
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
    i++;
    j--;
  }
}

/**
 * Total path length from → stops in order → to (metres by default). Omit `to`
 * for an open end. With no stops this is just the direct from → to leg, which
 * is exactly the "your drive without stops" baseline.
 */
export function routeLength(
  from: LatLng,
  stops: LatLng[],
  to?: LatLng | null,
  dist: DistanceFn = haversine,
): number {
  let total = 0;
  let cursor: LatLng = from;
  for (const s of stops) {
    total += dist(cursor, s);
    cursor = s;
  }
  if (to) total += dist(cursor, to);
  return total;
}
