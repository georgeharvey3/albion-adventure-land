import type { Site } from '../data/types';
import { haversine, type LatLng } from '../geo/haversine';
import { parseCoords } from './coords';
import { cachePlaces, type CachedPlace } from '../state/db';
import { loadGazetteer, REGION_LABELS, type LoadedGazetteer, type Place } from './places';
import { canonical, matchScore } from './normalize';
import { parsePostcode, resolveOffline, resolveOnline } from './postcode';
import { searchPhoton } from './photon';
import { searchSites } from './sites';
import type { SearchResult } from './types';

// Search orchestration (issue #28).
//
// THE SHAPE OF THIS FILE IS THE FEATURE. Search runs in two passes, and the
// first one never touches the network:
//
//   1. `searchLocal`  — coordinates, postcode districts, the app's own sites,
//      the shipped dictionary, and places cached from past online searches.
//      Synchronous once the dictionary has loaded. THIS IS THE WHOLE FEATURE
//      OFFLINE, and it is what renders first even when there is signal.
//   2. `searchOnline` — Photon and postcodes.io, merged in when and if they
//      answer. Pure enhancement: every failure path is an empty result.
//
// The UI calls both and merges. It never waits for (2) before showing (1), so
// losing signal changes how MANY results appear, never whether the box works.

/** How many of each kind to keep. Deliberately small — this is a phone. */
const SITE_LIMIT = 8;
const PLACE_LIMIT = 10;

/**
 * How many site matches to carry into ranking. Generous, because the cheap
 * pre-trim inside searchSites cannot see distance — trimming to SITE_LIMIT
 * there would throw away the site down the road in favour of an identically
 * named one 300 miles off.
 */
const SITE_PRESCAN = 60;

/**
 * Score penalty for matching an alternate name rather than the place's own.
 * Small enough that an alias match still beats a weaker match on a real name,
 * large enough that it never beats an EQUALLY good one — so "Snowdonia" still
 * finds Eryri, while Newport-on-Tay's "Newport" alias stops outranking the
 * actual city of Newport.
 */
const ALIAS_PENALTY = 5;

/**
 * Proximity bonus, in score points. Britain is full of repeated names, and the
 * one you mean is almost always the near one — but only almost, so this
 * tie-breaks WITHIN a match tier rather than across tiers (max 8 points, against
 * the 20-point gap between an exact and a prefix match).
 */
function proximityBonus(distance: number | undefined): number {
  if (distance === undefined) return 0;
  return 8 * Math.exp(-distance / 150000);
}

/**
 * Prominence bonus: a big town beats a hamlet of the same name. Max 10 points.
 *
 * Logarithmic, so it spreads the range that matters (a 2,000-person village to
 * a 300,000-person city) instead of saturating immediately. Together with the
 * proximity bonus this stays under the 20-point gap between match tiers, so a
 * big distant city can never outrank a genuine prefix match on your doorstep.
 */
function prominenceBonus(population: number): number {
  if (population <= 0) return 0;
  return Math.min(10, Math.log10(population) * 2);
}

function placeDetail(place: Place): string {
  const region = REGION_LABELS[place.region];
  if (place.kind === 'landmark') return region;
  const kind = place.kind === 'city' ? 'City' : place.kind === 'town' ? 'Town' : 'Village';
  return `${kind} · ${region}`;
}

/** Match the shipped dictionary. */
function searchPlaces(query: string, gazetteer: LoadedGazetteer): SearchResult[] {
  const q = canonical(query);
  if (!q) return [];

  const out: SearchResult[] = [];
  for (const place of gazetteer.places) {
    // Best of the real name and any alias, the latter discounted. The row
    // always shows the real name whichever key matched.
    let best = matchScore(q, place.key) * 100;
    for (const alias of place.aliases) {
      const score = matchScore(q, alias) * 100;
      if (score > 0) best = Math.max(best, score - ALIAS_PENALTY);
    }
    if (best <= 0) continue;

    out.push({
      id: `place:${place.name}:${place.lat},${place.lng}`,
      kind: 'place',
      label: place.name,
      detail: placeDetail(place),
      lat: place.lat,
      lng: place.lng,
      source: 'offline',
      score: best + prominenceBonus(place.population),
    });
  }
  return out;
}

/** Match places remembered from previous online searches. */
function searchCached(query: string, cached: CachedPlace[]): SearchResult[] {
  const q = canonical(query);
  if (!q) return [];

  const out: SearchResult[] = [];
  for (const place of cached) {
    const score = matchScore(q, place.key);
    if (!score) continue;
    out.push({
      id: `cached:${place.key}`,
      kind: 'place',
      label: place.label,
      detail: place.detail,
      lat: place.lat,
      lng: place.lng,
      source: 'cached',
      score: score * 100,
    });
  }
  return out;
}

/**
 * Two places within ~110 m with the same name are the same place arriving from
 * two sources (dictionary and Photon, typically). Collapse them — showing
 * "Bala / Bala" with identical detail lines looks broken.
 */
