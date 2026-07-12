import { useStore } from '../state/store';
import {
  SITE_TYPES,
  SITE_TYPE_COLORS,
  SITE_TYPE_LABELS,
  PARENT_CATEGORIES,
  PARENT_CATEGORY_LABELS,
  parentOf,
  outingSlotColor,
  outingSlotLabel,
  type SiteCategory,
} from '../data/types';
import { formatDistance, haversine } from '../geo/haversine';
import { multiStopRoute } from '../links/googleMaps';

// Outing tab. One shared, ephemeral route is populated two ways:
//   • hand-picking — "Add to trip" on a site card builds an ordered subset of
//     the day (no type constraint), shown here as the primary content.
//   • the cluster algorithm — the collapsible "Find one for me" finder picks
//     the nearest full-house of the selected types (spec §6 F12/F14/F16). Its
//     type picker is a QUERY, independent of the map filter.
// Either way the output is the same: an NN+2-opt route + Google Maps handoff.

export function Outing() {
  const sites = useStore((s) => s.sites);
  const position = useStore((s) => s.position);
  const outingTypes = useStore((s) => s.outingTypes);
  const outingAnyParents = useStore((s) => s.outingAnyParents);
  const includeVisited = useStore((s) => s.outingIncludeVisited);
  const outing = useStore((s) => s.outing);
  const failure = useStore((s) => s.outingFailure);
  const toggleOutingType = useStore((s) => s.toggleOutingType);
  const setOutingTypesActive = useStore((s) => s.setOutingTypesActive);
  const setOutingParentAny = useStore((s) => s.setOutingParentAny);
  const setIncludeVisited = useStore((s) => s.setOutingIncludeVisited);
  const findOuting = useStore((s) => s.findOuting);
  const clearOuting = useStore((s) => s.clearOuting);
  const removeFromTrip = useStore((s) => s.removeFromTrip);
  const setSelected = useStore((s) => s.setSelected);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const visited = useStore((s) => s.visited);

  // Types present in the dataset, grouped by parent (same shape as Filters).
  const counts = new Map<SiteCategory, number>();
  for (const s of sites) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  const layers = PARENT_CATEGORIES.map((parent) => ({
    parent,
    leaves: SITE_TYPES.filter((t) => counts.has(t) && parentOf(t) === parent),
  })).filter((g) => g.leaves.length > 0);

  const byId = new Map(sites.map((s) => [s.id, s]));
  const stops = outing ? outing.stopIds.map((id) => byId.get(id)).filter((s) => !!s) : [];

  // A parent in "Any of these" mode contributes a stop even with no leaf ticked
  // (it means "any of the whole category"), so participation is either.
  const canFind = !!position && (outingTypes.size > 0 || outingAnyParents.size > 0);
  // One stop per selected type, so a big selection can exceed Google Maps'
  // ~9-waypoint URL cap (multiStopRoute throws above it) — hide the export
  // rather than crash; the per-stop directions still work from the site card.
  const mapsUrl =
    position && stops.length > 0 && stops.length <= 10
      ? multiStopRoute([{ lat: position.lat, lng: position.lng }, ...stops])
      : null;

  // A fresh Find overwrites the shared route. Confirm first if the current one
  // was hand-picked, so the finder can't silently nuke a trip (spec decision).
  const handleFind = () => {
    if (outing?.edited && !window.confirm('Replace your hand-picked trip with a found outing?')) {
      return;
    }
    findOuting();
  };

  return (
    <div className="outing">
      {outing ? (
        <div className="outing-result">
          <div className="outing-result-head">
            <p className="hint">
              {position
                ? `${stops.length} stops, starting ${formatDistance(outing.distanceFromAnchor)} from ${position.manual ? 'your dropped pin' : 'you'}`
                : `${stops.length} stops`}
              {outing.radiusM != null &&
                stops.length > 1 &&
                `, spread over ${formatDistance(outing.radiusM)}`}
              {position ? '.' : ' — drop a location to route them.'}
            </p>
            <button className="btn small" onClick={clearOuting}>
              Clear
            </button>
          </div>
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
                  {prev && <span className="row-dist">+{formatDistance(haversine(prev, site))}</span>}
                  <button
                    className="stop-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromTrip(site.id);
                    }}
                    aria-label={`Remove ${site.name} from trip`}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ol>
          {mapsUrl ? (
            <a className="btn primary outing-export" href={mapsUrl} target="_blank" rel="noreferrer">
              Open route in Google Maps ↗
            </a>
          ) : stops.length > 10 ? (
            <p className="hint">
              Too many stops for one Google Maps link — open directions from each
              site's card instead.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="hint">
          Build a trip by tapping <strong>+ Add to trip</strong> on any site — or
          let the app find one below.
        </p>
      )}

      <details className="outing-finder">
        <summary>Find one for me</summary>

        <p className="hint">
          Pick the kinds of day you want — the nearest cluster with one of each,
          as a ready-made route.
        </p>

        {layers.map(({ parent, leaves }) => {
          // A single-leaf parent (e.g. Historic pubs) has no finer subcategories:
          // it stays a plain on/off switch for "include a stop of this kind".
          const hasSubs = !(leaves.length === 1 && (leaves[0] as string) === parent);

          if (!hasSubs) {
            const on = outingTypes.has(leaves[0]);
            return (
              <section className="layer" key={parent}>
                <button
                  className={`layer-toggle ${on ? 'on' : 'off'}`}
                  onClick={() => toggleOutingType(leaves[0])}
                  aria-pressed={on}
                >
                  <span className="layer-name">{PARENT_CATEGORY_LABELS[parent]}</span>
                  <span className="switch" aria-hidden="true" />
                </button>
              </section>
            );
          }

          // Multi-leaf parent (Folklore). The mode control decides how the ticked
          // chips combine: "one of each" = a stop per chip; "any of these" = one
          // stop covering any of them (or the whole category when none are ticked).
          const anyMode = outingAnyParents.has(parent);
          const pickedCount = leaves.filter((t) => outingTypes.has(t)).length;
          const off = !anyMode && pickedCount === 0;
          const allOn = pickedCount === leaves.length;
          const noneOn = pickedCount === 0;

          return (
            <section className="layer" key={parent}>
              <div className={`layer-head ${off ? 'off' : ''}`}>
                <span className="layer-name">{PARENT_CATEGORY_LABELS[parent]}</span>
                <div className="mode-toggle" role="group" aria-label={`${PARENT_CATEGORY_LABELS[parent]} match mode`}>
                  <button
                    className={`mode-opt ${!anyMode ? 'on' : ''}`}
                    onClick={() => setOutingParentAny(parent, false)}
                    aria-pressed={!anyMode}
                  >
                    One of each
                  </button>
                  <button
                    className={`mode-opt ${anyMode ? 'on' : ''}`}
                    onClick={() => setOutingParentAny(parent, true)}
                    aria-pressed={anyMode}
                  >
                    Any of these
                  </button>
                </div>
              </div>

              <div className="layer-subs">
                <div className="subs-controls">
                  <button
                    className="link-btn"
                    onClick={() => setOutingTypesActive(leaves, true)}
                    disabled={allOn}
                  >
                    Select all
                  </button>
                  <button
                    className="link-btn"
                    onClick={() => setOutingTypesActive(leaves, false)}
                    disabled={noneOn}
                  >
                    Deselect all
                  </button>
                </div>
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

              {anyMode && (
                <p className="layer-hint">
                  {pickedCount === 0
                    ? 'One stop — any folklore sub-type.'
                    : pickedCount === 1
                      ? 'One stop of the selected type.'
                      : `One stop — any of the ${pickedCount} selected.`}
                </p>
              )}
            </section>
          );
        })}

        <label className="outing-toggle">
          <input
            type="checkbox"
            checked={includeVisited}
            onChange={(e) => setIncludeVisited(e.target.checked)}
          />
          Include sites I've already visited
        </label>

        <div className="outing-actions">
          <button className="btn primary" onClick={handleFind} disabled={!canFind}>
            Find outing
          </button>
          {/* "Find another" iterates the cluster search — only meaningful for a
              found outing, not a hand-picked trip. */}
          {outing && !outing.edited && (
            <button className="btn" onClick={() => findOuting(true)}>
              Find another
            </button>
          )}
        </div>

        {!position && (
          <p className="hint">
            No location yet — allow GPS or use the 📍 button on the map to drop an
            "I am here" pin.
          </p>
        )}
        {position && !canFind && (
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
                .map(({ slot }) => (
                  <li key={slot}>
                    <span className="dot" style={{ background: outingSlotColor(slot) }} />
                    {outingSlotLabel(slot)}:{' '}
                    {includeVisited ? 'none in the collection' : 'none left unvisited'}
                  </li>
                ))}
            </ul>
            <p className="hint">Try dropping the type, or include visited sites.</p>
          </div>
        )}
      </details>
    </div>
  );
}
