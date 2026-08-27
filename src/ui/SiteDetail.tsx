import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { SITE_TYPE_COLORS, SITE_TYPE_LABELS, type SiteImage } from '../data/types';
import { formatDistance, haversine } from '../geo/haversine';
import { directionsToSite, placeLink } from '../links/googleMaps';
import { Lightbox } from './Lightbox';

// Selected-site card (map pin / list tap). MVP shows metadata, visited/wishlist
// toggles, and the single-site Google Maps directions handoff (spec F5, F7).
// A fuller per-site page with note + photo arrives in Phase 2 (F11).

// Attribution label for the description's source link, keyed off the URL's host
// so new scraped sources don't need a Site schema change.
function sourceLinkLabel(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host.includes('ukclimbing')) return 'UKClimbing';
    if (host.includes('camra') || host.includes('heritagepubs') || host.includes('pubheritage'))
      return 'CAMRA Heritage Pubs';
    return host.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

// Guidebook pictures for the listing, shown above the write-up. Several pictures
// become a horizontal snap strip rather than a stack, so the card stays short and
// the map stays visible (the same reason the description collapses).
//
// A picture that fails to load is removed instead of leaving a broken-image box:
// the files are shipped as static assets, so a missing one is a deployment gap,
// not something the reader should have to look at.
function SiteGallery({ images }: { images: SiteImage[] }) {
  const [broken, setBroken] = useState<Set<string>>(new Set());
  // Which picture the full-screen viewer is showing, or null when it is closed.
  const [opened, setOpened] = useState<number | null>(null);
  const shown = images.filter((img) => !broken.has(img.url));
  if (!shown.length) return null;

  return (
    <>
      <div className={shown.length > 1 ? 'card-gallery multi' : 'card-gallery'}>
        {shown.map((img, i) => (
          <figure className="card-shot" key={img.url}>
            <button
              className="shot-open"
              onClick={() => setOpened(i)}
              aria-label={img.caption ? `Enlarge: ${img.caption}` : 'Enlarge picture'}
            >
              <img
                src={`${import.meta.env.BASE_URL}${img.url}`}
                alt={img.caption ?? ''}
                width={img.width}
                height={img.height}
                loading="lazy"
                decoding="async"
                onError={() => setBroken((b) => new Set(b).add(img.url))}
              />
            </button>
            {img.caption && <figcaption>{img.caption}</figcaption>}
          </figure>
        ))}
      </div>
      {opened !== null && (
        <Lightbox images={shown} startIndex={opened} onClose={() => setOpened(null)} />
      )}
    </>
  );
}

export function SiteDetail() {
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const sites = useStore((s) => s.sites);
  const site = sites.find((x) => x.id === selectedSiteId);
  const position = useStore((s) => s.position);
  const visited = useStore((s) => (selectedSiteId ? s.visited[selectedSiteId] : undefined));
  const wishlisted = useStore((s) => (selectedSiteId ? s.wishlist.has(selectedSiteId) : false));
  const hidden = useStore((s) => (selectedSiteId ? s.hidden.has(selectedSiteId) : false));
  const setSelected = useStore((s) => s.setSelected);
  const markVisited = useStore((s) => s.markVisited);
  const unmarkVisited = useStore((s) => s.unmarkVisited);
  const toggleWishlist = useStore((s) => s.toggleWishlist);
  const toggleHidden = useStore((s) => s.toggleHidden);
  const inTrip = useStore((s) => (selectedSiteId ? !!s.outing?.stopIds.includes(selectedSiteId) : false));
  const addToTrip = useStore((s) => s.addToTrip);
  const removeFromTrip = useStore((s) => s.removeFromTrip);

  // Collapsing the write-up shrinks the card and gives the map back. Fresh
  // selection starts expanded again.
  const [descCollapsed, setDescCollapsed] = useState(false);
  useEffect(() => setDescCollapsed(false), [selectedSiteId]);

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
      {hidden && <div className="badge">🚫 Hidden</div>}
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
      {site.images && site.images.length > 0 && <SiteGallery images={site.images} />}
      {site.description && (
        <>
          <p className={descCollapsed ? 'card-desc collapsed' : 'card-desc'}>
            {site.description}
          </p>
          {site.description.length > 160 && (
            <button
              className="desc-toggle"
              onClick={() => setDescCollapsed((c) => !c)}
              aria-expanded={!descCollapsed}
            >
              {descCollapsed ? 'Show more ▾' : 'Show less ▴'}
            </button>
          )}
        </>
      )}
      {site.sourceUrl && (
        <p className="card-source">
          Description via{' '}
          <a href={site.sourceUrl} target="_blank" rel="noreferrer">
            {sourceLinkLabel(site.sourceUrl)} ↗
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
        <button className="btn" onClick={() => toggleHidden(site.id)}>
          {hidden ? '🚫 Unhide' : '🚫 Hide'}
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