function dedupeKey(r: SearchResult): string {
  if (r.kind === 'site') return r.id; // sites are already unique by stable id
  return `${canonical(r.label)}@${r.lat.toFixed(3)},${r.lng.toFixed(3)}`;
}

/** Keep the best-scoring row per duplicate key, preserving nothing else. */
function dedupe(results: SearchResult[]): SearchResult[] {
  const best = new Map<string, SearchResult>();
  for (const r of results) {
    const key = dedupeKey(r);
    const existing = best.get(key);
    if (!existing || r.score > existing.score) best.set(key, r);
  }
  return [...best.values()];
}

/**
 * Attach distances from the anchor, apply the proximity bonus, and sort.
 *
 * NOT IDEMPOTENT — it adds the bonus. Call it once per result, on results that
 * still carry only their base score. `mergeOnline` below exists precisely so
 * the second pass doesn't re-rank rows the first pass already ranked.
 */
export function rank(results: SearchResult[], near: LatLng | null): SearchResult[] {
  const scored = results.map((r) => {
    const distance = near ? haversine(near, r) : undefined;
    return { ...r, distance, score: r.score + proximityBonus(distance) };
  });
  return scored.sort((a, b) => b.score - a.score);
}

export interface LocalSearchInput {
  query: string;
  sites: Site[];
  hidden: Set<string>;
  gazetteer: LoadedGazetteer;
  cached: CachedPlace[];
  near: LatLng | null;
}

/**
 * Everything that can be answered without a network. This is the offline
 * guarantee — it runs identically with signal and without.
 */
export function searchLocal({
  query,
  sites,
  hidden,
  gazetteer,
  cached,
  near,
}: LocalSearchInput): SearchResult[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const results: SearchResult[] = [];

  // Coordinates and grid references are unambiguous, so if the query parses as
  // one, that answer leads — but name matching still runs underneath, because
  // "SW1" is both an outward code and the start of a place name.
  const coords = parseCoords(trimmed);
  if (coords) results.push(coords);

  const postcode = parsePostcode(trimmed);
  if (postcode) {
    const offline = resolveOffline(postcode, gazetteer);
    if (offline) results.push(offline);
  }

  results.push(...searchSites(trimmed, sites, hidden, SITE_PRESCAN));
  results.push(...searchPlaces(trimmed, gazetteer));
  results.push(...searchCached(trimmed, cached));

  // ONE ranking pass over the lot. Ranking is not idempotent — it adds the
  // proximity bonus — so per-kind limits are applied after it rather than by
  // pre-ranking each kind separately, which used to count proximity twice.
  return limitPerKind(rank(dedupe(results), near));
}

/**
 * Trim to the top few of each kind, keeping the overall ranked order. Done
 * after ranking so the rows dropped are genuinely the worst ones, not just the
 * worst before distance was taken into account.
 */
function limitPerKind(ranked: SearchResult[]): SearchResult[] {
  let sites = 0;
  let places = 0;
  return ranked.filter((r) => {
    if (r.kind === 'site') return ++sites <= SITE_LIMIT;
    if (r.kind === 'place') return ++places <= PLACE_LIMIT;
    return true; // coordinates and postcodes are at most one row each
  });
}

export interface OnlineSearchInput {
  query: string;
  near: LatLng | null;
  signal: AbortSignal;
}

/**
 * The enhancement pass. Returns [] on every failure — offline, timeout, error —
 * so the caller can merge unconditionally without an error branch.
 *
 * Successful place results are written to the IndexedDB cache on the way out,
 * which is what makes the offline dictionary grow with use.
 */
export async function searchOnline({
  query,
  near,
  signal,
}: OnlineSearchInput): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const postcode = parsePostcode(trimmed);

  const [places, exactPostcode] = await Promise.all([
    searchPhoton(trimmed, near, signal),
    postcode ? resolveOnline(postcode, signal) : Promise.resolve(null),
  ]);

  const results = exactPostcode ? [exactPostcode, ...places] : places;

  // Remember what we found, so the next search for it works with no signal.
  // Fire-and-forget: the results are already on their way to the UI, and a
  // failed cache write must not delay or break them.
  void cachePlaces(
    places.map((p) => ({
      key: canonical(p.label),
      label: p.label,
      detail: p.detail ?? '',
      lat: p.lat,
      lng: p.lng,
    })),
  );

  return results;
}

/**
 * Fold the online pass into the local one.
 *
 * Online rows that duplicate a local result are dropped: the local row already
 * answers the query and carries the offline provenance worth showing. Only the
 * genuinely new rows are ranked — the local ones keep the scores they were
 * given in `searchLocal`, so proximity is counted once and the list doesn't
 * reshuffle under the user's finger when the network answers.
 */
export function mergeOnline(
  local: SearchResult[],
  online: SearchResult[],
  near: LatLng | null,
): SearchResult[] {
  if (!online.length) return local;

  const seen = new Set(local.map(dedupeKey));
  const extra = online.filter((r) => !seen.has(dedupeKey(r)));
  if (!extra.length) return local;

  const ranked = rank(extra, near);
  return [...local, ...ranked].sort((a, b) => b.score - a.score);
}

export { loadGazetteer };
