// Journey corridor geometry (issue #14 — route discovery, "what's on my way?").
//
// Everything here is pure, dependency-free and built on nothing but haversine,
// so route mode works in airplane mode exactly like near-me does.
//
// The corridor is defined by DETOUR, not by a distance-to-line band:
//
//   detour(S) = d(from,S) + d(S,to) − d(from,to)
//
// i.e. the extra ground you cover by stopping at S instead of driving straight
// through. Thresholding it (`detour <= budget`) traces an ellipse with `from`
// and `to` as its foci — naturally fat in the middle of the drive and pinched
// at both ends, which is what people actually mean by "on my way". It also
// answers the "how wide is a corridor?" question in the only unit a driver
// cares about: extra kilometres.
//
// Three haversines per site, so `corridorMetrics` computes both numbers from
// one shared pair of legs rather than each helper redoing the work.

import { haversine, type LatLng } from './haversine';

export interface CorridorMetrics {
  /** Extra metres driven by stopping here versus going straight through. */
  detour: number;
  /** Normalised position along the from→to line, clamped to 0–1. */
  progress: number;
}

/** Extra distance in metres incurred by routing via `site`. Never negative
 *  (the triangle inequality guarantees it; clamped against FP noise). */
export function detour(site: LatLng, from: LatLng, to: LatLng): number {
  return Math.max(0, haversine(from, site) + haversine(site, to) - haversine(from, to));
}

/** How far along the journey `site` sits, 0 at `from` and 1 at `to`.
 *  Scalar projection onto the from→to line via the law of cosines on the three
 *  great-circle legs — no map projection, no trig beyond haversine itself. */
export function progress(site: LatLng, from: LatLng, to: LatLng): number {
  return projectionAlong(haversine(from, site), haversine(site, to), haversine(from, to));
}

/** Both corridor numbers for one site, sharing the three haversines. */
export function corridorMetrics(site: LatLng, from: LatLng, to: LatLng): CorridorMetrics {
  const legFrom = haversine(from, site);
  const legTo = haversine(site, to);
  const direct = haversine(from, to);
  return {
    detour: Math.max(0, legFrom + legTo - direct),
    progress: projectionAlong(legFrom, legTo, direct),
  };
}

/** Is `site` within `budget` metres of extra driving? */
export function inCorridor(site: LatLng, from: LatLng, to: LatLng, budget: number): boolean {
  return detour(site, from, to) <= budget;
}

// |from→S| projected onto |from→to|, normalised. Law of cosines rearranged:
//   proj = (a² + c² − b²) / 2c   with a = from→S, b = S→to, c = from→to
// then divided by c again to normalise. A zero-length journey has no axis to
// project onto, so everything sits at the start.
function projectionAlong(legFrom: number, legTo: number, direct: number): number {
  if (direct <= 0) return 0;
  const t = (legFrom * legFrom + direct * direct - legTo * legTo) / (2 * direct * direct);
  return Math.min(1, Math.max(0, t));
}

/** "62% of the way" — progress as a whole-number percentage. */
export function formatProgress(p: number): string {
  return `${Math.round(p * 100)}% of the way`;
}

/** "+4 km detour" / "on the route" when the extra distance rounds to nothing. */
export function formatDetour(metres: number): string {
  if (metres < 100) return 'on the route';
  if (metres < 1000) return `+${Math.round(metres / 50) * 50} m detour`;
  if (metres < 10000) return `+${(metres / 1000).toFixed(1)} km detour`;
  return `+${Math.round(metres / 1000)} km detour`;
}

/** Detour budgets offered in the UI, metres. Deliberately coarse — this is a
 *  "how far off-piste am I willing to go" dial, not a precision instrument. */
export const DETOUR_BUDGETS = [2000, 5000, 10000, 20000, 40000, 80000];

export const DEFAULT_DETOUR_BUDGET = 10000;

// Metres per degree of latitude — the local-plane approximation used only for
// DRAWING the corridor. Membership is always decided by `detour` above, on real
// haversine distances; this is presentation, and an ellipse rendered with a
// flat-earth approximation is well within a stroke width at British scales.
const M_PER_DEG_LAT = 111320;

/** Polygon tracing `detour === budget` — the ellipse with `from` and `to` as
 *  foci and major axis d(from,to) + budget. Points are returned in order and
 *  the ring is closed by the caller (Leaflet closes polygons itself). */
export function corridorEllipse(
  from: LatLng,
  to: LatLng,
  budget: number,
  steps = 96,
): LatLng[] {
  const direct = haversine(from, to);
  if (direct <= 0 || budget <= 0) return [];

  // Semi-major/semi-minor of the detour ellipse: the sum of the two legs is
  // constant at direct + budget, so 2a = direct + budget and 2c = direct.
  const a = (direct + budget) / 2;
  const c = direct / 2;
  const b = Math.sqrt(Math.max(0, a * a - c * c));

  // Local plane centred on the midpoint of the journey, x east / y north.
  const midLat = (from.lat + to.lat) / 2;
  const midLng = (from.lng + to.lng) / 2;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  if (mPerDegLng <= 0) return [];

  // Rotate the ellipse so its major axis lies along from→to.
  const axisX = (to.lng - from.lng) * mPerDegLng;
  const axisY = (to.lat - from.lat) * M_PER_DEG_LAT;
  const theta = Math.atan2(axisY, axisX);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const ring: LatLng[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    const ex = a * Math.cos(t);
    const ey = b * Math.sin(t);
    const x = ex * cos - ey * sin;
    const y = ex * sin + ey * cos;
    ring.push({ lat: midLat + y / M_PER_DEG_LAT, lng: midLng + x / mPerDegLng });
  }
  return ring;
}
