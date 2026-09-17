import { decodePolyline } from './polyline';
import type { LatLng } from './haversine';
import type { Route } from './route';

// The ONLINE road-route provider (issue #29): OSRM, hosted by FOSSGIS on
// OpenStreetMap data.
//
// Chosen over the alternatives for one reason above all — it needs no API key,
// so a client-only app with no backend has no secret to leak. OpenRouteService
// is technically open to the browser but its terms forbid a key in client-side
// code, and the only sanctioned workarounds are a proxy (we have no backend) or
// a key per user. Google Routes needs a billing account, forbids showing its
// results alongside a non-Google map, and forbids caching — three clauses that
// Leaflet plus offline-first cannot satisfy. Full reasoning and the rest of the
// field: docs/adr/0001-road-route-corridor.md.
//
// THIS IS AN ENHANCEMENT, NOT A DEPENDENCY — the same bargain `photon.ts`
// makes. Every failure path returns null rather than throwing: offline, DNS
// failure, timeout, rate limit, a 500, a `NoRoute` code, malformed JSON. A null
// means the journey falls back to the detour ellipse, which is a complete and
// correct answer, not a degraded one.
//
// OPERATING WITHIN THE DEMO-SERVER POLICY. The public instance asks for at most
// one request per second and gives no uptime guarantee. `serialise` below is
// what honours that: requests queue behind each other with a minimum gap, so no
// burst of journey edits can ever exceed it. Note also that the CORS preflight
// allows only `X-Requested-With` and `Content-Type` — adding the `X-Client-Id`
// header the Valhalla docs suggest would break the request in a browser, so we
// send no custom headers at all and let the natural Referer identify us.

// Primary and fallback. Both run the same engine and speak the same API, so the
// fallback needs no special handling beyond a second URL.
const ENDPOINTS = [
  'https://routing.openstreetmap.de/routed-car',
  'https://router.project-osrm.org',
];

// Generous next to Photon's 3 s: this fires once per journey, not once per
// keystroke, and there is nothing on screen waiting for it.
const TIMEOUT_MS = 10000;

// The demo-server policy, enforced client-side.
const MIN_GAP_MS = 1000;

/** Attribution required by the service's terms. Rendered with the basemap's. */
export const OSRM_ATTRIBUTION = 'Routing by <a href="https://routing.openstreetmap.de/">OSRM</a>/FOSSGIS';

interface OsrmResponse {
  code?: string;
  routes?: { geometry?: string; distance?: number; duration?: number }[];
}

// One promise chain for every caller, so two journeys resolved back to back are
// a second apart rather than simultaneous.
let queue: Promise<unknown> = Promise.resolve();
let lastSent = 0;

function serialise<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastSent);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSent = Date.now();
    return task();
  });
  // Keep the chain alive even when a link rejects; `fetchRoute` never rejects,
  // but the chain must not be poisoned if that ever changes.
  queue = run.catch(() => undefined);
  return run;
}

/**
 * The fastest driving route between two points, or null if it cannot be had.
 *
 * `overview=simplified` is deliberate: a 320 km British route comes back as
 * ~37 points instead of ~3,900, which is what makes a route cheap to cache in
 * IndexedDB and cheap to measure 1,200 sites against. The extra vertices of
 * the full geometry describe individual bends in the tarmac, and nothing here
 * — a drawn line at national zoom, a distance-to-road rounded to 500 m — can
 * see them.
 */
export async function fetchRoute(from: LatLng, to: LatLng): Promise<Route | null> {
  // OSRM takes lon,lat — the opposite order to every other coordinate in this
  // codebase. Six decimals is ~10 cm; anything beyond it is noise.
  const coords = `${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
  const query = 'overview=simplified&geometries=polyline6&alternatives=false&steps=false';

  for (const base of ENDPOINTS) {
    const route = await serialise(() => request(`${base}/route/v1/driving/${coords}?${query}`));
    if (route) return route;
  }
  return null;
}

async function request(url: string): Promise<Route | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;

    const body = (await res.json()) as OsrmResponse;
    // `Ok` is the only success code; `NoRoute` (two ends on different islands,
    // say) is a legitimate answer that simply has no route in it.
    if (body.code !== 'Ok') return null;

    const first = body.routes?.[0];
    if (!first?.geometry) return null;

    const points = decodePolyline(first.geometry, 6);
    if (points.length < 2) return null;

    return {
      points,
      distance: Number.isFinite(first.distance) ? (first.distance as number) : 0,
      duration: Number.isFinite(first.duration) ? (first.duration as number) : 0,
    };
  } catch {
    // Offline, timed out, blocked, or the demo server is down. The ellipse is
    // still a complete answer.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
