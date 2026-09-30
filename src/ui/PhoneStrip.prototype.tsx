// PROTOTYPE — throwaway (issue #111). Not for main.
//
// Question: on a phone, at the low height of the sheet, can a row of picture
// frames sit with the map, so a swipe through the pictures lifts each pin?
// Variants on the real app, switched by `?variant=` and the bar at the top:
//
//   now — main as it stands: no row.
//   A   — Carousel: one wide frame in the middle, its neighbours peek at the
//         edges. Floats over the bottom of the map.
//   B   — Filmstrip: small square frames, four or five in sight, the middle
//         one ringed. Floats over the bottom of the map.
//   C   — Docked: landscape frames with the name on the picture, inside the
//         sheet head over the journey bar. The row is part of the sheet, so
//         the low height grows and the map shrinks.
//
// `?lift=` answers Q3:
//   live — the lift follows the frame under the middle as the row moves.
//   stop — only the frame where the swipe stops lifts.
//
// In every variant: a tap on a frame opens the site (the peek, #112). A tap
// on a pin scrolls the row to its frame and lifts it; a second tap on the
// lifted pin opens the site. The map pans only if the lifted pin is out of
// sight, and that pan does not re-sort the row. The row hides while a site is
// open and at the middle and full heights.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { STRIP_WINDOW, windowToShow } from '../state/strip';
import { siteSwatch } from '../data/types';
import { FramePlate, frameFigure, useStrip } from './Strip';
import { CheckIcon, StarIcon } from './icons';
import { copy } from '../copy';

export type StripVariant = 'now' | 'A' | 'B' | 'C';
const VARIANTS: StripVariant[] = ['now', 'A', 'B', 'C'];
const NAMES: Record<StripVariant, string> = {
  now: 'now — no row',
  A: 'A — Carousel',
  B: 'B — Filmstrip',
  C: 'C — Docked in sheet',
};
type LiftMode = 'live' | 'stop';

const params = new URLSearchParams(location.search);

/** The variant in the URL. Dev builds only; production is always `now`. */
export const stripVariant: StripVariant = (() => {
  if (!import.meta.env.DEV) return 'now';
  const v = params.get('variant');
  return VARIANTS.includes(v as StripVariant) ? (v as StripVariant) : 'A';
})();
const liftMode: LiftMode = params.get('lift') === 'stop' ? 'stop' : 'live';

export const stripOn = stripVariant !== 'now';
/** A and B float over the map; C sits in the sheet head. */
export const stripFloats = stripVariant === 'A' || stripVariant === 'B';

/** The ids the row holds now, so a pin tap knows whether it has a frame. */
export const stripIds = new Set<string>();

/** Idle time, in ms, after the last scroll event that counts as a stop. */
const IDLE = 110;

