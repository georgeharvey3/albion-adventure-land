import type { Site } from '../data/types';

// Google Maps deep-link builders (spec §8). Handoff only — no embedded
// directions. Single-site is all the MVP needs; the multi-stop builder is here
// for Phase 3 and already guards the ~9-waypoint consumer-URL cap.

/**
 * Single-site directions handoff. When `origin` is given (e.g. a dropped "I am
 * here" pin), the route starts there; otherwise the origin is omitted so Google
 * Maps uses the device's live location.
 */
export function directionsToSite(site: Site, origin?: { lat: number; lng: number }): string {
  const params = new URLSearchParams({ api: '1', destination: `${site.lat},${site.lng}` });
  if (origin) params.set('origin', `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Place-lookup handoff — opens the site's Google Maps *listing* (photos,
 * reviews, hours, website) rather than routing to it. This is how a sparse row
 * borrows Google's rich place data, and it is the ONLY lawful way this app can
 * surface Google's user-posted photos: the Places API forbids using its content
 * alongside a non-Google map (we render Leaflet/OSM) and forbids caching it
 * (we are offline-first). A deep link carries neither restriction — the user
 * lands in Google's own surface, where Google's terms are Google's business.
 *
 * The query is a text search, so precision varies by what we know about a site:
 *   • postcode-keyed sites (pubs) → "name + postcode", which lands on the right
 *     listing reliably;
 *   • everything else → "name + county". Best-effort: an obscure holy well with
 *     no Google listing may land on a namesake elsewhere or on no result at all.
 * Making this exact means resolving a Places `place_id` per site at build time
 * and passing `query_place_id` — place IDs are the one piece of Places data the
 * terms allow storing indefinitely. Deferred: it needs a billed API pass.
 */
export function placeLink(site: Site): string {
  // Postcode first (most specific), then county; a bare name is the fallback
  // when the source gave us neither.
  const qualifier = site.postcode ?? site.county;
  const params = new URLSearchParams({
    api: '1',
    query: qualifier ? `${site.name} ${qualifier}` : site.name,
  });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

const MAX_WAYPOINTS = 9; // consumer URL cap (verify before relying on it — spec §8)

/** Multi-stop route. `ordered` is [start, ...vias, end] — any lat/lng points,
 *  so the outing anchor (not a Site) can be the origin. Throws if too many vias. */
export function multiStopRoute(ordered: { lat: number; lng: number }[]): string {
  if (ordered.length < 2) throw new Error('need at least an origin and destination');
  const origin = ordered[0];
  const destination = ordered[ordered.length - 1];
  const vias = ordered.slice(1, -1);
  if (vias.length > MAX_WAYPOINTS) {
    throw new Error(`route has ${vias.length} waypoints, exceeds cap of ${MAX_WAYPOINTS}; chunk it`);
  }
  const params = new URLSearchParams({
    api: '1',
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
  });
  if (vias.length) {
    params.set('waypoints', vias.map((s) => `${s.lat},${s.lng}`).join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
