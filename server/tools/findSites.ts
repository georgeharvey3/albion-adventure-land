// find_sites (issue #62): the ranked shortlist.
//
// The code holds the pipeline and the model fills the slots. One call makes
// one cut, in a fixed order:
//
//   1. the types, the tags and the hidden sites;
//   2. the place: near a point, along a journey, or in a county;
//   3. the order: by meaning when `meaning` is given and the index is loaded,
//      else by distance (near), by least detour (journey) or by name (county);
//   4. the visited sites: they go to the back, unless the user asks for them.
//
// The journey corridor is the app's own. A road route from OSRM replaces the
// ellipse completely, and with no route the ellipse is the answer
// (docs/adr/0001-road-route-corridor.md). So "on the way" means one thing on
// the phone and here.

import { corridorMetrics, DEFAULT_DETOUR_BUDGET } from '../../src/geo/corridor';
import { haversine, type LatLng } from '../../src/geo/haversine';
import { prepareRoute, routeMetrics } from '../../src/geo/route';
import { canonical } from '../../src/search/normalize';
import {
  PARENT_CATEGORIES,
  SITE_TYPES,
  SITE_TYPE_LABELS,
  categoriesOf,
  parentOf,
  type Site,
  type SiteCategory,
} from '../../src/data/types';
import type { AnswerContext, NamedPoint } from '../types';
import type { ToolContext } from './context';
import { resolvePlace } from './resolvePlace';

/** A point slot: coordinates, the live position, the selected site, or a
 *  place name, which is resolved as resolve_place would. Taking the name lets
 *  a small model skip copying coordinates, which it gets wrong. */
export type PointArg = LatLng | 'position' | 'selection' | string;

export interface FindSitesArgs {
  near?: PointArg;
  journey?: { origin: PointArg; destination: PointArg } | 'current';
  county?: string;
  types?: string[];
  tags?: string[];
  meaning?: string;
  includeVisited?: boolean;
  limit?: number;
  radiusKm?: number;
  detourKm?: number;
}

export interface ShortlistSite {
  id: string;
  name: string;
  type: string;
  /** The other layers a merged place is findable under. */
  alsoTypes?: string[];
  county?: string;
  tags?: string[];
  walkTime?: string;
  /** Near mode: straight-line km from the point. */
  distanceKm?: number;
  /** Journey mode: extra km driven to visit, and % of the way along. */
  detourKm?: number;
  progress?: number;
  visited?: true;
  wishlisted?: true;
  /** The start of the description, enough to judge whether to read it. */
  summary?: string;
}

export type FindSitesResult =
  | {
      context: AnswerContext;
      total: number;
      sites: ShortlistSite[];
      routeKm?: number;
      driveMinutes?: number;
      note?: string;
    }
  | { error: string };

export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 20;
export const DEFAULT_DETOUR_KM = DEFAULT_DETOUR_BUDGET / 1000;
export const DEFAULT_RADIUS_KM = 25;
const SUMMARY_CHARS = 220;

/** Every name the type slot accepts: the leaf types, then the parent
 *  categories that are not leaves themselves. */
export const TYPE_NAMES: readonly string[] = [...new Set<string>([...SITE_TYPES, ...PARENT_CATEGORIES])];

/** Resolve the type slot to the leaf categories it covers. A parent category
 *  ("folklore") covers all its leaves. */
function leavesFor(types: readonly string[]): Set<SiteCategory> | string {
  const out = new Set<SiteCategory>();
  for (const raw of types) {
    const t = raw.trim().toLowerCase().replace(/[^a-z]+/g, '_');
    if ((SITE_TYPES as string[]).includes(t)) out.add(t as SiteCategory);
    else if ((PARENT_CATEGORIES as string[]).includes(t)) {
      for (const leaf of SITE_TYPES) if (parentOf(leaf) === t) out.add(leaf);
    } else return `Unknown type "${raw}". Use one of: ${TYPE_NAMES.join(', ')}.`;
  }
  return out;
}

