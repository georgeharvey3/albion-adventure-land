import { useStore } from '../state/store';
import { DETOUR_BUDGETS } from '../geo/corridor';
import { formatDistance, haversine } from '../geo/haversine';

// The From → To bar (issue #14). ONE control, sitting above the tabs, that
// turns the whole app from a point query into a corridor query:
//
//   📍 Here                            + Add destination
//   📍 Here  →  Dunnottar Castle  ✕    [detour ≤ 10 km ▾]
//
// There is deliberately no mode switcher and no new tab: point-vs-route is a
// real mode, but discovery-vs-planning is not — "+ Add to trip" is already the
// verb that turns a discovered site into a planned one. Setting a destination
// reinterprets the surfaces that exist; clearing it puts them back.
//
// `From` is always the existing anchor (live GPS, or a dropped pin), so route
// mode costs the user ONE input rather than two.
//
// DESTINATION ENTRY — no free-text search. Runtime geocoding is ruled out by
// the architecture (build-time only, cached), so you can't type "Fort William".
// A destination comes from a map tap or from a site already in the dataset
// ("Set as destination" on any site card), which covers the road-trip intent
// that motivated this. Adding free-text would mean shipping an offline place
// index or an online-only lookup — neither is in scope here.

function budgetLabel(metres: number): string {
  return metres < 1000 ? `${metres} m` : `${Math.round(metres / 1000)} km`;
}

export function JourneyBar() {
  const position = useStore((s) => s.position);
  const destination = useStore((s) => s.destination);
  const detourBudget = useStore((s) => s.detourBudget);
  const pickingDestination = useStore((s) => s.pickingDestination);
  const setDestination = useStore((s) => s.setDestination);
  const setDetourBudget = useStore((s) => s.setDetourBudget);
  const setPickingDestination = useStore((s) => s.setPickingDestination);

  const fromLabel = !position ? 'Locating…' : position.manual ? 'Dropped pin' : 'Here';
  const journeyLength = position && destination ? haversine(position, destination) : null;

  return (
    <div className="journey-bar">
      <div className="journey-ends">
        <span className="journey-from">📍 {fromLabel}</span>
        {destination ? (
          <>
            <span className="journey-arrow" aria-hidden="true">
              →
            </span>
            <span className="journey-to" title={destination.label}>
              🏁 {destination.label}
            </span>
            <button
              className="journey-clear"
              onClick={() => setDestination(null)}
              aria-label="Clear destination"
              title="Clear destination (back to near-me)"
            >
              ✕
            </button>
          </>
        ) : (
          <button
            className={pickingDestination ? 'journey-add picking' : 'journey-add'}
            onClick={() => setPickingDestination(!pickingDestination)}
            disabled={!position}
            title={
              position
                ? 'Pick a destination on the map'
                : 'Waiting for a location to travel from'
            }
            aria-pressed={pickingDestination}
          >
            {pickingDestination ? 'Tap the map…' : '+ Add destination'}
          </button>
        )}
      </div>

      {destination && (
        <div className="journey-controls">
          <label className="journey-budget">
            detour ≤{' '}
            <select
              value={detourBudget}
              onChange={(e) => setDetourBudget(Number(e.target.value))}
              aria-label="Detour budget"
            >
              {DETOUR_BUDGETS.map((m) => (
                <option key={m} value={m}>
                  {budgetLabel(m)}
                </option>
              ))}
            </select>
          </label>
          {journeyLength !== null && (
            <span className="journey-length">{formatDistance(journeyLength)} direct</span>
          )}
        </div>
      )}

      {pickingDestination && !destination && (
        <p className="journey-hint">
          Tap where you're heading, or open a site and choose “Set as destination”.
        </p>
      )}
    </div>
  );
}
