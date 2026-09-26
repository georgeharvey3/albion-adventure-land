// A small, hand-made world for the tool tests: a few sites along the road from
// Sheffield to Winchester and a few well off it, and a place dictionary with
// the names the tests ask for. Coordinates are real, so the geometry is real.

import type { Site } from '../../src/data/types';
import { decodeGazetteer } from '../../src/search/places';
import { siteData, type SiteData } from '../data';
import type { Net } from '../net';
import { requestState, type ToolContext } from './context';
import type { AskRequest } from '../types';
import type { Route } from '../../src/geo/route';

export const SHEFFIELD = { lat: 53.383, lng: -1.4659 };
export const WINCHESTER = { lat: 51.0651, lng: -1.3187 };

function site(partial: Partial<Site> & Pick<Site, 'id' | 'name' | 'lat' | 'lng' | 'category'>): Site {
  return { source: 'test', ...partial };
}

export const SITES: Site[] = [
  // On the way, near Oxford (the M1/M40/A34 line).
  site({
    id: 'port-meadow',
    name: 'Port Meadow',
    lat: 51.772,
    lng: -1.281,
    category: 'wild_swims',
    county: 'Oxfordshire',
    tags: ['Long swim possible'],
    walkTime: '10 mins',
    description: 'Wide shallow Thames meadow reach, good for a paddle and a long swim upstream.',
  }),
  // On the way, near Newbury: a deep lake.
  site({
    id: 'deep-lake',
    name: 'Deep Lake',
    lat: 51.41,
    lng: -1.3,
    category: 'wild_swims',
    county: 'Berkshire',
    tags: ['Jump or rope swing'],
    description: 'A deep, clear flooded gravel pit. No Swimming signs, but people swim.',
  }),
  // On the way, near Derby.
  site({
    id: 'derwent-reach',
    name: 'Derwent Reach',
    lat: 52.95,
    lng: -1.46,
    category: 'wild_swims',
    county: 'Derbyshire',
    description: 'Shallow gravel river reach, a paddling spot for children.',
  }),
  // Near the route, but hidden by the user.
  site({
    id: 'hidden-pool',
    name: 'Hidden Pool',
    lat: 52.4,
    lng: -1.49,
    category: 'wild_swims',
    county: 'Warwickshire',
    description: 'A deep pool.',
  }),
  // Near the route, but already visited.
  site({
    id: 'visited-weir',
    name: 'Visited Weir',
    lat: 52.2,
    lng: -1.42,
    category: 'wild_swims',
    county: 'Oxfordshire',
    description: 'Deep water below a weir.',
  }),
  // Far off the route, in Cornwall.
  site({
    id: 'cornish-quarry',
    name: 'Cornish Quarry',
    lat: 50.17,
    lng: -5.53,
    category: 'wild_swims',
    county: 'Cornwall',
    description: 'A very deep quarry pool.',
  }),
  // On the way, but a pub.
  site({
    id: 'oxford-pub',
    name: 'The Oxford Pub',
    lat: 51.75,
    lng: -1.26,
    category: 'historic_pubs',
    county: 'Oxfordshire',
    tags: ['3-star'],
    hours: [{ day: 'saturday', opens: '12:00', closes: '23:00' }],
    lastSurveyed: '2025-05-01',
  }),
  // A folklore site in Winchester, for the parent-category filter.
  site({
    id: 'winchester-well',
    name: 'St Swithun Well',
    lat: 51.06,
    lng: -1.31,
    category: 'wells',
    county: 'Hampshire',
    description: 'A holy well.',
  }),
  // A merged place: a ruin that is also a hillfort.
  site({
    id: 'old-sarum',
    name: 'Old Sarum',
    lat: 51.093,
    lng: -1.804,
    category: 'ruins',
    alsoCategories: ['hillforts'],
    county: 'Wiltshire',
    description: 'Ruined castle and cathedral inside an Iron Age hillfort.',
    entries: [
      { source: 'ruins', category: 'ruins', description: 'Ruined castle and cathedral.' },
      { source: 'magical', category: 'hillforts', description: 'Iron Age hillfort with a legend.' },
    ],
  }),
  // Closed and merged-away rows: the data keeps them, the server drops them.
  site({
    id: 'closed-pub',
    name: 'Closed Pub',
    lat: 51.76,
    lng: -1.27,
    category: 'historic_pubs',
    closure: { label: 'Temporarily Closed', note: 'Shut.' },
  }),
  site({ id: 'sarum-dupe', name: 'Old Sarum Hillfort', lat: 51.093, lng: -1.804, category: 'hillforts', duplicateOf: 'old-sarum' }),
];

export const GAZETTEER = decodeGazetteer({
  version: 1,
  generated: 'test',
  attribution: 'test',
  places: [
    ['Sheffield', 53.383, -1.4659, 685368, 'ENG', 'city', ['Seffild']],
    ['Winchester', 51.0651, -1.3187, 46074, 'ENG', 'town', ['Caerwynt']],
    ['Newport', 52.7668, -2.3773, 12741, 'ENG', 'town'],
    ['Newport', 51.5877, -2.9983, 306844, 'WLS', 'city', ['Casnewydd']],
    ['Oxford', 51.752, -1.2577, 154600, 'ENG', 'city'],
  ],
  outcodes: [['SO23', 51.07, -1.31]],
});

export const DATA: SiteData = siteData(SITES, GAZETTEER);

/** A straight-ish road from Sheffield to Winchester through Derby, the M40
 *  line and Newbury. Good enough to measure detours against. */
export const ROUTE: Route = {
  points: [
    SHEFFIELD,
    { lat: 52.95, lng: -1.47 },
    { lat: 52.4, lng: -1.5 },
    { lat: 51.77, lng: -1.28 },
    { lat: 51.41, lng: -1.31 },
    WINCHESTER,
  ],
  distance: 290000,
  duration: 3.2 * 3600,
};

/** A network that answers from the given maps, and records what was asked. */
export function fakeNet(answers: {
  photon?: Record<string, { label: string; lat: number; lng: number }[]>;
  postcode?: Record<string, { lat: number; lng: number }>;
  route?: Route | null;
} = {}): Net & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async photon(query) {
      calls.push(`photon:${query}`);
      return (answers.photon?.[query] ?? []).map((p) => ({
        id: `photon:${p.lat},${p.lng}`,
        kind: 'place',
        label: p.label,
        lat: p.lat,
        lng: p.lng,
        source: 'online',
        score: 0,
      }));
    },
    async postcode(parsed) {
      calls.push(`postcode:${parsed.formatted}`);
      const hit = answers.postcode?.[parsed.formatted];
      return hit
        ? { id: `postcode:${parsed.outward}`, kind: 'postcode', label: parsed.formatted, source: 'online', score: 95, ...hit }
        : null;
    },
    async route() {
      calls.push('route');
      return answers.route ?? null;
    },
  };
}

export function context(
  request: Partial<AskRequest> = {},
  extra: Partial<ToolContext> = {},
): ToolContext {
  return {
    data: DATA,
    net: fakeNet(),
    semantic: null,
    request: requestState({ question: '', now: '2026-09-26T10:00', ...request }),
    ...extra,
  };
}