export function PhoneStrip({
  shown,
  onHeight,
}: {
  shown: boolean;
  /** The row's height in px, for the covered inset (A and B). */
  onHeight?: (px: number) => void;
}) {
  const setSelected = useStore((s) => s.setSelected);
  const lifted = useStore((s) => s.lifted);
  const setLifted = useStore((s) => s.setLifted);
  const viewport = useStore((s) => s.viewport);

  const strip = useStrip();
  const views = strip.kind === 'sites' ? strip.views : [];
  const [rendered, setRendered] = useState(STRIP_WINDOW);
  const rowRef = useRef<HTMLUListElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const centred = useRef<string | null>(null);
  const programmatic = useRef(false);
  const idleTimer = useRef(0);
  const raf = useRef(0);

  stripIds.clear();
  for (const v of views) stripIds.add(v.site.id);

  // Report the row's height (A and B cover the bottom of the map).
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !onHeight) return;
    const report = () => onHeight(shown ? Math.ceil(el.getBoundingClientRect().height) : 0);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight, shown]);

  /** The id of the frame nearest the middle of the row. */
  const middleId = (): string | null => {
    const row = rowRef.current;
    if (!row) return null;
    const mid = row.scrollLeft + row.clientWidth / 2;
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    for (const li of Array.from(row.children) as HTMLElement[]) {
      const d = Math.abs(li.offsetLeft + li.offsetWidth / 2 - mid);
      if (d < bestD) {
        bestD = d;
        best = li;
      }
    }
    return best?.dataset.siteId ?? null;
  };

  const liftMiddle = () => {
    const id = middleId();
    if (!id || id === centred.current) return;
    centred.current = id;
    setLifted({ id, by: 'strip' });
  };

  // A new view is a new row: back to the start, and the first frame lifts.
  useEffect(() => {
    setRendered(STRIP_WINDOW);
    const row = rowRef.current;
    if (!row) return;
    programmatic.current = false;
    row.scrollTo({ left: 0 });
    centred.current = null;
    requestAnimationFrame(() => liftMiddle());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, views.length === 0]);

  const onScroll = () => {
    const row = rowRef.current;
    if (!row) return;
    if (rendered < views.length && row.scrollLeft + 2 * row.clientWidth >= row.scrollWidth) {
      setRendered((n) => n + STRIP_WINDOW);
    }
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      programmatic.current = false;
      liftMiddle();
    }, IDLE);
    if (programmatic.current || liftMode !== 'live') return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(liftMiddle);
  };

  // A pin tap lifts its site: bring its frame to the middle.
  useEffect(() => {
    if (!lifted || lifted.by !== 'strip' || lifted.id === centred.current) return;
    const index = views.findIndex((v) => v.site.id === lifted.id);
    if (index < 0) return;
    if (index >= rendered) {
      setRendered(windowToShow(index));
      return;
    }
    const li = rowRef.current?.querySelector<HTMLElement>(`[data-site-id="${CSS.escape(lifted.id)}"]`);
    if (!li) return;
    centred.current = lifted.id;
    programmatic.current = true;
    li.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifted, rendered]);

  const empty = strip.kind === 'zoomIn' ? copy.strip.zoomIn : views.length ? null : copy.strip.none;

  return (
    <div
      ref={boxRef}
      className={`pstrip pstrip-${stripVariant}${shown ? '' : ' pstrip-hidden'}`}
      aria-label={copy.strip.region}
    >
      {empty && <p className="pstrip-empty">{empty}</p>}
      <ul className="pstrip-row" ref={rowRef} onScroll={onScroll} hidden={!views.length}>
        {views.slice(0, rendered).map((view) => {
          const { site, visited, wishlisted } = view;
          const on = site.id === lifted?.id;
          return (
            <li key={site.id} data-site-id={site.id}>
              <button
                className={`pframe${on ? ' lifted' : ''}${visited ? ' is-visited' : ''}`}
                onClick={() => setSelected(site.id)}
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

/** The switcher: variant, lift mode, and the measures that answer Q1. */
export function StripSwitcher() {
  const [measure, setMeasure] = useState('');
  useEffect(() => {
    const tick = () => {
      const frame = document.querySelector('.pframe.lifted') ?? document.querySelector('.pframe');
      const area = document.querySelector<HTMLElement>('.map-area');
      const float = document.querySelector('.float-finder');
      const row = document.querySelector('.pstrip:not(.pstrip-hidden)');
      if (!area) return;
      const a = area.getBoundingClientRect();
      const top = float ? float.getBoundingClientRect().bottom : a.top;
      const bottom = row && stripFloats ? row.getBoundingClientRect().top : a.bottom;
      const f = frame ? Math.round(frame.getBoundingClientRect().height) : 0;
      setMeasure(`frame ${f}px · map ${Math.max(0, Math.round(bottom - top))}px of ${window.innerHeight}`);
    };
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, []);

  const go = (v: StripVariant, l: LiftMode) => {
    const p = new URLSearchParams(location.search);
    p.set('variant', v);
    p.set('lift', l);
    location.search = p.toString();
  };
  const step = (d: number) =>
    go(VARIANTS[(VARIANTS.indexOf(stripVariant) + d + VARIANTS.length) % VARIANTS.length], liftMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowLeft' && e.shiftKey) step(-1);
      if (e.key === 'ArrowRight' && e.shiftKey) step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!import.meta.env.DEV) return null;
  return (
    <div className="proto-switcher">
      <button onClick={() => step(-1)}>‹</button>
      <span>{NAMES[stripVariant]}</span>
      <button onClick={() => step(1)}>›</button>
      <button className="proto-lift" onClick={() => go(stripVariant, liftMode === 'live' ? 'stop' : 'live')}>
        lift: {liftMode}
      </button>
      <span className="proto-measure">{measure}</span>
    </div>
  );
}
