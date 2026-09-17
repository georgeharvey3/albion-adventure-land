// Road-route geometry (issue #29 — "what's on my way", measured against the
// road you will actually drive rather than the straight line to your
// destination).
//
// WHY THIS EXISTS NEXT TO `corridor.ts` RATHER THAN REPLACING IT
//
// The ellipse in `corridor.ts` is the offline answer and stays exactly as it
// is. It is NOT a prefilter for this module, and that is the whole design
// decision (docs/adr/0001-road-route-corridor.md): a road route bends away
// from the chord between the two ends, so a site sitting ON the road — Perth
// on the A9, with the chord away over Rannoch Moor — can be tens of kilometres
// off the straight line while costing nothing to visit. An ellipse prefilter
// drops exactly the sites this feature exists to find.
//
// So the two definitions are independent, and a resolved route replaces the
// ellipse wholesale. `routeMetrics` returns the same `CorridorMetrics` shape
// the ellipse does, so every consumer branches once on which route/no-route
// input it has and nothing downstream knows the difference.
//
// THE METRIC: detour = 2 × (distance to the nearest point on the route).
//
// You leave the road, drive to the site, and come back to the road, so the
// spur is paid for twice. That keeps the unit identical to the ellipse's —
// EXTRA METRES DRIVEN — which is what lets one budget control mean the same
// thing in both modes. It is an approximation (a real spur is not a straight
// line, and you sometimes rejoin further along), and the honest alternative —
// routing `origin → site → destination` for real — is one network request per
// site, so it can only ever be a per-site refinement on an open card, never
// the filter.

import type { LatLng } from './haversine';
import type { CorridorMetrics } from './corridor';

/** A resolved road route: the driven line, and what driving it costs. */
export interface Route {
  /** Simplified geometry, origin-first. ~37 points for a 320 km journey. */
  points: LatLng[];
  /** Road distance in metres (not the great-circle distance). */
  distance: number;
  /** Driving time in seconds, free-flow. */
  duration: number;
}

/**
 * A route with its geometry projected once into a local metric plane, so
 * measuring 1,200 sites against it costs one flat loop each instead of a
 * haversine per segment per site.
 *
 * The plane is centred on the route's own mid-latitude, x east / y north. At
 * British latitudes over a few hundred kilometres the distortion is well under
 * a percent — and it is only ever used for a DISTANCE-TO-ROAD number that the
 * UI rounds to the nearest 500 m anyway.
 */
export interface PreparedRoute {
  route: Route;
  xs: number[];
  ys: number[];
  /** Cumulative planar length at each vertex; `cum[0] === 0`. */
  cum: number[];
  /** Planar length of the whole line. Zero-length routes never get here. */
  total: number;
  mPerDegLng: number;
  midLat: number;
}

const M_PER_DEG_LAT = 111320;

/** Project a route into its measuring plane. Returns null for a route with no
 *  length — nothing can be measured against a point. */
export function prepareRoute(route: Route): PreparedRoute | null {
  const pts = route.points;
  if (pts.length < 2) return null;

  let latSum = 0;
  for (const p of pts) latSum += p.lat;
  const midLat = latSum / pts.length;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  if (mPerDegLng <= 0) return null;

  const xs = new Array<number>(pts.length);
  const ys = new Array<number>(pts.length);
  const cum = new Array<number>(pts.length);
  for (let i = 0; i < pts.length; i++) {
    xs[i] = pts[i].lng * mPerDegLng;
    ys[i] = pts[i].lat * M_PER_DEG_LAT;
    cum[i] = i === 0 ? 0 : cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  const total = cum[cum.length - 1];
  if (total <= 0) return null;

  return { route, xs, ys, cum, total, mPerDegLng, midLat };
}

/** Metres from `site` to the nearest point on the route, and how far along the
 *  route that nearest point sits (0–1). */
export function snapToRoute(site: LatLng, prep: PreparedRoute): { offset: number; progress: number } {
  const px = site.lng * prep.mPerDegLng;
  const py = site.lat * M_PER_DEG_LAT;
  const { xs, ys, cum } = prep;

  let bestSq = Infinity;
  let bestAlong = 0;

  for (let i = 1; i < xs.length; i++) {
    const ax = xs[i - 1];
    const ay = ys[i - 1];
    const dx = xs[i] - ax;
    const dy = ys[i] - ay;
    const lenSq = dx * dx + dy * dy;

    // Where the perpendicular from the site meets this segment, clamped to the
    // segment itself so the nearest point is never off the end of it.
    const t = lenSq > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    const distSq = (px - qx) ** 2 + (py - qy) ** 2;

    if (distSq < bestSq) {
      bestSq = distSq;
      bestAlong = cum[i - 1] + t * Math.sqrt(lenSq);
    }
  }

  return {
    offset: Math.sqrt(bestSq),
    progress: Math.min(1, Math.max(0, bestAlong / prep.total)),
  };
}

/** The corridor numbers for one site against a road route — same shape, same
 *  units and same meaning as `corridorMetrics`, so the two definitions are
 *  interchangeable to every caller. */
export function routeMetrics(site: LatLng, prep: PreparedRoute): CorridorMetrics {
  const { offset, progress } = snapToRoute(site, prep);
  return { detour: offset * 2, progress };
}

/** Just the detour, for callers that score sites one number at a time (the
 *  outing search) and never want the progress alongside it. */
export function routeDetour(site: LatLng, prep: PreparedRoute): number {
  return snapToRoute(site, prep).offset * 2;
}

/** "2 h 40" / "45 min" — driving time, rounded the way a driver reads it. */
export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}
