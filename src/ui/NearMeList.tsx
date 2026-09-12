import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useVisibleSites } from '../state/selectors';
import { SITE_TYPE_COLORS, SITE_TYPE_LABELS, type Site } from '../data/types';
import { formatDistance } from '../geo/haversine';
import { formatDetour, formatProgress } from '../geo/corridor';
import { SiteBody } from './SiteDetail';
import { CheckIcon, ListIcon, MapIcon, MapPinIcon, StarIcon } from './icons';

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
// "what's out there?" — where the map's 55% of the screen buys nothing. An
// opened site is stepped through with the prev/next bar closing it, or the
// arrow keys, so reading ten in a row costs ten taps rather than twenty.
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
  // Set when the reader is *moved* to a site rather than choosing it — see the
  // scroll effect below.
  const pendingScroll = useRef(false);

  /** Step to the site before or after the open one, in whatever order the list
   *  is currently in (distance, or travel order on a corridor). Stops at both
   *  ends rather than wrapping: the list is sorted, so wrapping from the
   *  furthest site back to the nearest would be a jump across Britain. */
  const goToNeighbour = useCallback(
    (delta: number) => {
      const index = views.findIndex((v) => v.site.id === selectedSiteId);
      if (index < 0) return;
      const next = index + delta;
      if (next < 0 || next >= views.length) return;
      pendingScroll.current = true;
      setSelected(views[next].site.id);
    },
    [views, selectedSiteId, setSelected],
  );

  // Bring the reader to the selected site when they were moved to it — entering
  // browse mode on a site picked from the map, or stepping to a neighbour —
  // but not when they tapped a row themselves, where the row should stay put
  // under their finger and grow downwards.
  //
  // The site can sit past the paging limit (a distant pin, or a long walk down
  // the list), so the limit is raised first and the effect runs again once the
  // row actually exists.
  useEffect(() => {
    if (!browse || !selectedSiteId || !pendingScroll.current) return;
    const index = views.findIndex((v) => v.site.id === selectedSiteId);
    if (index < 0) {
      pendingScroll.current = false; // filtered out — nothing to scroll to
      return;
    }
    if (index >= limit) {
      setLimit(Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE);
      return;
    }
    expandedRef.current?.scrollIntoView({ block: 'start' });
    pendingScroll.current = false;
  }, [browse, selectedSiteId, limit, views]);

  // Arrow keys do from the keyboard what the prev/next bar does with a tap.
  // Skipped while a modal is up: the picture viewer binds the same two keys,
  // and there the arrows belong to the pictures.
  useEffect(() => {
    if (!browse || !selectedSiteId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      goToNeighbour(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [browse, selectedSiteId, goToNeighbour]);

  return (
    <div className={browse ? 'list browse' : 'list'}>
      <div className="list-head">
        {!position && (
          <p className="hint">
            {geoError ?? 'Finding your location… '}
            {' '}Use the <MapPinIcon /> button on the map to drop a manual location.
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
          onClick={() => {
            if (!browse) pendingScroll.current = true;
            setBrowse(!browse);
          }}
          aria-pressed={browse}
        >
          {browse ? <MapIcon /> : <ListIcon />} {browse ? 'Map' : 'Browse'}
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
        {views.slice(0, limit).map((view, i) => {
          const { site, distance, detour, progress, visited, wishlisted } = view;
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
                    {visited && <CheckIcon />}
                    {wishlisted && !visited && <StarIcon filled />}
                    {(visited || wishlisted) && ' '}
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

          // Neighbours come from the full list, not the rendered page, so the
          // last row on screen still steps forward (raising the limit as it
          // goes) instead of dead-ending at an arbitrary multiple of 150.
          const prev = expanded ? views[i - 1] : undefined;
          const next = expanded ? views[i + 1] : undefined;

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
                    {visited && <CheckIcon />}
                    {wishlisted && !visited && <StarIcon filled />}
                    {(visited || wishlisted) && ' '}
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
                    collapseDescription={false}
                    onShowOnMap={() => setBrowse(false)}
                  />
                  {/* Naming the neighbours turns the step into a decision
                      rather than a leap in the dark. */}
                  <div className="row-nav">
                    <button
                      className="row-nav-btn"
                      onClick={() => goToNeighbour(-1)}
                      disabled={!prev}
                      aria-label={prev ? `Previous site: ${prev.site.name}` : 'No previous site'}
                    >
                      <span className="row-nav-dir">‹ Previous</span>
                      {prev && <span className="row-nav-name">{prev.site.name}</span>}
                    </button>
                    <button
                      className="row-nav-btn next"
                      onClick={() => goToNeighbour(1)}
                      disabled={!next}
                      aria-label={next ? `Next site: ${next.site.name}` : 'No next site'}
                    >
                      <span className="row-nav-dir">Next ›</span>
                      {next && <span className="row-nav-name">{next.site.name}</span>}
                    </button>
                  </div>
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
