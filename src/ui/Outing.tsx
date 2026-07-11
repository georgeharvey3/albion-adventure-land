import { useStore } from '../state/store';
import {
  SITE_TYPES,
  SITE_TYPE_COLORS,
  SITE_TYPE_LABELS,
  PARENT_CATEGORIES,
  PARENT_CATEGORY_LABELS,
  parentOf,
  type SiteCategory,
} from '../data/types';
import { formatDistance, haversine } from '../geo/haversine';
import { multiStopRoute } from '../links/googleMaps';

// Outing mode v1 (spec §6 F12/F14/F16): pick the kinds of day you want, and
// the app finds the nearest "full house" — a group with at least one site of
// every selected type within a fixed span — orders it into a route, and hands
// the whole thing to Google Maps. The type picker here is a QUERY, independent
// of the map filter.

export function Outing() {
  const sites = useStore((s) => s.sites);
  const position = useStore((s) => s.position);
  const outingTypes = useStore((s) => s.outingTypes);
  const includeVisited = useStore((s) => s.outingIncludeVisited);
  const outing = useStore((s) => s.outing);
  const failure = useStore((s) => s.outingFailure);
  const toggleOutingType = useStore((s) => s.toggleOutingType);
  const setIncludeVisited = useStore((s) => s.setOutingIncludeVisited);
  const findOuting = useStore((s) => s.findOuting);
  const clearOuting = useStore((s) => s.clearOuting);
  const setSelected = useStore((s) => s.setSelected);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const visited = useStore((s) => s.visited);

  // Types present in the dataset, grouped by parent (same shape as Filters).
  const counts = new Map<SiteCategory, number>();
  for (const s of sites) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  const groups = PARENT_CATEGORIES.map((parent) => ({
    parent,
    leaves: SITE_TYPES.filter((t) => counts.has(t) && parentOf(t) === parent),
  })).filter((g) => g.leaves.length > 0);

  const byId = new Map(sites.map((s) => [s.id, s]));
  const stops = outing ? outing.stopIds.map((id) => byId.get(id)).filter((s) => !!s) : [];

  const canFind = !!position && outingTypes.size > 0;
  // One stop per selected type, so a big selection can exceed Google Maps'
  // ~9-waypoint URL cap (multiStopRoute throws above it) — hide the export
  // rather than crash; the per-stop directions still work from the site card.
  const mapsUrl =
    position && stops.length > 0 && stops.length <= 10
      ? multiStopRoute([{ lat: position.lat, lng: position.lng }, ...stops])
      : null;

  return (
    <div className="outing">
      <p className="hint">
        Pick the kinds of day you want — the nearest cluster with one of each,
        as a ready-made route.
      </p>

      {groups.map(({ parent, leaves }) => (
        <div className="outing-group" key={parent}>
          <span className="outing-group-label">{PARENT_CATEGORY_LABELS[parent]}</span>
          {leaves.map((type) => {
            const on = outingTypes.has(type);
            return (
              <button
                key={type}
                className={`chip ${on ? 'on' : 'off'}`}
                onClick={() => toggleOutingType(type)}
                aria-pressed={on}
              >
                <span className="dot" style={{ background: SITE_TYPE_COLORS[type] }} />
                {SITE_TYPE_LABELS[type]}
              </button>
            );
          })}
        </div>
      ))}

      <label className="outing-toggle">
        <input
          type="checkbox"
          checked={includeVisited}
          onChange={(e) => setIncludeVisited(e.target.checked)}
        />
        Include sites I've already visited
      </label>

      <div className="outing-actions">
        <button className="btn primary" onClick={() => findOuting()} disabled={!canFind}>
          Find outing
        </button>
        {outing && (
          <>
            <button className="btn" onClick={() => findOuting(true)}>
              Find another
            </button>
            <button className="btn" onClick={clearOuting}>
              Clear
            </button>
          </>
        )}
      </div>

      {!position && (
        <p className="hint">
          No location yet — allow GPS or use the 📍 button on the map to drop an
          "I am here" pin.
        </p>
      )}
      {position && outingTypes.size === 0 && (
        <p className="hint">Select at least one type above.</p>
      )}

      {failure?.kind === 'no-more' && (
        <p className="outing-failure">No other qualifying cluster — this is the lot.</p>
      )}
      {failure?.kind === 'missing-types' && (
        <div className="outing-failure">
          <p>Some of the selected types have nothing to visit:</p>
          <ul>
            {failure.nearest
              .filter(({ site }) => !site)
              .map(({ type }) => (
                <li key={type}>
                  <span className="dot" style={{ background: SITE_TYPE_COLORS[type] }} />
                  {SITE_TYPE_LABELS[type]}:{' '}
                  {includeVisited ? 'none in the collection' : 'none left unvisited'}
                </li>
              ))}
          </ul>
          <p className="hint">Try dropping the type, or include visited sites.</p>
        </div>
      )}

      {outing && position && (
        <div className="outing-result">
          <p className="hint">
            {stops.length} stops, starting {formatDistance(outing.distanceFromAnchor)} from{' '}
            {position.manual ? 'your dropped pin' : 'you'}
            {stops.length > 1 && `, spread over ${formatDistance(outing.radiusM)}`}.
          </p>
          <ol className="outing-stops">
            {stops.map((site, i) => {
              const prev = i === 0 ? position : stops[i - 1];
              return (
                <li
                  key={site.id}
                  className={`row ${site.id === selectedSiteId ? 'selected' : ''}`}
                  onClick={() => setSelected(site.id)}
                >
                  <span className="stop-num">{i + 1}</span>
                  <span className="dot" style={{ background: SITE_TYPE_COLORS[site.category] }} />
                  <span className="row-main">
                    <span className="row-name">
                      {site.id in visited && '✓ '}
                      {site.name}
                    </span>
                    <span className="row-sub">{SITE_TYPE_LABELS[site.category]}</span>
                  </span>
                  <span className="row-dist">+{formatDistance(haversine(prev, site))}</span>
                </li>
              );
            })}
          </ol>
          {mapsUrl ? (
            <a className="btn primary outing-export" href={mapsUrl} target="_blank" rel="noreferrer">
              Open route in Google Maps ↗
            </a>
          ) : (
            <p className="hint">
              Too many stops for one Google Maps link — open directions from
              each site's card instead.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
