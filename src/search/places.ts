import { canonical } from './normalize';
import type { Gazetteer, PlaceKind, PlaceRegion } from './gazetteerFormat';

// The offline place dictionary (issue #28). Built by scripts/build-gazetteer.ts,
// shipped as public/data/places.json, precached by Workbox next to sites.json.
// This is what makes search work in a Highland glen with no signal — the online
// provider is an enhancement layered on top, never a dependency.
//
// The wire format itself lives in ./gazetteerFormat, shared with the build
// script. This module is the app-side half: fetch, decode, and precompute the
// match keys.

export type {
  PlaceRegion,
  PlaceKind,
  PlaceTuple,
  OutcodeTuple,
  Gazetteer,
} from './gazetteerFormat';

/** A decoded place, with its match keys precomputed. */
export interface Place {
  name: string;
  lat: number;
  lng: number;
  population: number;
  region: PlaceRegion;
  kind: PlaceKind;
  /** Canonical form of `name` — the primary match key. */
  key: string;
  /**
   * Canonical forms of any alternate names. Matched at a small penalty, so an
   * exact hit on a place's REAL name always beats an exact hit on some other
   * place's alias — otherwise Newport-on-Tay, which lists "Newport" among its
   * alternate names, outranks the city of Newport.
   */
  aliases: string[];
}

export interface Outcode {
  code: string;
  lat: number;
  lng: number;
}

export interface LoadedGazetteer {
  places: Place[];
  outcodes: Map<string, Outcode>;
  attribution: string;
}

export const REGION_LABELS: Record<PlaceRegion, string> = {
  ENG: 'England',
  SCT: 'Scotland',
  WLS: 'Wales',
  NIR: 'Northern Ireland',
};

const EMPTY: LoadedGazetteer = { places: [], outcodes: new Map(), attribution: '' };

let cache: Promise<LoadedGazetteer> | null = null;

/**
 * Load and decode the dictionary. Memoised, so the parse and the canonical-form
 * precompute happen once per session however many times search is opened.
 *
 * A missing or broken file is NOT fatal: search degrades to sites, postcodes,
 * coordinates and whatever the network can offer. That keeps a bad gazetteer
 * build from taking the whole app down.
 */
export function loadGazetteer(): Promise<LoadedGazetteer> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}data/places.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Gazetteer>;
      })
      .then(decodeGazetteer)
      .catch((err: unknown) => {
        console.warn('Offline place dictionary unavailable:', err);
        return EMPTY;
      });
  }
  return cache;
}

/**
 * Decode the wire format into the in-memory form. Exported so anything that
 * reads places.json directly (the offline-search check in scripts/, say) goes
 * through the SAME decoding the app uses, rather than a copy that can drift.
 */
export function decodeGazetteer(raw: Gazetteer): LoadedGazetteer {
  const places: Place[] = (raw.places ?? []).map(
    ([name, lat, lng, population, region, kind, aliases]) => ({
      name,
      lat,
      lng,
      population,
      region,
      kind,
      // Canonicalised once, here, rather than on every keystroke of every
      // search. Aliases are how "Snowdonia" finds Eryri.
      key: canonical(name),
      aliases: (aliases ?? []).map(canonical).filter(Boolean),
    }),
  );

  const outcodes = new Map<string, Outcode>();
  for (const [code, lat, lng] of raw.outcodes ?? []) {
    outcodes.set(code, { code, lat, lng });
  }

  return { places, outcodes, attribution: raw.attribution ?? '' };
}

/** Test seam: drop the memoised dictionary. */
export function resetGazetteer(): void {
  cache = null;
}
