import { useState } from 'react';
import { useStore } from '../state/store';
import { useVisibleSites } from '../state/selectors';
import { SITE_TYPE_COLORS, SITE_TYPE_LABELS } from '../data/types';
import { formatDistance } from '../geo/haversine';

// Near me now (spec F4): every visible site sorted by haversine distance from
// the current position, respecting the active type filter. Tap a row to open it
// on the map / in the detail card.
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
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const setSelected = useStore((s) => s.setSelected);

  return (
    <div className="list">
      {!position && (
        <p className="hint">
          {geoError ?? 'Finding your location… '}
          {' '}Use the 📍 button on the map to drop a manual location.
        </p>
      )}
      {position && (
        <p className="hint">
          {views.length} sites{' '}
          {position.manual ? 'from your dropped pin' : 'near you'}, nearest first.
        </p>
      )}
      <ul>
        {views.slice(0, limit).map(({ site, distance, visited, wishlisted }) => (
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
            <span className="row-dist">{distance !== null ? formatDistance(distance) : '—'}</span>
          </li>
        ))}
      </ul>
      {views.length > limit && (
        <p className="hint">
          <button className="link" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, views.length - limit)} more
          </button>{' '}
          ({views.length - limit} further away)
        </p>
      )}
    </div>
  );
}
