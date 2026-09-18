import { useEffect, useMemo, useState } from 'react';
import { WEEKDAYS, WEEKDAY_LABELS, type OpeningHours, type Site, type Weekday } from '../data/types';
import { ClockIcon } from './icons';

// The week's opening times and the dates behind them, on one block of the site
// card. Only the pubs carry these today (scripts/refresh-camra-status.ts).
//
// The dates are not decoration and they are not optional. An opening time in an
// offline app is a claim about a building the user is about to drive to, and the
// only honest version of that claim carries its age: when the source last had
// somebody in the pub (surveyed), when the source last edited the entry
// (updated), and when this app last read the page (checked). So the block
// renders as one unit — times above, dates below — and it does not render at all
// unless there is something real in it.

/** JS `getDay()` is Sunday-first; our week is Monday-first, as CAMRA prints it. */
function todayName(): Weekday {
  return WEEKDAYS[(new Date().getDay() + 6) % 7];
}

/** "24:00" is how schema.org spells closing at midnight, and "closes 24:00"
 *  reads like a typo on a card. Everything else is already in the 24-hour form
 *  a British pub sign uses. */
function time(hhmm: string): string {
  return hhmm === '24:00' || hhmm === '00:00' ? 'midnight' : hhmm;
}

function formatDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** One row per day of the week, in order, with the day's periods joined. A day
 *  the source gives no period for is shut, which is a fact worth printing —
 *  leaving the row out would read as "we don't know". */
function byDay(hours: readonly OpeningHours[]): { day: Weekday; text: string }[] {
  return WEEKDAYS.map((day) => {
    const periods = hours.filter((h) => h.day === day);
    return {
      day,
      text: periods.length
        ? periods.map((p) => `${time(p.opens)} – ${time(p.closes)}`).join(', ')
        : 'Closed',
    };
  });
}

export function OpeningTimes({ site }: { site: Site }) {
  const rows = useMemo(() => byDay(site.hours ?? []), [site.hours]);
  const today = todayName();
  const [open, setOpen] = useState(false);

  // A new selection starts closed. Without this the week stays open as you tap
  // down the near-me list, and every card below the first opens tall.
  useEffect(() => setOpen(false), [site.id]);

  const dates = [
    ['Surveyed', formatDate(site.lastSurveyed)],
    ['Updated', formatDate(site.lastUpdated)],
    ['Checked', formatDate(site.checkedAt)],
  ].filter((d): d is [string, string] => d[1] !== null);

  const hasHours = !!site.hours?.length;
  if (!hasHours && dates.length === 0) return null;

  const todayRow = rows.find((r) => r.day === today)!;

  return (
    <section className="card-hours">
      {hasHours && (
        <>
          {/* Today's hours ARE the control. Collapsed, the card answers the only
              question asked in a car park — "can I go in now?" — in one line;
              the rest of the week is one tap away. */}
          <button
            type="button"
            className="hours-today"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <ClockIcon />
            <span className="hours-today-day">{WEEKDAY_LABELS[todayRow.day]}</span>
            <span className="hours-today-text">{todayRow.text}</span>
            <span className="hours-chevron" aria-hidden="true">
              {open ? '▴' : '▾'}
            </span>
          </button>
          {open && (
            <dl className="hours-week">
              {rows.map(({ day, text }) => (
                <div key={day} className={day === today ? 'hours-row is-today' : 'hours-row'}>
                  <dt>{WEEKDAY_LABELS[day]}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
      {dates.length > 0 && (
        <p className="card-hours-dates">
          {dates.map(([label, value]) => `${label} ${value}`).join(' · ')}
        </p>
      )}
    </section>
  );
}
