import { useStore } from '../state/store';
import { CheckIcon, FlagIcon, MapPinIcon } from './icons';
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
import { formatDetour } from '../geo/corridor';
import { routeLength } from '../geo/tsp';
import { maxRouteStops, multiStopRoute } from '../links/googleMaps';
import { copy } from '../copy';

// Outing tab. One shared, ephemeral route is populated two ways:
//   • hand-picking — "Add to trip" on a site card builds an ordered subset of
//     the day (no type constraint), shown here as the primary content.
//   • the cluster algorithm — the collapsible "Find one for me" finder picks
//     the nearest full-house of the selected types (spec §6 F12/F14/F16). Its
//     type picker is a QUERY, independent of the map filter.
// Either way the output is the same: an NN+2-opt route + Google Maps handoff.
//
// With a destination pinned (issue #15) the same trip becomes a road trip: the
// destination is a fixed final stop, and the headline changes to the only
// number that means anything on a corridor — how much extra driving the stops
// cost. "Distance from anchor + spread" describes a cluster you drive out to;
// it says nothing useful about a route you were making anyway.
//
// The finder follows (issue #16): with a destination set it stops looking for
// the nearest cluster and looks for one of each ON THE WAY, inside the detour
// budget. So its copy shifts too, and its failure state gains a third answer —
// "nothing of that type is within the budget" — whose remedy is the budget
// control in the journey bar rather than dropping the type.

