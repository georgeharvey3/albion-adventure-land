import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useVisibleSites } from '../state/selectors';
import { SITE_TYPE_COLORS, SITE_TYPE_LABELS, type Site } from '../data/types';
import { formatDistance } from '../geo/haversine';
import { formatDetour, formatProgress } from '../geo/corridor';
import { SiteBody } from './SiteDetail';

// Near me now (spec F4): every visible site sorted by haversine distance from
// the current position, respecting the active type filter. Tap a row to open it
// on the map / in the detail card.
//
// With a destination set (issue #14) this same list becomes the "along the way"
// list: the corridor filter has already dropped anything outside the detour
// budget, the rows arrive in travel order, and the trailing figure switches
// from raw distance to the two numbers that matter on a drive — what the stop
// costs you and how far into the journey it falls.
//
// Browse mode is the same list without the map: the sheet takes the whole
// screen, rows gain a thumbnail and a teaser, and tapping one opens the full
// write-up *in place* rather than throwing the reader to a card floating over a
// map they can no longer see. It is for the armchair half of the loop —
// "what's out there?" — where the map's 55% of the screen buys nothing.
//
// Only the nearest PAGE_SIZE rows are rendered (with "show more" paging) —
// mounting all ~2,600 rows was a large chunk of the mobile jank, and the
// near-me loop only ever needs the top of the list.

const PAGE_SIZE = 150;

