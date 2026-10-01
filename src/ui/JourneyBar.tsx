import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { journeyBarMode } from '../state/journey';
import { FlagIcon, MapPinIcon } from './icons';
import { DETOUR_BUDGETS } from '../geo/corridor';
import { formatDuration } from '../geo/route';
import { formatDistance, haversine } from '../geo/haversine';
import { copy } from '../copy';

// The Origin → Destination bar (issue #14). ONE control, sitting above the
// tabs, that turns the whole app from a point query into a corridor query:
//
//   ┌ ORIGIN ──────┐   ┌ DESTINATION ─┐
//   │ My location  │ → │ Optional     │   (dashed while unset)
//   └──────────────┘   └──────────────┘
//
// There is deliberately no mode switcher and no new tab: point-vs-route is a
// real mode, but discovery-vs-planning is not — "+ Add to trip" is already the
// verb that turns a discovered site into a planned one. Setting a destination
// reinterprets the surfaces that exist; clearing it puts them back.
//
// THE TWO ENDS ARE SIBLINGS. The bar used to pair an ambient "📍 Here" label
// with a "+ Add destination" button, which made one journey read as two
// unrelated controls — the label looked like status, the button looked like a
// feature. They are now the same object twice: same box, same label row, same
// tap target, same search overlay behind them. The only difference the design
// carries is the one that is true — an unset destination is dashed rather than
// solid, because it is optional and the origin is not.
//
// Origin still defaults to the live fix, so route mode costs ONE input rather
// than two, and it never pretends: a searched anchor reads as its own place
// name and offers a reset, a dropped pin says so, and an unresolved fix says
// "Locating…".
//
// ENTERING EITHER END — issue #28 replaced the rule that used to live here
// ("no free-text search; runtime geocoding is ruled out"). It was right that an
// online-only lookup was unacceptable, and wrong that the only alternative was
// no search: the app now SHIPS an offline place dictionary
// (public/data/places.json, ~250 KB, precached), so search works with no signal
// and a runtime geocoder only ever adds rows on top.
//
// So BOTH ends open the search panel. The origin end tapping through to
// search is what lets you plan from the sofa — "I'll be in Aviemore tomorrow,
// what's near there?". Map-tap picking and "Set as destination" on a site card
// both still work; search is an addition, not a replacement.
//
// BOTH ENDS ALSO TAKE A MAP TAP. Picking the origin off the map was always
// possible — through the map's own drop-pin control — but nothing in the
// journey bar said so, so the two ends looked like they had different powers.
// They share one armed state now (`picking`), which is why an armed origin
// reads exactly like an armed destination here.
//
// ON A PHONE THE BAR SHOWS BY STATE (issue #126, src/state/journey.ts). With
// nothing set it is gone, and the floating row's route button opens the
// destination search. A set journey is one line that opens the full bar.

function budgetLabel(metres: number): string {
  return metres < 1000 ? copy.units.m(metres) : copy.units.km(Math.round(metres / 1000));
}

