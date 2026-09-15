import type { LatLng } from '../geo/haversine';
import type { SearchResult } from './types';

// The ONLINE place provider (issue #28): Photon, Komoot's OSM geocoder.
//
// Chosen over Nominatim because Photon is built for as-you-type querying —
// Nominatim's usage policy explicitly discourages autocomplete traffic, which
// would force search-on-submit and make the box feel dead. No API key, CORS
// enabled, free.
//
// THIS IS AN ENHANCEMENT, NOT A DEPENDENCY. Every failure path returns an empty
// array rather than throwing: offline, DNS failure, timeout, rate limit, a 500,
// malformed JSON. The offline dictionary has already rendered by the time this
// resolves, so a failure means "no extra results", never a broken search. That
// is the whole offline-first bargain in one function.

const ENDPOINT = 'https://photon.komoot.io/api/';

// Short enough that a flaky rural connection can't leave a spinner hanging.
// The offline results are already on screen; this is strictly a bonus.
const TIMEOUT_MS = 3000;

const LIMIT = 8;

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    postcode?: string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
  };
}

/** Build the "X, Y" second line from whichever admin fields came back. */
function describe(props: NonNullable<PhotonFeature['properties']>): string {
  const parts = [props.city, props.county, props.state].filter(
    (p): p is string => !!p && p !== props.name,
  );
  // De-duplicate: Photon frequently repeats the same name across city/county.
  const seen = new Set<string>();
  const unique = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  return unique.slice(0, 2).join(', ');
}

/**
 * Search Photon, biased towards `near` so the nearest Newport wins.
 *
 * `signal` is the caller's — the orchestrator aborts it when the query moves
 * on, so a slow response for "bal" can't land after "bala" has been typed.
 */
export async function searchPhoton(
  query: string,
  near: LatLng | null,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(LIMIT), lang: 'en' });
  if (near) {
    params.set('lat', near.lat.toFixed(4));
    params.set('lon', near.lng.toFixed(4));
  }

  // Compose the caller's abort with our own timeout, so either can cancel.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(`${ENDPOINT}?${params}`, { signal: timeout.signal });
    if (!res.ok) return [];

    const body = (await res.json()) as { features?: PhotonFeature[] };
    const out: SearchResult[] = [];

    for (const feature of body.features ?? []) {
      const coords = feature.geometry?.coordinates;
      const props = feature.properties;
      if (!coords || !props?.name) continue;

      const [lng, lat] = coords;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      out.push({
        // Coordinate-derived so the same place from two sources collapses to
        // one row. See dedupeKey in ./search.ts — this id is never persisted.
        id: `photon:${lat.toFixed(4)},${lng.toFixed(4)}`,
        kind: 'place',
        label: props.name,
        detail: describe(props) || props.country || '',
        lat,
        lng,
        source: 'online',
        // Below the offline dictionary's exact matches: the shipped set is
        // curated for this app's purpose (British settlements you'd drive to),
        // while Photon returns every bus stop and boundary in OSM. Ranking in
        // ./search.ts re-weights by name match anyway; this is only the floor.
        score: 0,
      });
    }

    return out;
  } catch {
    // Offline, aborted, timed out, or the service is having a bad day. The
    // offline results stand on their own.
    return [];
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