// Row thumbnail: the listing's first guidebook plate, or a flat tile in the
// category colour when there is no picture (only ~14% of sites have one, and a
// ragged left edge down a reading list is worse than a plain swatch). A picture
// that fails to load falls back to the same tile rather than a broken-image box.
function RowThumb({ site }: { site: Site }) {
  const [broken, setBroken] = useState(false);
  const image = site.images?.[0];
  const tint = SITE_TYPE_COLORS[site.category];

  if (!image || broken) {
    return <span className="row-thumb blank" style={{ background: tint }} aria-hidden="true" />;
  }
  return (
    <img
      className="row-thumb"
      src={`${import.meta.env.BASE_URL}${image.url}`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}

export function NearMeList() {
  const views = useVisibleSites();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const position = useStore((s) => s.position);
  const geoError = useStore((s) => s.geoError);
  const destination = useStore((s) => s.destination);
  const routeSort = useStore((s) => s.routeSort);
  const setRouteSort = useStore((s) => s.setRouteSort);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const setSelected = useStore((s) => s.setSelected);
  const browse = useStore((s) => s.browse);
  const setBrowse = useStore((s) => s.setBrowse);

  const routeMode = !!position && !!destination;
  const expandedRef = useRef<HTMLLIElement | null>(null);

  // Entering browse mode from a site selected on the map should land the reader
  // on that site, not at the top of a list of 2,600. Two things are needed: the
  // row has to be rendered at all (it can sit past the paging limit), and it
  // has to be scrolled to once it is.
  useEffect(() => {
    if (!browse || !selectedSiteId) return;
    const index = views.findIndex((v) => v.site.id === selectedSiteId);
    if (index < 0) return; // filtered out — nothing to scroll to
    if (index >= limit) {
      setLimit(Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE);
      return; // the row mounts on the next pass; this effect runs again
    }
    expandedRef.current?.scrollIntoView({ block: 'start' });
    // Deliberately only on entering browse mode: re-running on every selection
    // change would yank the list while the reader is scrolling it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browse, limit]);

  return (
    <div className={browse ? 'list browse' : 'list'}>
      <div className="list-head">
        {!position && (
          <p className="hint">
            {geoError ?? 'Finding your location… '}
            {' '}Use the 📍 button on the map to drop a manual location.
          </p>
        )}
        {position && !destination && (
          <p className="hint">
            {views.length} sites{' '}
            {position.manual ? 'from your dropped pin' : 'near you'}, nearest first.
          </p>
        )}
        {/* The one way in and out of browse mode. It lives with the list rather
            than in the tab bar because it is a way of reading *this* list, not
            an app-wide mode. */}
        <button
          className={browse ? 'browse-toggle on' : 'browse-toggle'}
          onClick={() => setBrowse(!browse)}
          aria-pressed={browse}
        >
          {browse ? '🗺 Map' : '☰ Browse'}
        </button>
      </div>
      {routeMode && (
        <div className="route-head">
          <p className="hint">
            {views.length} {views.length === 1 ? 'site' : 'sites'} on the way to{' '}
            {destination.label}.
          </p>
          {/* Travel order answers "what's next?"; least detour answers "what's
              cheapest?". Both are useful on the same corridor, so the sort is a
              toggle rather than a decision made for the user. */}
          <div className="mode-toggle route-sort">
            <button
              className={routeSort === 'progress' ? 'mode-opt on' : 'mode-opt'}
              onClick={() => setRouteSort('progress')}
            >
              Travel order
            </button>
            <button
              className={routeSort === 'detour' ? 'mode-opt on' : 'mode-opt'}
              onClick={() => setRouteSort('detour')}
            >
              Least detour
            </button>
          </div>
        </div>
      )}
      {routeMode && views.length === 0 && (
        <p className="hint">
          Nothing within this detour budget. Widen it in the bar above, or turn
          more layers on in Filters.
        </p>
      )}
      <ul>
        {views.slice(0, limit).map(({ site, distance, detour, progress, visited, wishlisted }) => {
          const selected = site.id === selectedSiteId;
          const expanded = browse && selected;
          const trailing =
            detour !== null && progress !== null ? (
              <span className="row-dist row-route">
                <span className="row-detour">{formatDetour(detour)}</span>
                <span className="row-progress">{formatProgress(progress)}</span>
              </span>
            ) : (
              <span className="row-dist">
                {distance !== null ? formatDistance(distance) : '—'}
              </span>
            );

          // Map mode: the row is the whole control and selection opens the
          // floating card, exactly as it always has.
          if (!browse) {
            return (
              <li
                key={site.id}
                className={`row ${selected ? 'selected' : ''} ${visited ? 'is-visited' : ''}`}
                onClick={() => setSelected(site.id)}
              >
                <span className="dot" style={{ background: SITE_TYPE_COLORS[site.category] }} />
                <span className="row-main">
                  <span className="row-name">
                    {visited && '✓ '}
                    {wishlisted && !visited && '★ '}
                    {site.name}
                  </span>
                  <span className="row-sub">
                    {SITE_TYPE_LABELS[site.category]}
                    {site.county ? ` · ${site.county}` : ''}
                  </span>
                </span>
                {trailing}
              </li>
            );
          }

          // Browse mode: a real disclosure button, so the write-up opens under
          // the row and the reader keeps their place in the list.
          return (
            <li
              key={site.id}
              ref={expanded ? expandedRef : undefined}
              className={`row browse ${expanded ? 'expanded' : ''} ${
                visited ? 'is-visited' : ''
              }`}
            >
              <button
                className="row-head"
                onClick={() => setSelected(expanded ? null : site.id)}
                aria-expanded={expanded}
              >
                <RowThumb site={site} />
                <span className="row-main">
                  <span className="row-name">
                    {visited && '✓ '}
                    {wishlisted && !visited && '★ '}
                    {site.name}
                  </span>
                  <span className="row-sub">
                    {SITE_TYPE_LABELS[site.category]}
                    {site.county ? ` · ${site.county}` : ''}
                  </span>
                  {!expanded && site.description && (
                    <span className="row-teaser">{site.description}</span>
                  )}
                </span>
                {trailing}
              </button>
              {expanded && (
                <div className="row-body">
                  {/* The row header above is already the site's header — name,
                      type and distance — so the body starts at the write-up. */}
                  <SiteBody
                    site={site}
                    showHeader={false}
                    onShowOnMap={() => setBrowse(false)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {views.length > limit && (
        <p className="hint">
          <button className="link" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, views.length - limit)} more
          </button>{' '}
          ({views.length - limit} {routeMode ? 'further along' : 'further away'})
        </p>
      )}
    </div>
  );
}
