// The server's copy of the site data and the place dictionary (issue #62).
//
// Both files come from the same build as the app (docs/adr/0002-ethelred-
// server.md), so a site id, a place name and a corridor mean the same thing on
// the phone and here. The server drops closed sites and merged-away duplicates
// with the same filter as the store (src/state/store.ts): Ethelred can never
// name a site that the map would refuse to show.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Site } from '../src/data/types';
import type { Gazetteer } from '../src/search/gazetteerFormat';
import { decodeGazetteer, type LoadedGazetteer } from '../src/search/places';

export interface SiteData {
  /** Every site the app shows: no closed sites, no merged-away duplicates. */
  sites: Site[];
  byId: Map<string, Site>;
  gazetteer: LoadedGazetteer;
}

export const ROOT = resolve(import.meta.dirname, '..');

export function siteData(all: Site[], gazetteer: LoadedGazetteer): SiteData {
  const sites = all.filter((s) => !s.closure && !s.duplicateOf);
  return { sites, byId: new Map(sites.map((s) => [s.id, s])), gazetteer };
}

export function loadSiteData(root = ROOT): SiteData {
  const all = JSON.parse(readFileSync(resolve(root, 'public/data/sites.json'), 'utf8')) as Site[];
  const raw = JSON.parse(readFileSync(resolve(root, 'public/data/places.json'), 'utf8')) as Gazetteer;
  return siteData(all, decodeGazetteer(raw));
}
