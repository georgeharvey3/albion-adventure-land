import { describe, expect, it } from 'vitest';
import { findSites, type FindSitesResult } from './findSites';
import { context, fakeNet, ROUTE, SHEFFIELD, SITES, WINCHESTER } from './fixtures';
import type { SemanticIndex } from '../semantic';

const JOURNEY = { origin: { ...SHEFFIELD, label: 'Sheffield' }, destination: { ...WINCHESTER, label: 'Winchester' } };

function ids(out: FindSitesResult): string[] {
  if (!('sites' in out)) throw new Error(out.error);
  return out.sites.map((s) => s.id);
}

// Stands in for the embedding model: a site scores by how many of the
// question's words its description holds.
const keywordIndex: SemanticIndex = {
  async score(query, candidates) {
    const words = query.toLowerCase().split(/\W+/).filter(Boolean);
    const out = new Map<string, number>();
    for (const id of candidates) {
      const text = (SITES.find((s) => s.id === id)?.description ?? '').toLowerCase();
      out.set(id, words.filter((w) => text.includes(w)).length / words.length);
    }
    return out;
  },
};

describe('find_sites near a point', () => {
  it('returns sites of the asked type, nearest first, with the distance', async () => {
    const out = await findSites(context(), { near: { lat: 51.77, lng: -1.28 }, types: ['wild_swims'], radiusKm: 45 });
    expect(ids(out)).toEqual(['port-meadow', 'deep-lake']);
    if (!('sites' in out)) return;
    expect(out.sites[0].distanceKm).toBeLessThan(1);
    expect(out.context).toMatchObject({ kind: 'near' });
  });

  it('uses the live position for near "position"', async () => {
    const out = await findSites(context({ position: { lat: 51.41, lng: -1.3 } }), {
      near: 'position',
      types: ['wild_swims'],
      radiusKm: 10,
    });
    expect(ids(out)).toEqual(['deep-lake']);
  });

  it('reports an error when near is "position" and the device sent none', async () => {
    const out = await findSites(context(), { near: 'position' });
    expect(out).toHaveProperty('error');
  });

  it('resolves a place name given as near', async () => {
    const out = await findSites(context(), { near: 'Oxford', types: ['wild_swims'], radiusKm: 45 });
    expect(ids(out)).toEqual(['port-meadow', 'deep-lake']);
    if ('sites' in out) expect(out.context).toMatchObject({ kind: 'near', point: { label: 'Oxford' } });
  });

  it('reports an error for a place name it cannot resolve', async () => {
    const out = await findSites(context(), { near: 'Nowhereville' });
    expect(out).toHaveProperty('error');
  });

  it('uses the selected site for near "selection"', async () => {
    const out = await findSites(context({ selection: 'old-sarum' }), { near: 'selection', types: ['wells'], radiusKm: 45 });
    expect(ids(out)).toEqual(['winchester-well']);
  });

  it('matches a parent category, and a merged place under each of its layers', async () => {
    const folklore = await findSites(context(), { near: WINCHESTER, types: ['folklore'], radiusKm: 60 });
    expect(ids(folklore)).toEqual(['winchester-well', 'old-sarum']);
    const ruins = await findSites(context(), { near: WINCHESTER, types: ['ruins'], radiusKm: 60 });
    expect(ids(ruins)).toEqual(['old-sarum']);
  });

  it('matches tags without regard to case', async () => {
    const out = await findSites(context(), { near: WINCHESTER, tags: ['jump or rope swing'], radiusKm: 400 });
    expect(ids(out)).toEqual(['deep-lake']);
  });

  it('never returns a closed site or a merged-away duplicate', async () => {
    const out = await findSites(context(), { near: { lat: 51.76, lng: -1.27 }, radiusKm: 100, limit: 20 });
    expect(ids(out)).not.toContain('closed-pub');
    expect(ids(out)).not.toContain('sarum-dupe');
  });
});

describe('find_sites and user state', () => {
  it('never returns a hidden site', async () => {
    const out = await findSites(context({ hidden: ['port-meadow'] }), { near: { lat: 51.77, lng: -1.28 }, types: ['wild_swims'], radiusKm: 45 });
    expect(ids(out)).toEqual(['deep-lake']);
  });

  it('puts visited sites after unvisited ones and marks them', async () => {
    const out = await findSites(context({ visited: ['port-meadow'] }), {
      near: { lat: 51.77, lng: -1.28 },
      types: ['wild_swims'],
      radiusKm: 45,
    });
    expect(ids(out)).toEqual(['deep-lake', 'port-meadow']);
    if ('sites' in out) expect(out.sites[1].visited).toBe(true);
  });

  it('says so when visited sites matched but did not fit the limit', async () => {
    const out = await findSites(context({ visited: ['port-meadow'] }), {
      near: { lat: 51.77, lng: -1.28 },
      types: ['wild_swims'],
      radiusKm: 45,
      limit: 1,
    });
    expect(ids(out)).toEqual(['deep-lake']);
    if ('sites' in out) expect(out.note).toMatch(/1 visited site/);
  });

  it('keeps visited sites in their place when includeVisited is set', async () => {
    const out = await findSites(context({ visited: ['port-meadow'] }), {
      near: { lat: 51.77, lng: -1.28 },
      types: ['wild_swims'],
      radiusKm: 45,
      includeVisited: true,
    });
    expect(ids(out)).toEqual(['port-meadow', 'deep-lake']);
  });

  it('marks wishlisted sites', async () => {
    const out = await findSites(context({ wishlist: ['deep-lake'] }), { near: { lat: 51.41, lng: -1.3 }, radiusKm: 5 });
    if (!('sites' in out)) throw new Error('no sites');
    expect(out.sites[0]).toMatchObject({ id: 'deep-lake', wishlisted: true });
  });
});

