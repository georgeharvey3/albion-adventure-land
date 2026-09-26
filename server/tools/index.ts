// The three tools Ethelred can call (issue #62), as the model sees them, and
// the one dispatcher the agent loop calls them through.
//
// The descriptions are part of the prompt. They say what each slot means in
// the app's own words, because a model that fills a slot wrongly gives a wrong
// answer that looks right.

import type { ToolSpec } from '../model';
import type { ToolContext } from './context';
import {
  DEFAULT_DETOUR_KM,
  DEFAULT_LIMIT,
  DEFAULT_RADIUS_KM,
  findSites,
  MAX_LIMIT,
  TYPE_NAMES,
  type FindSitesArgs,
} from './findSites';
import { MAX_IDS, readSites } from './readSites';
import { resolvePlace } from './resolvePlace';

const point = {
  type: 'object',
  properties: { lat: { type: 'number' }, lng: { type: 'number' }, label: { type: 'string' } },
  required: ['lat', 'lng'],
};

const place = {
  anyOf: [{ type: 'string', description: 'A place name, postcode or grid reference; "position"; or "selection".' }, point],
};


export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'resolve_place',
    description:
      'Turn a place name, a UK postcode, an OS grid reference or the name of a site into coordinates. ' +
      'find_sites resolves place names itself, so call this only to check where a place is or to choose between places with one name.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The place as the user wrote it, e.g. "Winchester", "SO23 9LS", "SU 482 293".' } },
      required: ['text'],
    },
  },
  {
    name: 'find_sites',
    description:
      'Search the site data and return a ranked shortlist with a short summary of each site. ' +
      'Give exactly one place: `near`, `journey` (origin and destination, or "current" for the journey set in the app) or `county`. ' +
      'A place can be a name as the user wrote it ("Keswick", "LD3 7HP", "SH 609 543"), "position" for the live position, ' +
      '"selection" for the site the app shows, or {lat, lng}. Names are resolved for you. ' +
      'Hidden sites never appear. Visited sites come last unless includeVisited is true.',
    parameters: {
      type: 'object',
      properties: {
        near: place,
        journey: {
          anyOf: [
            { type: 'object', properties: { origin: place, destination: place }, required: ['origin', 'destination'] },
            { type: 'string', enum: ['current'] },
          ],
        },
        county: { type: 'string', description: 'A county or area name as the data writes it, e.g. "Gwynedd", "Cornwall".' },
        types: {
          type: 'array',
          items: { type: 'string', enum: TYPE_NAMES },
          description:
            'wild_swims: swimming places from the wild swimming guidebook (rivers, lakes, pools, waterfalls, lidos). ' +
            'ruins: ruined castles, abbeys and houses. scrambles: hands-on mountain routes. historic_pubs: CAMRA heritage pubs. ' +
            '"folklore" covers every folklore type: wells, natural_water_features, wild_places, hills, hillforts, earthworks, ' +
            'burial_chambers, standing_stones, stone_circles, natural_stones, sacred_buildings, caves, other. ' +
            'The folklore types are places of legend, not places to swim. Leave empty for every type.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Guidebook tags, any one of which must match, e.g. "Waterfall", "Kids / paddling", "Jump or rope swing", "3-star".',
        },
        meaning: {
          type: 'string',
          description: 'What the user wants, in a few words, to rank the shortlist by meaning, e.g. "deep water for a long swim".',
        },
        includeVisited: { type: 'boolean', description: 'True only when the user asks about places they have already visited.' },
        limit: { type: 'integer', description: `How many sites to return. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` },
        radiusKm: { type: 'number', description: `For near: how far to look. Default ${DEFAULT_RADIUS_KM}.` },
        detourKm: { type: 'number', description: `For journey: the extra kilometres the user will drive to visit. Default ${DEFAULT_DETOUR_KM}.` },
      },
    },
  },
  {
    name: 'read_sites',
    description:
      `Read everything the data holds about up to ${MAX_IDS} sites: the full description, every guidebook entry, ` +
      'opening hours, access and walk time. Read a site before you describe it.',
    parameters: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } } },
      required: ['ids'],
    },
  },
];

export interface ToolOutcome {
  result: unknown;
  siteIds: string[];
}

/** Run one tool call. A bad call is an error result for the model to read and
 *  correct, never a thrown exception. */
export async function runTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    switch (name) {
      case 'resolve_place': {
        const result = await resolvePlace(ctx, args as { text: string });
        return { result, siteIds: result.found && result.siteId ? [result.siteId] : [] };
      }
      case 'find_sites': {
        const result = await findSites(ctx, args as FindSitesArgs);
        return { result, siteIds: 'sites' in result ? result.sites.map((s) => s.id) : [] };
      }
      case 'read_sites': {
        const result = readSites(ctx, args as { ids: string[] });
        return { result, siteIds: result.sites.map((s) => s.id) };
      }
      default:
        return { result: { error: `There is no tool called ${name}.` }, siteIds: [] };
    }
  } catch (err) {
    return { result: { error: `The tool failed: ${(err as Error).message}` }, siteIds: [] };
  }
}
