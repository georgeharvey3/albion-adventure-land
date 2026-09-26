// read_sites (issue #62): the full write-up of a few sites.
//
// find_sites gives a summary so the model can choose; this gives everything
// the data holds about the ones it chose, so it can answer from facts and not
// from guesses. Every source's write-up of a merged place comes back under its
// layer, as it does on the site card (issue #37). Opening hours come with the
// survey date, as they do on the card: an opening time with no date behind it
// is a claim the app cannot stand behind.

import {
  PARENT_CATEGORY_LABELS,
  SITE_TYPE_LABELS,
  categoriesOf,
  parentOf,
  pubGrade,
  type OpeningHours,
  type Site,
} from '../../src/data/types';
import type { ToolContext } from './context';

export interface SiteReading {
  id: string;
  name: string;
  type: string;
  alsoTypes?: string[];
  county?: string;
  postcode?: string;
  lat: number;
  lng: number;
  description?: string;
  entries?: { layer: string; description: string }[];
  tags?: string[];
  walkTime?: string;
  access?: string;
  heritageGrade?: number;
  hours?: OpeningHours[];
  lastSurveyed?: string;
  listing?: string;
  visited?: true;
  wishlisted?: true;
}

export interface ReadSitesResult {
  sites: SiteReading[];
  notFound?: string[];
}

export const MAX_IDS = 8;

export function readSites(ctx: ToolContext, args: { ids: string[] }): ReadSitesResult {
  const { data, request } = ctx;
  const sites: SiteReading[] = [];
  const notFound: string[] = [];

  for (const id of (args.ids ?? []).map(String)) {
    const site = request.hidden.has(id) ? undefined : data.byId.get(id);
    if (!site) notFound.push(id);
    else if (sites.length < MAX_IDS) sites.push(reading(site, request.visited.has(id), request.wishlist.has(id)));
  }

  return notFound.length ? { sites, notFound } : { sites };
}

function reading(site: Site, visited: boolean, wishlisted: boolean): SiteReading {
  const [own, ...also] = categoriesOf(site);
  const entries = site.entries?.filter((e) => e.description);
  const grade = pubGrade(site);
  return {
    id: site.id,
    name: site.name,
    type: SITE_TYPE_LABELS[own],
    ...(also.length ? { alsoTypes: also.map((c) => SITE_TYPE_LABELS[c]) } : {}),
    ...(site.county ? { county: site.county } : {}),
    ...(site.postcode ? { postcode: site.postcode } : {}),
    lat: site.lat,
    lng: site.lng,
    ...(entries?.length
      ? { entries: entries.map((e) => ({ layer: PARENT_CATEGORY_LABELS[parentOf(e.category)], description: e.description! })) }
      : site.description
        ? { description: site.description }
        : {}),
    ...(site.tags?.length ? { tags: site.tags } : {}),
    ...(site.walkTime ? { walkTime: site.walkTime } : {}),
    ...(site.access ? { access: site.access } : {}),
    ...(grade ? { heritageGrade: grade } : {}),
    ...(site.hours?.length ? { hours: site.hours } : {}),
    ...(site.hours?.length && site.lastSurveyed ? { lastSurveyed: site.lastSurveyed } : {}),
    ...(site.listingTitle ? { listing: site.listingTitle } : {}),
    ...(visited ? { visited: true as const } : {}),
    ...(wishlisted ? { wishlisted: true as const } : {}),
  };
}
