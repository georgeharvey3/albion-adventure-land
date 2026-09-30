import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { STRIP_WINDOW, windowToShow } from '../state/strip';
import { middleFrame, swipeSelects } from '../state/phoneStrip';
import { siteSwatch } from '../data/types';
import { FramePlate, frameFigure, useStrip } from './Strip';
import { CheckIcon, StarIcon } from './icons';
import { copy } from '../copy';

// The phone's picture row (issue #111): the desktop strip's frames, one wide
// frame at a time, floating over the bottom of the map at the low height of
// the sheet. The rules are in src/state/phoneStrip.ts, and what the row holds
// is the strip's rule (src/state/strip.ts), so the row reads the view from the
// last `moveend` and a pan costs it nothing.
//
// The frame in the middle lifts its pin, and the lift follows the swipe. At
// the low height there is no peek: the middle card is the selected site. A
// swipe selects the middle card when it comes to rest, as Prev and Next do in
// the desktop spread, and a pin tap or a search brings its card to the
// middle. The map holds the view while a site is selected (MapView.tsx), so
// the row does not re-sort under the steps. A tap on a card opens the site
// at the middle height, with its hero picture (issue #112).
//
// The row is outside the Leaflet container, so a swipe on it never pans the
// map, and a map pan never moves the row. It stays mounted while it hides, so
// its pictures stay loaded.

/** Idle time, in ms, after the last scroll event that ends a swipe. */
const IDLE = 120;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function PhoneStrip({
  shown,
  onHeight,
}: {
  shown: boolean;
  /** The row's height in px while it shows, else 0. It is the bottom covered
   *  inset, so the view box and the pans keep clear of it. */
  onHeight: (px: number) => void;
}) {
  const setSelected = useStore((s) => s.setSelected);
  const openSite = useStore((s) => s.openSite);
  const lifted = useStore((s) => s.lifted);
  const setLifted = useStore((s) => s.setLifted);
  const dropLifted = useStore((s) => s.dropLifted);
  const viewport = useStore((s) => s.viewport);

  const strip = useStrip();
  const views = strip.kind === 'sites' ? strip.views : [];
  const showing = shown && views.length > 0;

  /** How many frames are in the DOM. Not a count the user sees. */
  const [rendered, setRendered] = useState(STRIP_WINDOW);
  const boxRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLUListElement>(null);
  /** The site whose frame is in the middle, as this row last lifted it. */
  const middle = useRef<string | null>(null);
  /** Set while the row scrolls itself, so the frames it passes stay down. */
  const steering = useRef(false);
  const idle = useRef(0);
  const frame = useRef(0);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const report = () => onHeight(showing ? Math.ceil(el.getBoundingClientRect().height) : 0);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => {
      observer.disconnect();
      onHeight(0);
    };
  }, [onHeight, showing]);

  /** Read the middle frame and lift its pin. At the end of a swipe by the
   *  user, select the middle card's site too. */
  const takeMiddle = (atRest: boolean) => {
    const row = rowRef.current;
    if (!row) return;
    const frames = Array.from(row.children as HTMLCollectionOf<HTMLElement>, (li) => ({
      id: li.dataset.siteId ?? '',
      left: li.offsetLeft,
      width: li.offsetWidth,
    }));
    const id = middleFrame(frames, row.scrollLeft, row.clientWidth);
    if (!id) return;
    if (id !== middle.current) {
      middle.current = id;
      setLifted({ id, by: 'strip' });
    }
    if (!atRest) return;
    const picks = swipeSelects({
      middle: id,
      selected: useStore.getState().selectedSiteId,
      byUser: !steering.current,
    });
    steering.current = false;
    if (picks) setSelected(picks);
  };

  /** Scroll the row itself to `left`. The frames it passes lift nothing, and
   *  the stop selects nothing. */
  const steer = (left: number, smooth: boolean) => {
    const row = rowRef.current;
    if (!row) return;
    const to = Math.max(0, Math.min(left, row.scrollWidth - row.clientWidth));
    // A scroll to where the row already is fires no event to end it.
    if (Math.abs(to - row.scrollLeft) < 1) return;
    steering.current = true;
    row.scrollTo({ left: to, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  };

  // A new view is a new row: back to the first window, at the start. The
  // journey list does not depend on the view, so a pan leaves it alone.
  const inJourney = strip.kind === 'sites' && strip.from === 'journey';
  const viewKey = inJourney ? null : viewport;
  useEffect(() => {
    setRendered(STRIP_WINDOW);
    middle.current = null;
    steer(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, inJourney]);

  // The selected site's card is in the middle: a pin tap, a search or a step
  // brings it there. With no site selected, the nearest site lifts on a new
  // view.
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  useEffect(() => {
    if (!showing) {
      // Hidden, the row lifts nothing: the list and the card have the pins.
      const { lifted: now } = useStore.getState();
      if (now?.by === 'strip') dropLifted(now.id);
      middle.current = null;
      return;
    }
    const index = selectedSiteId ? views.findIndex((v) => v.site.id === selectedSiteId) : -1;
    if (index < 0) {
      if (!middle.current) takeMiddle(false);
      return;
    }
    if (selectedSiteId === middle.current) return;
    if (index >= rendered) {
      setRendered(windowToShow(index));
      return;
    }
    const row = rowRef.current;
    const li = row?.children[index] as HTMLElement | undefined;
    if (!row || !li) return;
    middle.current = selectedSiteId;
    setLifted({ id: selectedSiteId!, by: 'strip' });
    steer(li.offsetLeft + li.offsetWidth / 2 - row.clientWidth / 2, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing, selectedSiteId, rendered, viewKey, views[0]?.site.id]);

  useEffect(
    () => () => {
      window.clearTimeout(idle.current);
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  const onScroll = () => {
    const row = rowRef.current;
    if (!row) return;
    if (rendered < views.length && row.scrollLeft + 2 * row.clientWidth >= row.scrollWidth) {
      setRendered((n) => n + STRIP_WINDOW);
    }
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => takeMiddle(true), IDLE);
    if (steering.current) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => takeMiddle(false));
  };

  return (
    <div ref={boxRef} className={showing ? 'phone-strip' : 'phone-strip away'} aria-hidden={!showing}>
      <ul className="phone-strip-row" ref={rowRef} onScroll={onScroll} aria-label={copy.strip.region}>
        {views.slice(0, rendered).map((view) => {
          const { site, visited, wishlisted } = view;
          const classes = ['pframe', site.id === lifted?.id && 'lifted', visited && 'is-visited'];
          return (
            <li key={site.id} data-site-id={site.id}>
              <button
                className={classes.filter(Boolean).join(' ')}
                tabIndex={showing ? 0 : -1}
                onClick={() => openSite(site.id)}
              >
                <FramePlate site={site} figure={frameFigure(view)} />
                <span className="pframe-name">
                  <span className="dot" style={{ background: siteSwatch(site) }} aria-hidden="true" />
                  <span className="pframe-text">
                    {visited && <CheckIcon />}
                    {wishlisted && !visited && <StarIcon filled />}
                    {(visited || wishlisted) && ' '}
                    {site.name}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