describe('find_sites on a journey', () => {
  it('measures detours against the road route when OSRM answers', async () => {
    const net = fakeNet({ route: ROUTE });
    const out = await findSites(context({}, { net }), { journey: JOURNEY, types: ['wild_swims'], detourKm: 10 });
    expect(ids(out).sort()).toEqual(['deep-lake', 'derwent-reach', 'hidden-pool', 'port-meadow', 'visited-weir']);
    if (!('sites' in out)) return;
    expect(out.context).toMatchObject({ kind: 'journey', route: 'road' });
    expect(out.sites.every((s) => s.detourKm !== undefined && s.progress !== undefined)).toBe(true);
  });

  it('lists the journey in travel order when no meaning is given', async () => {
    const net = fakeNet({ route: ROUTE });
    const out = await findSites(context({}, { net }), { journey: JOURNEY, types: ['wild_swims'], detourKm: 10 });
    expect(ids(out)).toEqual(['derwent-reach', 'hidden-pool', 'visited-weir', 'port-meadow', 'deep-lake']);
  });

  it('picks the journey shortlist by least detour, not by the first sites on the road', async () => {
    const net = fakeNet({ route: ROUTE });
    const out = await findSites(context({}, { net }), { journey: JOURNEY, types: ['wild_swims'], limit: 1 });
    expect(ids(out)).toEqual(['port-meadow']);
  });

  it('falls back to the detour ellipse when OSRM has no answer', async () => {
    const out = await findSites(context(), { journey: JOURNEY, types: ['wild_swims'], detourKm: 20 });
    expect(ids(out)).not.toContain('cornish-quarry');
    expect(ids(out)).toContain('port-meadow');
    if ('sites' in out) expect(out.context).toMatchObject({ kind: 'journey', route: 'direct' });
  });

  it('resolves the place names of the journey ends', async () => {
    const net = fakeNet({ route: ROUTE });
    const out = await findSites(context({}, { net }), { journey: { origin: 'Sheffield', destination: 'Winchester' }, types: ['wild_swims'] });
    expect(ids(out)).toContain('deep-lake');
    if ('sites' in out) {
      expect(out.context).toMatchObject({ kind: 'journey', origin: { label: 'Sheffield' }, destination: { label: 'Winchester' } });
    }
  });

  it('starts a journey at the live position for origin "position"', async () => {
    const out = await findSites(context({ position: SHEFFIELD }), { journey: { origin: 'position', destination: 'Winchester' }, types: ['wild_swims'], detourKm: 20 });
    expect(ids(out)).toContain('port-meadow');
  });

  it('uses the journey set in the app for journey "current"', async () => {
    const net = fakeNet({ route: ROUTE });
    const out = await findSites(context({ journey: JOURNEY }, { net }), { journey: 'current', types: ['wild_swims'] });
    expect(ids(out)).toContain('deep-lake');
  });

  it('reports an error for journey "current" when the app has no journey', async () => {
    const out = await findSites(context(), { journey: 'current' });
    expect(out).toHaveProperty('error');
  });
});

describe('find_sites by county', () => {
  it('returns the sites in a county', async () => {
    const out = await findSites(context(), { county: 'oxfordshire', types: ['wild_swims'] });
    expect(ids(out).sort()).toEqual(['port-meadow', 'visited-weir']);
  });
});

describe('find_sites by meaning', () => {
  it('ranks the shortlist by meaning, and only the shortlist', async () => {
    const net = fakeNet({ route: ROUTE });
    const out = await findSites(context({}, { net, semantic: keywordIndex }), {
      journey: JOURNEY,
      types: ['wild_swims'],
      meaning: 'deep clear',
    });
    expect(ids(out)[0]).toBe('deep-lake');
    expect(ids(out)).not.toContain('cornish-quarry');
  });

  it('keeps its distance order when no index is loaded', async () => {
    const out = await findSites(context(), { near: { lat: 51.77, lng: -1.28 }, types: ['wild_swims'], radiusKm: 45, meaning: 'deep' });
    expect(ids(out)).toEqual(['port-meadow', 'deep-lake']);
  });
});

describe('find_sites limits', () => {
  it('returns at most `limit` sites and reports how many matched', async () => {
    const out = await findSites(context(), { near: WINCHESTER, radiusKm: 1000, limit: 2 });
    if (!('sites' in out)) throw new Error('no sites');
    expect(out.sites).toHaveLength(2);
    expect(out.total).toBe(9);
  });

  it('needs a place: near, journey or county', async () => {
    const out = await findSites(context(), { types: ['wild_swims'] });
    expect(out).toHaveProperty('error');
  });

  it('rejects a type it does not know, and names the ones it does', async () => {
    const out = await findSites(context(), { near: WINCHESTER, types: ['castles'] });
    expect(out).toHaveProperty('error');
    if ('error' in out) expect(out.error).toContain('ruins');
  });
});
