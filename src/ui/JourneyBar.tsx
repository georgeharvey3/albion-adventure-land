import { useStore } from '../state/store';
import { DETOUR_BUDGETS } from '../geo/corridor';
import { formatDistance, haversine } from '../geo/haversine';
import { FlagIcon, MapPinIcon } from './icons';

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
// ENTERING EITHER END — issue #28 replaced the rule that used to live here
// ("no free-text search; runtime geocoding is ruled out"). It was right that an
// online-only lookup was unacceptable, and wrong that the only alternative was
// no search: the app now SHIPS an offline place dictionary
// (public/data/places.json, ~250 KB, precached), so search works with no signal
// and a runtime geocoder only ever adds rows on top.
//
// So BOTH ends are now tappable and open the search overlay. The From end
// tapping through to search is what lets you plan from the sofa — "I'll be in
// Aviemore tomorrow, what's near there?" — and it reads "Aviemore" rather than
// "Here" so the app never pretends a planned anchor is a measured one. Map-tap
// picking and "Set as destination" on a site card both still work; search is an
// addition, not a replacement.

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
  const openSearch = useStore((s) => s.openSearch);
  const useMyLocation = useStore((s) => s.useMyLocation);

  // A searched anchor says where it is; a dropped pin and live GPS keep the
  // labels they always had.
  const fromLabel = position?.label ?? (!position ? 'Locating…' : position.manual ? 'Dropped pin' : 'Here');
  // Only a SEARCHED anchor gets the reset button. A dropped pin already has one
  // (the map's drop-pin control doubles as "clear"), and live GPS has nothing
  // to reset to.
  const searchedFrom = !!position?.label;
  const journeyLength = position && destination ? haversine(position, destination) : null;

  return (
    <div className="journey-bar">
      <div className="journey-ends">
        <button
          className={searchedFrom ? 'journey-from searched' : 'journey-from'}
          onClick={() => openSearch('origin')}
          title="Search for somewhere to start from"
        >
          <MapPinIcon /> {fromLabel}
        </button>
        {searchedFrom && (
          <button
            className="journey-clear"
            onClick={useMyLocation}
            aria-label="Back to my location"
            title="Back to my location"
          >
            ⟲
          </button>
        )}
        {destination ? (
          <>
            <span className="journey-arrow" aria-hidden="true">
              →
            </span>
            <button
              className="journey-to"
              onClick={() => openSearch('destination')}
              title={`${destination.label} — tap to change`}
            >
              <FlagIcon /> {destination.label}
            </button>
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
            onClick={() =>
              pickingDestination ? setPickingDestination(false) : openSearch('destination')
            }
            title={
              pickingDestination
                ? 'Tap the map to set your destination, or tap here to cancel'
                : 'Search for a destination'
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