function isPoint(v: unknown): v is LatLng {
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isFinite((v as LatLng).lat) &&
    Number.isFinite((v as LatLng).lng)
  );
}

function summary(site: Site): string | undefined {
  const text = site.description ?? site.entries?.find((e) => e.description)?.description;
  if (!text) return undefined;
  return text.length <= SUMMARY_CHARS ? text : `${text.slice(0, SUMMARY_CHARS).replace(/\s+\S*$/, '')}…`;
}

/** The point a slot names, or the reason it names none. */
async function resolvePoint(ctx: ToolContext, v: PointArg | undefined): Promise<NamedPoint | string> {
  const { request, data } = ctx;
  if (v === 'position') {
    return request.position
      ? { ...request.position, label: 'Current position' }
      : 'The device sent no position. Ask the user where they are, or name a place.';
  }
  if (v === 'selection') {
    const selected = request.selection ? data.byId.get(request.selection) : undefined;
    return selected ? { lat: selected.lat, lng: selected.lng, label: selected.name } : 'The app has no site selected.';
  }
  if (typeof v === 'string' && v.trim()) {
    const place = await resolvePlace(ctx, { text: v });
    return place.found ? { lat: place.lat, lng: place.lng, label: place.label } : `Could not find the place "${v}".`;
  }
  if (isPoint(v)) return v;
  return 'A place must be {lat, lng}, a place name, "position" or "selection".';
}

const round1 = (n: number) => Math.round(n * 10) / 10;

interface Candidate {
  site: Site;
  /** The order key when there is no meaning: lower first. */
  order: number;
  distanceKm?: number;
  detourKm?: number;
  progress?: number;
}

