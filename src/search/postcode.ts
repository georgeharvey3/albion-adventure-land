import type { LoadedGazetteer } from './places';
import type { SearchResult } from './types';

// UK postcode search (issue #28), in two tiers so it never fully disappears:
//
//   • ONLINE  — postcodes.io resolves a full postcode to its actual point. This
//     is the same free service scripts/geocode.ts already trusts at build time.
//   • OFFLINE — the outward code ("PH22") comes out of the shipped dictionary.
//     Only outward codes ship: the full Royal Mail set is not open data, and
//     1.7M points would dwarf the rest of the app anyway. An outward code pins
//     you to a few square miles, which is the right resolution for "what's near
//     where I'm heading".
//
// So typing a full postcode offline still gets you somewhere — the district it
// sits in, honestly labelled as approximate — rather than nothing.

const POSTCODES_IO = 'https://api.postcodes.io/postcodes';

// Outward code: 1-2 letters, 1-2 digits, optional trailing letter (W1A, EC1A,
// PH22, B1). Deliberately looser than full postcode validation — this is a
// search box, not a form.
const OUTWARD = /^[A-Z]{1,2}\d[A-Z\d]?$/;
const FULL = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;

export interface ParsedPostcode {
  outward: string;
  inward?: string;
  /** Canonical spaced form: "PH22 1RB", or just "PH22". */
  formatted: string;
}

/** Read the query as a postcode, full or outward-only. Null if it isn't one. */
export function parsePostcode(query: string): ParsedPostcode | null {
  const text = query.toUpperCase().replace(/\s+/g, '');
  if (!text) return null;

  const full = FULL.exec(text);
  if (full) {
    return { outward: full[1], inward: full[2], formatted: `${full[1]} ${full[2]}` };
  }
  if (OUTWARD.test(text)) {
    return { outward: text, formatted: text };
  }
  return null;
}

/**
 * Resolve a postcode from the shipped dictionary alone. Always available, never
 * touches the network. A full postcode falls back to its outward centroid and
 * says so, so the user knows the pin is district-accurate, not door-accurate.
 */
export function resolveOffline(
  parsed: ParsedPostcode,
  gazetteer: LoadedGazetteer,
): SearchResult | null {
  const hit = gazetteer.outcodes.get(parsed.outward);
  if (!hit) return null;

  return {
    id: `postcode:${parsed.outward}`,
    kind: 'postcode',
    label: parsed.formatted,
    detail: parsed.inward ? `${parsed.outward} district (approximate)` : 'Postcode district',
    lat: hit.lat,
    lng: hit.lng,
    source: 'offline',
    // Below a pasted coordinate, above any name match: someone who types a
    // postcode means that postcode.
    score: 90,
  };
}

/**
 * Resolve a FULL postcode exactly, via postcodes.io. Returns null on any
 * failure — no signal, timeout, unknown postcode — because the offline result
 * is already on screen and a thrown error would replace a useful answer with
 * an error message.
 */
export async function resolveOnline(
  parsed: ParsedPostcode,
  signal: AbortSignal,
): Promise<SearchResult | null> {
  if (!parsed.inward) return null; // outward-only is served from the dictionary

  try {
    const res = await fetch(
      `${POSTCODES_IO}/${encodeURIComponent(parsed.formatted.replace(/\s/g, ''))}`,
      { signal },
    );
    if (!res.ok) return null;

    const body = (await res.json()) as {
      result?: { latitude: number; longitude: number; admin_district?: string };
    };
    if (!body.result) return null;

    const { latitude, longitude, admin_district } = body.result;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return {
      // SAME id as the offline district result on purpose: de-duplication keeps
      // the higher-scoring row, so an exact online fix REPLACES the approximate
      // district one rather than sitting next to it as a confusing near-twin.
      id: `postcode:${parsed.outward}`,
      kind: 'postcode',
      label: parsed.formatted,
      detail: admin_district ?? 'Postcode',
      lat: latitude,
      lng: longitude,
      source: 'online',
      score: 95,
    };
  } catch {
    return null;
  }
}
