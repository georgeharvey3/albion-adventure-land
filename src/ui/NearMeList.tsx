import { useState } from 'react';
import { useStore } from '../state/store';
import { useVisibleSites } from '../state/selectors';
import { SITE_TYPE_COLORS, SITE_TYPE_LABELS } from '../data/types';
import { formatDistance } from '../geo/haversine';
import { formatDetour, formatProgress } from '../geo/corridor';

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
// Only the nearest PAGE_SIZE rows are rendered (with "show more" paging) —
// mounting all ~2,600 rows was a large chunk of the mobile jank, and the
// near-me loop only ever needs the top of the list.

const PAGE_SIZE = 150;

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

  const routeMode = !!position && !!destination;

  return (
    <div className="list">
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
        {views.slice(0, limit).map(({ site, distance, detour, progress, visited, wishlisted }) => (
          <li
            key={site.id}
            className={`row ${site.id === selectedSiteId ? 'selected' : ''} ${
              visited ? 'is-visited' : ''
            }`}
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
            {detour !== null && progress !== null ? (
              <span className="row-dist row-route">
                <span className="row-detour">{formatDetour(detour)}</span>
                <span className="row-progress">{formatProgress(progress)}</span>
              </span>
            ) : (
              <span className="row-dist">
                {distance !== null ? formatDistance(distance) : '—'}
              </span>
            )}
          </li>
        ))}
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
