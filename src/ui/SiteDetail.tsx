import { useStore } from '../state/store';
import { SITE_TYPE_COLORS, SITE_TYPE_LABELS } from '../data/types';
import { formatDistance, haversine } from '../geo/haversine';
import { directionsToSite, placeLink } from '../links/googleMaps';

// Selected-site card (map pin / list tap). MVP shows metadata, visited/wishlist
// toggles, and the single-site Google Maps directions handoff (spec F5, F7).
// A fuller per-site page with note + photo arrives in Phase 2 (F11).

export function SiteDetail() {
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const sites = useStore((s) => s.sites);
  const site = sites.find((x) => x.id === selectedSiteId);
  const position = useStore((s) => s.position);
  const visited = useStore((s) => (selectedSiteId ? s.visited[selectedSiteId] : undefined));
  const wishlisted = useStore((s) => (selectedSiteId ? s.wishlist.has(selectedSiteId) : false));
  const setSelected = useStore((s) => s.setSelected);
  const markVisited = useStore((s) => s.markVisited);
  const unmarkVisited = useStore((s) => s.unmarkVisited);
  const toggleWishlist = useStore((s) => s.toggleWishlist);
  const inTrip = useStore((s) => (selectedSiteId ? !!s.outing?.stopIds.includes(selectedSiteId) : false));
  const addToTrip = useStore((s) => s.addToTrip);
  const removeFromTrip = useStore((s) => s.removeFromTrip);

  if (!site) return null;

  const distance = position ? haversine(position, site) : null;

  // Listing links (derived data). A sub-feature points back to its listing's main
  // write-up; a main point lists the features grouped under it.
  const parent = site.parentId ? sites.find((x) => x.id === site.parentId) : undefined;
  const children = site.parentId ? [] : sites.filter((x) => x.parentId === site.id);

  return (
    <div className="card" role="dialog" aria-label={site.name}>
      <button className="card-close" onClick={() => setSelected(null)} aria-label="Close">
        ×
      </button>
      <div className="card-type">
        <span className="dot" style={{ background: SITE_TYPE_COLORS[site.category] }} />
        {SITE_TYPE_LABELS[site.category]}
        {distance !== null ? ` · ${formatDistance(distance)} away` : ''}
      </div>
      <h2 className="card-title">{site.name}</h2>
      {visited && <div className="badge visited">✓ Visited {visited.visitedAt.slice(0, 10)}</div>}
      {wishlisted && !visited && <div className="badge wish">★ Wishlist</div>}
      {parent && (
        <p className="card-listing">
          Part of{' '}
          <button className="link" onClick={() => setSelected(parent.id)}>
            {parent.listingTitle ?? parent.name}
          </button>
        </p>
      )}
      {site.walkTime && <p className="card-meta">🚶 Walk in: {site.walkTime}</p>}
      {site.access && <p className="card-meta">Access: {site.access}</p>}
      {site.description && <p className="card-desc">{site.description}</p>}
      {site.sourceUrl && (
        <p className="card-source">
          Description via{' '}
          <a href={site.sourceUrl} target="_blank" rel="noreferrer">
            CAMRA Heritage Pubs ↗
          </a>
        </p>
      )}

      {children.length > 0 && (
        <div className="card-listing">
          <span className="card-listing-label">Nearby in this listing</span>
          <ul className="listing-children">
            {children.map((c) => (
              <li key={c.id}>
                <button className="link" onClick={() => setSelected(c.id)}>
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card-actions">
        <a
          className="btn primary"
          href={directionsToSite(site, position?.manual ? position : undefined)}
          target="_blank"
          rel="noreferrer"
        >
          Directions ↗
        </a>
        {site.postcode && (
          <a
            className="btn"
            href={placeLink({ ...site, postcode: site.postcode })}
            target="_blank"
            rel="noreferrer"
          >
            View on Google Maps ↗
          </a>
        )}
        {visited ? (
          <button className="btn" onClick={() => unmarkVisited(site.id)}>
            Unmark visited
          </button>
        ) : (
          <button className="btn" onClick={() => markVisited(site.id)}>
            Mark visited
          </button>
        )}
        <button className="btn" onClick={() => toggleWishlist(site.id)}>
          {wishlisted ? '★ On wishlist' : '☆ Wishlist'}
        </button>
        {/* Trip = today's ordered subset. Adding needs a position to order the
            route from (spec: require a position); without one the button is
            disabled rather than silently doing nothing. The button state itself
            is the "added" confirmation — the Outing tab carries the count. */}
        {inTrip ? (
          <button className="btn trip on" onClick={() => removeFromTrip(site.id)}>
            ✓ In trip
          </button>
        ) : (
          <button
            className="btn trip"
            onClick={() => addToTrip(site.id)}
            disabled={!position}
            title={position ? undefined : 'Drop a location on the map to start a trip'}
          >
            + Add to trip
          </button>
        )}
      </div>
    </div>
  );
}
