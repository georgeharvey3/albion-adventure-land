// resolve_place (issue #62): a place name, a postcode or a grid reference
// becomes coordinates.
//
// The order is the order of the journey search (issue #28), and for the same
// reason: the local answers first, the network only for what they cannot
// answer. Typed coordinates and grid references need nothing. A place the
// dictionary knows by its exact name, and a site the data knows by its exact
// name, need nothing either. Only a full postcode, or a name that neither
// holds, costs a request, and a failed request gives the best local answer or
// an honest "not found".

import { haversine, type LatLng } from '../../src/geo/haversine';
import { parseCoords } from '../../src/search/coords';
import { canonical, matchScore } from '../../src/search/normalize';
import { REGION_LABELS } from '../../src/search/places';
import { parsePostcode, resolveOffline } from '../../src/search/postcode';
import { SITE_TYPE_LABELS } from '../../src/data/types';
import type { ToolContext } from './context';

export interface ResolvedPlace {
  found: true;
  label: string;
  lat: number;
  lng: number;
  kind: 'place' | 'postcode' | 'coords' | 'site';
  detail?: string;
  /** Set when the point is a postcode district, not the postcode itself. */
  approximate?: true;
  /** Set when the text named a site. */
  siteId?: string;
  /** Other places with the same name, best first. */
  alternatives?: { label: string; lat: number; lng: number; detail?: string }[];
}

export type ResolvePlaceResult = ResolvedPlace | { found: false; text: string; hint?: string };

// Words that mean the live position, not a place. Photon would happily find
// "Mendip" for "me".
const HERE = new Set(['me', 'here', 'position', 'my location', 'my position', 'current location', 'current position', 'where i am', 'near me']);

// A generous box round Great Britain, the Isle of Man and the Channel Islands.
// Photon searches the whole world, and "Paris" is not a trip this app can plan.
function inBritain(p: LatLng): boolean {
  return p.lat >= 49 && p.lat <= 61 && p.lng >= -8.7 && p.lng <= 2;
}

// Photon always answers with something, and a fuzzy match on "on Sea" turns
// "Nowhereville-on-Sea" into Southend. An answer must share at least one main
// word, four letters or more, with the text. A text with no such word
// ("Hay-on-Wye") is taken on trust.
function sharesMainWord(text: string, label: string): boolean {
  const main = canonical(text).split(' ').filter((w) => w.length >= 4);
  if (!main.length) return true;
  const words = new Set(canonical(label).split(' '));
  return main.some((w) => words.has(w));
}

interface Candidate {
  label: string;
  lat: number;
  lng: number;
  kind: 'place' | 'site';
  detail?: string;
  siteId?: string;
  score: number;
}

// Within one match tier, a big place beats a hamlet and a near place beats a
// far one: the same two tie-breaks as the journey search.
function tieBreak(population: number, point: LatLng, near: LatLng | null): number {
  const prominence = population > 0 ? Math.min(10, Math.log10(population) * 2) : 0;
  const proximity = near ? 20 * Math.exp(-haversine(near, point) / 50000) : 0;
  return prominence + proximity;
}

function localCandidates(ctx: ToolContext, text: string): Candidate[] {
  const q = canonical(text);
  if (!q) return [];
  const near = ctx.request.position;
  const out: Candidate[] = [];

  for (const place of ctx.data.gazetteer.places) {
    let best = matchScore(q, place.key);
    for (const alias of place.aliases) best = Math.max(best, matchScore(q, alias) * 0.95);
    if (best <= 0) continue;
    out.push({
      label: place.name,
      lat: place.lat,
      lng: place.lng,
      kind: 'place',
      detail: REGION_LABELS[place.region],
      score: best * 100 + tieBreak(place.population, place, near),
    });
  }

  for (const site of ctx.data.sites) {
    if (ctx.request.hidden.has(site.id)) continue;
    const score = matchScore(q, canonical(site.name));
    if (score <= 0) continue;
    out.push({
      label: site.name,
      lat: site.lat,
      lng: site.lng,
      kind: 'site',
      detail: [SITE_TYPE_LABELS[site.category], site.county].filter(Boolean).join(', '),
      siteId: site.id,
      score: score * 100 + tieBreak(0, site, near),
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

function fromCandidates(best: Candidate, rest: Candidate[]): ResolvedPlace {
  const alternatives = rest
    .filter((c) => c.label === best.label)
    .slice(0, 3)
    .map(({ label, lat, lng, detail }) => ({ label, lat, lng, detail }));
  return {
    found: true,
    label: best.label,
    lat: best.lat,
    lng: best.lng,
    kind: best.kind,
    detail: best.detail,
    ...(best.siteId ? { siteId: best.siteId } : {}),
    ...(alternatives.length ? { alternatives } : {}),
  };
}

export async function resolvePlace(ctx: ToolContext, args: { text: string }): Promise<ResolvePlaceResult> {
  const text = String(args.text ?? '').trim();
  if (!text) return { found: false, text };
  if (HERE.has(canonical(text))) {
    return { found: false, text, hint: 'This is the live position. Use find_sites with near: "position".' };
  }

  // A site id, copied from a shortlist. Hidden sites stay hidden.
  const byId = ctx.request.hidden.has(text) ? undefined : ctx.data.byId.get(text);
  if (byId) {
    return { found: true, label: byId.name, lat: byId.lat, lng: byId.lng, kind: 'site', siteId: byId.id, detail: SITE_TYPE_LABELS[byId.category] };
  }

  const coords = parseCoords(text);
  if (coords) return { found: true, label: coords.label, lat: coords.lat, lng: coords.lng, kind: 'coords', detail: coords.detail };

  const postcode = parsePostcode(text);
  if (postcode) {
    const exact = postcode.inward ? await ctx.net.postcode(postcode) : null;
    if (exact) return { found: true, label: exact.label, lat: exact.lat, lng: exact.lng, kind: 'postcode', detail: exact.detail };
    const district = resolveOffline(postcode, ctx.data.gazetteer);
    if (district) {
      return {
        found: true,
        label: district.label,
        lat: district.lat,
        lng: district.lng,
        kind: 'postcode',
        detail: district.detail,
        ...(postcode.inward ? { approximate: true as const } : {}),
      };
    }
  }

  // An exact name, of a place or of a site, is the answer. Anything weaker
  // waits until Photon has had its say.
  const local = localCandidates(ctx, text);
  const exact = local.filter((c) => c.score >= 100);
  if (exact.length) return fromCandidates(exact[0], exact.slice(1));

  const online = (await ctx.net.photon(text, ctx.request.position)).filter(
    (r) => inBritain(r) && sharesMainWord(text, r.label),
  );
  if (online.length) {
    const [first] = online;
    return { found: true, label: first.label, lat: first.lat, lng: first.lng, kind: 'place', detail: first.detail };
  }

  if (local.length) return fromCandidates(local[0], local.slice(1));
  return { found: false, text };
}