export function JourneyBar({ phone = false }: { phone?: boolean }) {
  const position = useStore((s) => s.position);
  const destination = useStore((s) => s.destination);
  const detourBudget = useStore((s) => s.detourBudget);
  const picking = useStore((s) => s.picking);
  const setDestination = useStore((s) => s.setDestination);
  const setDetourBudget = useStore((s) => s.setDetourBudget);
  const setPicking = useStore((s) => s.setPicking);
  const openSearch = useStore((s) => s.openSearch);
  const useMyLocation = useStore((s) => s.useMyLocation);
  const route = useStore((s) => s.route);

  // A searched anchor says where it is; a dropped pin and live GPS keep the
  // labels they always had. An armed end says so ahead of all of them, at
  // whichever end it is: the field you tapped through is the field that tells
  // you the map is now waiting for you.
  const originLabel =
    picking === 'origin'
      ? copy.journey.picking
      : !position
        ? copy.journey.locating
        : (position.label ?? (position.manual ? copy.journey.droppedPin : copy.journey.myLocation));
  // Anything the user set by hand — a searched anchor or a dropped pin — gets
  // the reset button. It is the only way back to live GPS now that the map's
  // drop-pin control is gone. Live GPS itself has nothing to reset to.
  const overriddenOrigin = !!position && (!!position.label || !!position.manual);

  // The phone's compact line opens the full bar. A change to either end, or
  // the end of an armed tap, folds it back: the edit it was opened for is done.
  const [expanded, setExpanded] = useState(false);
  const originKey = overriddenOrigin ? `${position?.lat},${position?.lng}` : '';
  useEffect(() => {
    setExpanded(false);
  }, [originKey, destination, picking]);
  const mode = journeyBarMode(
    { overriddenOrigin, hasDestination: !!destination, picking: !!picking },
    phone,
    expanded,
  );

  // The journey's own number. With a road route it is the road distance and the
  // driving time; without one it is the straight-line distance, and it says so.
  //
  // This is not a mode badge — there is deliberately none (issue #29). It is
  // the same slot telling the truth about the number in it. Printing
  // "148 km direct" while the list is filtered by a 172 km road would be a
  // plain falsehood, and the word "direct" is what keeps it honest.
  const journeySummary = route
    ? `${formatDistance(route.route.distance)} · ${formatDuration(route.route.duration)}`
    : position && destination
      ? copy.journey.direct(formatDistance(haversine(position, destination)))
      : null;

  const destinationValue = destination
    ? destination.label
    : picking === 'destination'
      ? copy.journey.picking
      : copy.journey.optional;

  if (mode === 'none') return null;

  if (mode === 'compact') {
    return (
      <button
        className="journey-bar journey-compact"
        onClick={() => setExpanded(true)}
        aria-label={copy.journey.edit}
        title={copy.journey.edit}
      >
        <MapPinIcon />
        <span className="journey-compact-place">{originLabel}</span>
        {destination && (
          <>
            <span className="journey-arrow" aria-hidden="true">
              →
            </span>
            <FlagIcon />
            <span className="journey-compact-place">{destination.label}</span>
          </>
        )}
        {journeySummary && <span className="journey-length">{journeySummary}</span>}
      </button>
    );
  }

  // On a phone the full bar folds back to its line, except while the map
  // waits for a tap: then the bar is the cancel, and stays.
  const canFold = phone && !picking;

  return (
    <div className={canFold ? 'journey-bar can-fold' : 'journey-bar'}>
      <div className="journey-ends">
        <div
          className={
            picking === 'origin'
              ? 'journey-field picking'
              : overriddenOrigin
                ? 'journey-field has-reset'
                : 'journey-field'
          }
        >
          <button
            className="journey-tap"
            // Armed, this end is its own cancel — the same rule the
            // destination end has always followed.
            onClick={() => (picking === 'origin' ? setPicking(null) : openSearch('origin'))}
            aria-pressed={picking === 'origin'}
            title={
              picking === 'origin'
                ? copy.journey.originPickingTitle
                : copy.journey.originTitle
            }
          >
            <span className="journey-label">{copy.journey.origin}</span>
            <span className="journey-value">{originLabel}</span>
          </button>
          {overriddenOrigin && (
            <button
              className="journey-reset"
              onClick={useMyLocation}
              aria-label={copy.journey.backToMe}
              title={copy.journey.backToMe}
            >
              ⟲
            </button>
          )}
        </div>

        <span className="journey-arrow" aria-hidden="true">
          →
        </span>

        <div
          className={
            destination
              ? 'journey-field has-reset'
              : picking === 'destination'
                ? 'journey-field picking'
                : 'journey-field empty'
          }
        >
          <button
            className="journey-tap"
            // While the map is armed, this end is the cancel: the field is
            // already saying "tap the map", so it must be able to take that
            // back without a second control appearing next to it.
            onClick={() =>
              picking === 'destination' ? setPicking(null) : openSearch('destination')
            }
            aria-pressed={picking === 'destination'}
            title={
              destination
                ? copy.journey.changeDestination(destination.label)
                : picking === 'destination'
                  ? copy.journey.destinationPickingTitle
                  : copy.journey.destinationTitle
            }
          >
            <span className="journey-label">{copy.journey.destination}</span>
            <span className={destination ? 'journey-value' : 'journey-value unset'}>
              {destinationValue}
            </span>
          </button>
          {destination && (
            <button
              className="journey-reset"
              onClick={() => setDestination(null)}
              aria-label={copy.journey.clearDestination}
              title={copy.journey.clearDestinationTitle}
            >
              ✕
            </button>
          )}
        </div>

        {canFold && (
          <button
            className="journey-fold"
            onClick={() => setExpanded(false)}
            aria-label={copy.journey.fold}
            title={copy.journey.fold}
          >
            ⌃
          </button>
        )}
      </div>

      {destination && (
        <div className="journey-controls">
          <label className="journey-budget">
            {copy.journey.detour}{' '}
            <select
              value={detourBudget}
              onChange={(e) => setDetourBudget(Number(e.target.value))}
              aria-label={copy.journey.detourBudget}
            >
              {DETOUR_BUDGETS.map((m) => (
                <option key={m} value={m}>
                  {budgetLabel(m)}
                </option>
              ))}
            </select>
          </label>
          {journeySummary && <span className="journey-length">{journeySummary}</span>}
        </div>
      )}

      {picking === 'destination' && !destination && (
        <p className="journey-hint">{copy.journey.destinationHint}</p>
      )}
      {picking === 'origin' && (
        <p className="journey-hint">{copy.journey.originHint}</p>
      )}
    </div>
  );
}
