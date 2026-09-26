// The three network services Ethelred's tools call (issue #62): Photon for
// place names, postcodes.io for full postcodes and OSRM for road routes.
//
// They sit behind one small interface so the eval can swap in recorded
// responses. A run then depends only on the model, and it works offline. Every
// method keeps the contract of the app-side client it wraps: a failure is an
// empty answer, never a thrown error.

import type { LatLng } from '../src/geo/haversine';
import { fetchRoute } from '../src/geo/osrm';
import type { Route } from '../src/geo/route';
import { searchPhoton } from '../src/search/photon';
import { resolveOnline, type ParsedPostcode } from '../src/search/postcode';
import type { SearchResult } from '../src/search/types';

export interface Net {
  photon(query: string, near: LatLng | null): Promise<SearchResult[]>;
  postcode(parsed: ParsedPostcode): Promise<SearchResult | null>;
  route(from: LatLng, to: LatLng): Promise<Route | null>;
}

export const liveNet: Net = {
  photon: (query, near) => searchPhoton(query, near, new AbortController().signal),
  postcode: (parsed) => resolveOnline(parsed, new AbortController().signal),
  route: fetchRoute,
};

/** A network with no signal. Every call answers empty. */
export const offlineNet: Net = {
  photon: async () => [],
  postcode: async () => null,
  route: async () => null,
};