export async function findSites(ctx: ToolContext, args: FindSitesArgs): Promise<FindSitesResult> {
  const { request, data } = ctx;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.round(args.limit ?? DEFAULT_LIMIT)));

  let leaves: Set<SiteCategory> | null = null;
  if (args.types?.length) {
    const resolved = leavesFor(args.types);
    if (typeof resolved === 'string') return { error: resolved };
    leaves = resolved;
  }
  const tags = args.tags?.length ? new Set(args.tags.map((t) => t.trim().toLowerCase())) : null;

  // --- 1. The types, the tags and the hidden sites ------------------------
  const eligible = data.sites.filter(
    (s) =>
      !request.hidden.has(s.id) &&
      (!leaves || categoriesOf(s).some((c) => leaves!.has(c))) &&
      (!tags || (s.tags ?? []).some((t) => tags.has(t.toLowerCase()))),
  );

  // --- 2. The place -------------------------------------------------------
  let context: AnswerContext;
  let candidates: Candidate[];
  let routeInfo: { routeKm?: number; driveMinutes?: number } = {};

  if (args.journey) {
    let journey = args.journey === 'current' ? request.journey : null;
    if (args.journey === 'current') {
      if (!journey) return { error: 'The app has no journey set. Give the origin and the destination.' };
    } else {
      const origin = await resolvePoint(ctx, args.journey.origin);
      if (typeof origin === 'string') return { error: `origin: ${origin}` };
      const destination = await resolvePoint(ctx, args.journey.destination);
      if (typeof destination === 'string') return { error: `destination: ${destination}` };
      journey = { origin, destination };
    }
    const budget = (args.detourKm ?? DEFAULT_DETOUR_KM) * 1000;
    const route = await ctx.net.route(journey.origin, journey.destination);
    const prepared = route ? prepareRoute(route) : null;
    context = { kind: 'journey', origin: journey.origin, destination: journey.destination, route: prepared ? 'road' : 'direct' };
    if (route && prepared) routeInfo = { routeKm: Math.round(route.distance / 1000), driveMinutes: Math.round(route.duration / 60) };

    candidates = [];
    for (const site of eligible) {
      const m = prepared ? routeMetrics(site, prepared) : corridorMetrics(site, journey.origin, journey.destination);
      if (m.detour > budget) continue;
      candidates.push({ site, order: m.detour, detourKm: round1(m.detour / 1000), progress: Math.round(m.progress * 100) });
    }
  } else if (args.near !== undefined) {
    const point = await resolvePoint(ctx, args.near);
    if (typeof point === 'string') return { error: point };

    const radius = (args.radiusKm ?? DEFAULT_RADIUS_KM) * 1000;
    context = { kind: 'near', point };
    candidates = [];
    for (const site of eligible) {
      const d = haversine(point, site);
      if (d > radius) continue;
      candidates.push({ site, order: d, distanceKm: round1(d / 1000) });
    }
  } else if (args.county) {
    const county = canonical(args.county);
    context = { kind: 'county', county: args.county };
    const from = request.position;
    candidates = eligible
      .filter((s) => s.county && canonical(s.county).includes(county))
      .map((site) => {
        const d = from ? haversine(from, site) : undefined;
        return { site, order: d ?? 0, ...(d !== undefined ? { distanceKm: round1(d / 1000) } : {}) };
      });
    if (!from) candidates.sort((a, b) => a.site.name.localeCompare(b.site.name));
  } else {
    return { error: 'Give a place: near, journey or county.' };
  }

  // --- 3. The order -------------------------------------------------------
  const scores =
    args.meaning && ctx.semantic && candidates.length
      ? await ctx.semantic.score(args.meaning, candidates.map((c) => c.site.id))
      : null;

  const byOrder = (a: Candidate, b: Candidate) => a.order - b.order;
  const byMeaning = (a: Candidate, b: Candidate) =>
    (scores!.get(b.site.id) ?? -1) - (scores!.get(a.site.id) ?? -1) || byOrder(a, b);
  const rank = (list: Candidate[]) => [...list].sort(scores ? byMeaning : byOrder);

  // --- 4. The visited sites ------------------------------------------------
  const visited = (c: Candidate) => request.visited.has(c.site.id);
  let ranked = args.includeVisited
    ? rank(candidates)
    : [...rank(candidates.filter((c) => !visited(c))), ...rank(candidates.filter(visited))];

  const visitedCut = ranked.slice(limit).filter(visited).length;
  ranked = ranked.slice(0, limit);

  // A journey shortlist is picked by least detour, and it reads best in the
  // order you drive past it. A shortlist picked by meaning keeps its meaning
  // order. Visited sites stay at the back either way.
  if (context.kind === 'journey' && !scores) {
    const group = (c: Candidate) => (!args.includeVisited && visited(c) ? 1 : 0);
    ranked.sort((a, b) => group(a) - group(b) || a.progress! - b.progress!);
  }

  return {
    context,
    total: candidates.length,
    ...routeInfo,
    ...(visitedCut && !args.includeVisited
      ? { note: `${visitedCut} visited site${visitedCut === 1 ? '' : 's'} also matched but did not fit the limit. Set includeVisited to see them.` }
      : {}),
    sites: ranked.map((c) => shortlistSite(c, request.visited.has(c.site.id), request.wishlist.has(c.site.id))),
  };
}

function shortlistSite(c: Candidate, visited: boolean, wishlisted: boolean): ShortlistSite {
  const [own, ...also] = categoriesOf(c.site);
  return {
    id: c.site.id,
    name: c.site.name,
    type: SITE_TYPE_LABELS[own],
    ...(also.length ? { alsoTypes: also.map((a) => SITE_TYPE_LABELS[a]) } : {}),
    ...(c.site.county ? { county: c.site.county } : {}),
    ...(c.site.tags?.length ? { tags: c.site.tags } : {}),
    ...(c.site.walkTime ? { walkTime: c.site.walkTime } : {}),
    ...(c.distanceKm !== undefined ? { distanceKm: c.distanceKm } : {}),
    ...(c.detourKm !== undefined ? { detourKm: c.detourKm, progress: c.progress } : {}),
    ...(visited ? { visited: true as const } : {}),
    ...(wishlisted ? { wishlisted: true as const } : {}),
    ...(summary(c.site) ? { summary: summary(c.site) } : {}),
  };
}
