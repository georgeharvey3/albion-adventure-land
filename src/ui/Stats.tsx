import { useMemo } from 'react';
import { useStore } from '../state/store';
import { SITE_TYPE_COLORS, SITE_TYPE_LABELS } from '../data/types';
import type { Site } from '../data/types';

// The "Saved" tab: the two lists that make this a collection rather than a
// viewer — places you want to visit (wishlist) and a log of the ones you have,
// most recent first. Tap a row to open it on the map / in the detail card.

function formatVisitedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Stats() {
  const sites = useStore((s) => s.sites);
  const visited = useStore((s) => s.visited);
  const wishlist = useStore((s) => s.wishlist);
  const hidden = useStore((s) => s.hidden);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const setSelected = useStore((s) => s.setSelected);

  const byId = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);

  // Wishlist: sites still on the list to visit, alphabetical.
  const wishlistSites = useMemo(() => {
    const rows: Site[] = [];
    for (const id of wishlist) {
      const site = byId.get(id);
      if (site) rows.push(site);
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [wishlist, byId]);

  // Visited log: most recently visited first.
  const visitedRows = useMemo(() => {
    const rows = [];
    for (const log of Object.values(visited)) {
      const site = byId.get(log.siteId);
      if (site) rows.push({ site, log });
    }
    rows.sort((a, b) => b.log.visitedAt.localeCompare(a.log.visitedAt));
    return rows;
  }, [visited, byId]);

  // Hidden sites, alphabetical — listed here so they can be found and restored.
  const hiddenSites = useMemo(() => {
    const rows: Site[] = [];
    for (const id of hidden) {
      const site = byId.get(id);
      if (site) rows.push(site);
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [hidden, byId]);

  return (
    <div className="stats">
      <h3 className="stats-heading">Wishlist ({wishlistSites.length})</h3>
      {wishlistSites.length === 0 ? (
        <p className="hint">
          No saved places yet. Tap ★ on a site to add it to your wishlist.
        </p>
      ) : (
        <ul>
          {wishlistSites.map((site) => (
            <li
              key={site.id}
              className={`row ${site.id === selectedSiteId ? 'selected' : ''}`}
              onClick={() => setSelected(site.id)}
            >
              <span className="dot" style={{ background: SITE_TYPE_COLORS[site.category] }} />
              <span className="row-main">
                <span className="row-name">★ {site.name}</span>
                <span className="row-sub">
                  {SITE_TYPE_LABELS[site.category]}
                  {site.county ? ` · ${site.county}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="stats-heading">Visited ({visitedRows.length})</h3>
      {visitedRows.length === 0 ? (
        <p className="hint">
          No visits logged yet. Mark a site visited to start your log.
        </p>
      ) : (
        <ul>
          {visitedRows.map(({ site, log }) => (
            <li
              key={site.id}
              className={`row is-visited ${site.id === selectedSiteId ? 'selected' : ''}`}
              onClick={() => setSelected(site.id)}
            >
              <span className="dot" style={{ background: SITE_TYPE_COLORS[site.category] }} />
              <span className="row-main">
                <span className="row-name">✓ {site.name}</span>
                <span className="row-sub">
                  {SITE_TYPE_LABELS[site.category]}
                  {site.county ? ` · ${site.county}` : ''}
                </span>
              </span>
              <span className="row-dist">{formatVisitedDate(log.visitedAt)}</span>
            </li>
          ))}
        </ul>
      )}

      {hiddenSites.length > 0 && (
        <>
          <h3 className="stats-heading">Hidden ({hiddenSites.length})</h3>
          <ul>
            {hiddenSites.map((site) => (
              <li
                key={site.id}
                className={`row ${site.id === selectedSiteId ? 'selected' : ''}`}
                onClick={() => setSelected(site.id)}
              >
                <span className="dot" style={{ background: SITE_TYPE_COLORS[site.category] }} />
                <span className="row-main">
                  <span className="row-name">🚫 {site.name}</span>
                  <span className="row-sub">
                    {SITE_TYPE_LABELS[site.category]}
                    {site.county ? ` · ${site.county}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
