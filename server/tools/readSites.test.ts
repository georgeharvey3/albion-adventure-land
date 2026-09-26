import { describe, expect, it } from 'vitest';
import { readSites } from './readSites';
import { context } from './fixtures';

describe('read_sites', () => {
  it('returns the full description, the walk time and the tags', () => {
    const out = readSites(context(), { ids: ['port-meadow'] });
    expect(out.sites[0]).toMatchObject({
      id: 'port-meadow',
      name: 'Port Meadow',
      type: 'Wild swims',
      county: 'Oxfordshire',
      walkTime: '10 mins',
      tags: ['Long swim possible'],
      description: 'Wide shallow Thames meadow reach, good for a paddle and a long swim upstream.',
    });
  });

  it('returns every source entry of a merged place, under its layer', () => {
    const out = readSites(context(), { ids: ['old-sarum'] });
    expect(out.sites[0].entries).toEqual([
      { layer: 'Ruins', description: 'Ruined castle and cathedral.' },
      { layer: 'Folklore', description: 'Iron Age hillfort with a legend.' },
    ]);
    expect(out.sites[0]).not.toHaveProperty('description');
  });

  it('returns the opening hours with the date the source last checked them', () => {
    const out = readSites(context(), { ids: ['oxford-pub'] });
    expect(out.sites[0]).toMatchObject({
      heritageGrade: 3,
      hours: [{ day: 'saturday', opens: '12:00', closes: '23:00' }],
      lastSurveyed: '2025-05-01',
    });
  });

  it('marks the user state', () => {
    const out = readSites(context({ visited: ['port-meadow'], wishlist: ['deep-lake'] }), {
      ids: ['port-meadow', 'deep-lake'],
    });
    expect(out.sites[0]).toMatchObject({ visited: true });
    expect(out.sites[1]).toMatchObject({ wishlisted: true });
  });

  it('reports unknown, hidden, closed and merged-away ids as not found', () => {
    const out = readSites(context({ hidden: ['deep-lake'] }), {
      ids: ['no-such-site', 'deep-lake', 'closed-pub', 'sarum-dupe', 'port-meadow'],
    });
    expect(out.sites.map((s) => s.id)).toEqual(['port-meadow']);
    expect(out.notFound).toEqual(['no-such-site', 'deep-lake', 'closed-pub', 'sarum-dupe']);
  });

  it('reads at most eight sites in one call', () => {
    const ids = ['port-meadow', 'deep-lake', 'derwent-reach', 'visited-weir', 'cornish-quarry', 'oxford-pub', 'winchester-well', 'old-sarum', 'hidden-pool'];
    const out = readSites(context(), { ids });
    expect(out.sites).toHaveLength(8);
  });
});
