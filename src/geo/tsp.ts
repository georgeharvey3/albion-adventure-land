import { haversine, type LatLng } from './haversine';

// Route ordering (spec §7.3): nearest-neighbour seed + 2-opt cleanup over an
// open path with a fixed start (the anchor). N ≤ MAX_STOPS so nothing heavier
// is warranted. The distance function is injectable: haversine now, cached
// road-time matrix lookups in Phase 4 with no algorithm change.

export type DistanceFn = (a: LatLng, b: LatLng) => number;

/**
 * Order `stops` into an efficient open path starting from `anchor` (the anchor
 * itself is not part of the returned array). Deterministic for a given input.
 */
export function orderRoute<T extends LatLng>(
  anchor: LatLng,
  stops: T[],
  dist: DistanceFn = haversine,
): T[] {
  if (stops.length <= 1) return [...stops];

  // Nearest-neighbour from the fixed start.
  const remaining = [...stops];
  const tour: T[] = [];
  let from: LatLng = anchor;
  while (remaining.length) {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = dist(from, remaining[i]);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    tour.push(next);
    from = next;
  }

  // 2-opt on the open path [anchor, tour[0..n-1]]: reverse tour[i..j] whenever
  // it shortens the total. Reversing a suffix (j = n-1) only changes the edge
  // entering the segment — there is no return edge to the anchor.
  const n = tour.length;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const before = i === 0 ? anchor : tour[i - 1];
        const delta =
          dist(before, tour[j]) -
          dist(before, tour[i]) +
          (j < n - 1 ? dist(tour[i], tour[j + 1]) - dist(tour[j], tour[j + 1]) : 0);
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

/** Total open-path length anchor → stops in order (metres by default). */
export function routeLength(anchor: LatLng, stops: LatLng[], dist: DistanceFn = haversine): number {
  let total = 0;
  let from: LatLng = anchor;
  for (const s of stops) {
    total += dist(from, s);
    from = s;
  }
  return total;
}
