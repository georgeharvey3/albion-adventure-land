import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { STRIP_WINDOW, windowToShow } from '../state/strip';
import { middleFrame } from '../state/phoneStrip';
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
// The frame in the middle lifts its pin, and the lift follows the swipe. A
// pin tap lifts the pin, and this row brings its frame to the middle
// (MapView.tsx). A tap on a frame opens the site at the middle height, with
// its hero picture (issue #112). × brings the row back.
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
  const setSheet = useStore((s) => s.setSheet);
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
  /** Set while a pin tap scrolls the row, so the frames it passes stay down. */
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

  const liftMiddle = () => {
    const row = rowRef.current;
    if (!row) return;
    const frames = Array.from(row.children as HTMLCollectionOf<HTMLElement>, (li) => ({
      id: li.dataset.siteId ?? '',
      left: li.offsetLeft,
      width: li.offsetWidth,
    }));
    const id = middleFrame(frames, row.scrollLeft, row.clientWidth);
    if (!id || id === middle.current) return;
    middle.current = id;
    setLifted({ id, by: 'strip' });
  };

  // A new view is a new row: back to the first window, at the start, and the
  // nearest site lifts. The journey list does not depend on the view, so a
  // pan leaves it alone. The row lifts only while it shows.
  const inJourney = strip.kind === 'sites' && strip.from === 'journey';
  const viewKey = inJourney ? null : viewport;
  useEffect(() => {
    setRendered(STRIP_WINDOW);
    rowRef.current?.scrollTo({ left: 0 });
    middle.current = null;
    steering.current = false;
  }, [viewKey, inJourney]);

  useEffect(() => {
    if (!showing) {
      // Hidden, the row lifts nothing: the list and the peek have the pins.
      const { lifted: now } = useStore.getState();
      if (now?.by === 'strip') dropLifted(now.id);
      middle.current = null;
      return;
    }
    liftMiddle();
    // A new first frame is a new middle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing, viewKey, views[0]?.site.id]);

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
    idle.current = window.setTimeout(() => {
      steering.current = false;
      liftMiddle();
    }, IDLE);
    if (steering.current) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(liftMiddle);
  };

  // A pin tap lifts its site: bring its frame to the middle.
  useEffect(() => {
    if (!showing || lifted?.by !== 'strip' || lifted.id === middle.current) return;
    const index = views.findIndex((v) => v.site.id === lifted.id);
    if (index < 0) return;
    if (index >= rendered) {
      setRendered(windowToShow(index));
      return;
    }
    const li = rowRef.current?.querySelector<HTMLElement>(`[data-site-id="${CSS.escape(lifted.id)}"]`);
    if (!li) return;
    middle.current = lifted.id;
    steering.current = true;
    li.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifted, rendered, showing]);

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
                onClick={() => {
                  // Selected first, so the list height to come back to is
                  // the low one, where the row is.
                  setSelected(site.id);
                  setSheet('mid');
                }}
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