export function Outing() {
  const sites = useStore((s) => s.sites);
  const position = useStore((s) => s.position);
  const destination = useStore((s) => s.destination);
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

  // Route mode's headline: the drive you were doing anyway versus the drive
  // with the stops folded in. Recomputed from the live anchor rather than read
  // off the stored result, so it doesn't go stale as GPS moves.
  const drive =
    position && destination
      ? {
          base: haversine(position, destination),
          withStops: routeLength(position, stops, destination),
        }
      : null;

  // A big selection can exceed Google Maps' ~9-waypoint URL cap (multiStopRoute
  // throws above it) — hide the export rather than crash; the per-stop
  // directions still work from the site card. A pinned destination occupies the
  // URL's destination slot, so one fewer stop fits.
  const stopCap = maxRouteStops(!!destination);
  const mapsUrl =
    position && stops.length > 0 && stops.length <= stopCap
      ? multiStopRoute([
          { lat: position.lat, lng: position.lng },
          ...stops,
          ...(destination ? [destination] : []),
        ])
      : null;

  // A fresh Find overwrites the shared route. Confirm first if the current one
  // was hand-picked, so the finder can't silently nuke a trip (spec decision).
  const handleFind = () => {
    if (outing?.edited && !window.confirm(copy.outing.replaceConfirm)) {
      return;
    }
    findOuting();
  };

  return (
    <div className="outing">
      {outing ? (
        <div className="outing-result">
          <div className="outing-result-head">
            {drive ? (
              <p className="hint">
                {copy.outing.drive(
                  formatDistance(drive.base),
                  stops.length,
                  formatDistance(drive.withStops),
                  formatDistance(Math.max(0, drive.withStops - drive.base)),
                )}
              </p>
            ) : (
              <p className="hint">
                {copy.outing.summary(
                  stops.length,
                  position
                    ? {
                        distance: formatDistance(outing.distanceFromAnchor),
                        manual: !!position.manual,
                      }
                    : null,
                  outing.radiusM != null && stops.length > 1
                    ? formatDistance(outing.radiusM)
                    : null,
                )}
              </p>
            )}
            <button className="btn small" onClick={clearOuting}>
              {copy.outing.clear}
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
                      {site.id in visited && <CheckIcon />}
                      {site.id in visited && ' '}
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
                    aria-label={copy.outing.remove(site.name)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
            {/* Where you were going anyway. It closes the route rather than
                being one of its picks, so it carries no number and no ✕ —
                it's cleared from the journey bar, not from the trip. */}
            {destination && (
              <li className="row trip-destination">
                <span className="stop-num" aria-hidden="true">
                  <FlagIcon />
                </span>
                <span className="row-main">
                  <span className="row-name">{destination.label}</span>
                  <span className="row-sub">{copy.outing.destination}</span>
                </span>
                {stops.length > 0 && (
                  <span className="row-dist">
                    +{formatDistance(haversine(stops[stops.length - 1], destination))}
                  </span>
                )}
              </li>
            )}
          </ol>
          {mapsUrl ? (
            <a className="btn primary outing-export" href={mapsUrl} target="_blank" rel="noreferrer">
              {copy.outing.openInMaps}
            </a>
          ) : stops.length > stopCap ? (
            <p className="hint">{copy.outing.tooManyStops}</p>
          ) : null}
        </div>
      ) : (
        <p className="hint">
          {copy.outing.empty.before} <strong>{copy.outing.empty.action}</strong>{' '}
          {copy.outing.empty.after}
        </p>
      )}

      <details className="outing-finder">
        <summary>{copy.outing.findForMe}</summary>

        <p className="hint">
          {destination
            ? copy.outing.pickOnTheWay(destination.label)
            : copy.outing.pickNearest}
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
                <div className="mode-toggle" role="group" aria-label={copy.outing.matchMode(PARENT_CATEGORY_LABELS[parent])}>
                  <button
                    className={`mode-opt ${!anyMode ? 'on' : ''}`}
                    onClick={() => setOutingParentAny(parent, false)}
                    aria-pressed={!anyMode}
                  >
                    {copy.outing.oneOfEach}
                  </button>
                  <button
                    className={`mode-opt ${anyMode ? 'on' : ''}`}
                    onClick={() => setOutingParentAny(parent, true)}
                    aria-pressed={anyMode}
                  >
                    {copy.outing.anyOfThese}
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
                    {copy.outing.selectAll}
                  </button>
                  <button
                    className="link-btn"
                    onClick={() => setOutingTypesActive(leaves, false)}
                    disabled={noneOn}
                  >
                    {copy.outing.deselectAll}
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
                    ? copy.outing.anyFolklore
                    : pickedCount === 1
                      ? copy.outing.anyOne
                      : copy.outing.anySelected(pickedCount)}
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
          {copy.outing.includeVisited}
        </label>

        <div className="outing-actions">
          <button className="btn primary" onClick={handleFind} disabled={!canFind}>
            {copy.outing.find}
          </button>
          {/* "Find another" iterates the cluster search — only meaningful for a
              found outing, not a hand-picked trip. */}
          {outing && !outing.edited && (
            <button className="btn" onClick={() => findOuting(true)}>
              {copy.outing.findAnother}
            </button>
          )}
        </div>

        {!position && (
          <p className="hint">
            {copy.outing.noLocation.before} <MapPinIcon /> {copy.outing.noLocation.after}
          </p>
        )}
        {position && !canFind && (
          <p className="hint">{copy.outing.pickAType}</p>
        )}

        {failure?.kind === 'no-more' && (
          <p className="outing-failure">{copy.outing.noMore}</p>
        )}
        {failure?.kind === 'missing-types' && (
          <div className="outing-failure">
            {/* In route mode a type fails either way: nothing left anywhere, or
                nothing close enough to the route. Both are listed, each with
                the reason that applies to it, so the remedy is obvious per
                type rather than guessed at. */}
            <p>
              {failure.budget !== null
                ? copy.outing.missingOnWay
                : copy.outing.missing}
            </p>
            <ul>
              {failure.nearest
                .filter(
                  ({ site, distance }) =>
                    !site || (failure.budget !== null && distance! > failure.budget),
                )
                .map(({ slot, site, distance }) => (
                  <li key={slot}>
                    <span className="dot" style={{ background: outingSlotColor(slot) }} />
                    {outingSlotLabel(slot)}:{' '}
                    {!site
                      ? includeVisited
                        ? copy.outing.noneAtAll
                        : copy.outing.noneUnvisited
                      : copy.outing.nearestIs(formatDetour(distance!))}
                  </li>
                ))}
            </ul>
            <p className="hint">
              {failure.budget !== null
                ? copy.outing.tryWider
                : copy.outing.tryDropping}
            </p>
          </div>
        )}
      </details>
    </div>
  );
}
