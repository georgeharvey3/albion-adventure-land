import type { Site } from '../data/types';
import { SITE_TYPE_LABELS } from '../data/types';
import { canonical, matchScore } from './normalize';
import type { SearchResult } from './types';

// Searching the app's own sites (issue #28). These cost nothing — the whole
// dataset is already in memory — so they are IDENTICAL online and off, and they
// are the reason the search box is never empty-handed without signal.
//
// Picking one sets the journey end you were filling AND opens its card, which
// is how you look a site up by name without the search box needing a mode.

interface IndexedSite {
  site: Site;
  key: string;
}

// Canonicalising 2,854 names on every keystroke would be wasteful; canonicalising
// them once per dataset is not. Keyed on the array identity, which changes only
// when the store loads a new sites.json.
let indexed: { source: Site[]; entries: IndexedSite[] } | null = null;

function index(sites: Site[]): IndexedSite[] {
  if (indexed?.source === sites) return indexed.entries;
  const entries = sites.map((site) => ({ site, key: canonical(site.name) }));
  indexed = { source: sites, entries };
  return entries;
}

/**
 * Match sites by name. `hidden` sites are excluded — the user has said they
 * don't want to see them, and a search box is no place to contradict that.
 */
export function searchSites(
  query: string,
  sites: Site[],
  hidden: Set<string>,
  limit: number,
): SearchResult[] {
  const q = canonical(query);
  if (!q) return [];

  const out: SearchResult[] = [];
  for (const { site, key } of index(sites)) {
    if (hidden.has(site.id)) continue;
    const score = matchScore(q, key);
    if (!score) continue;

    out.push({
      id: `site:${site.id}`,
      kind: 'site',
      label: site.name,
      detail: [SITE_TYPE_LABELS[site.category], site.county].filter(Boolean).join(' · '),
      lat: site.lat,
      lng: site.lng,
      source: 'local',
      siteId: site.id,
      score: score * 100,
    });
  }

  // Trim before the caller sorts: a one-letter query matches hundreds of sites
  // and none of them past the first few are worth ranking.
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
