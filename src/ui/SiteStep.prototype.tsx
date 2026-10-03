// PROTOTYPE — throwaway (issue #113). Not for main.
//
// Question: how does the phone show that a swipe on an open site steps to the
// next site? The swipe works in every variant. Three hints, switched by
// `?variant=` and the bar at the top:
//
//   card  — the next and the previous site's pictures show cut off at the
//           edges of the peek, as the next place card does in Google Maps.
//           A tap on one steps.
//   foot  — one quiet line under the peek names the previous and the next
//           site. A tap on a name steps.
//   nudge — no controls. The first three times a site opens, the peek slides
//           a little to the side and back. After that, nothing.

import { RowThumb } from './RowThumb';
import { copy } from '../copy';
import type { Site } from '../data/types';

type Variant = 'card' | 'foot' | 'nudge';
const VARIANTS: Variant[] = ['card', 'foot', 'nudge'];
const NAMES: Record<Variant, string> = {
  card: 'card — next card peeks in',
  foot: 'foot — next name under the peek',
  nudge: 'nudge — slide on first opens',
};

export const variant: Variant = (() => {
  if (!import.meta.env.DEV) return 'foot';
  const v = new URLSearchParams(location.search).get('variant');
  return VARIANTS.includes(v as Variant) ? (v as Variant) : 'card';
})();

const NUDGE_KEY = 'proto113-nudges';
const NUDGES = 3;

/** Whether this open gets the nudge, and counts it. Reset with
 *  `?variant=nudge&reset`. */
let last = { at: 0, result: false };
try {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('reset')) localStorage.removeItem(NUDGE_KEY);
} catch {
  // No storage: the nudge never shows.
}
export function takeNudge(): boolean {
  if (variant !== 'nudge') return false;
  // StrictMode calls a state initialiser twice; count that as one open.
  if (performance.now() - last.at < 100) return last.result;
  last = { at: performance.now(), result: countNudge() };
  return last.result;
}
function countNudge(): boolean {
  try {
    const n = Number(localStorage.getItem(NUDGE_KEY) ?? 0);
    if (n >= NUDGES) return false;
    localStorage.setItem(NUDGE_KEY, String(n + 1));
    return true;
  } catch {
    return false;
  }
}

/** Variant card: the neighbour's picture, cut off at the edge of the peek. */
export function Sliver({ site, side, onStep }: { site?: Site; side: 'prev' | 'next'; onStep: () => void }) {
  if (variant !== 'card' || !site) return null;
  return (
    <button
      className={`proto-sliver ${side}`}
      onClick={onStep}
      aria-label={side === 'next' ? copy.near.nextSite(site.name) : copy.near.previousSite(site.name)}
    >
      <RowThumb key={site.id} site={site} />
    </button>
  );
}

/** Variant foot: the neighbours' names under the peek. */
export function Foot({ prev, next, onStep }: { prev?: Site; next?: Site; onStep: (dir: 1 | -1) => void }) {
  if (variant !== 'foot') return null;
  return (
    <div className="proto-foot-row">
      {prev ? (
        <button onClick={() => onStep(-1)} aria-label={copy.near.previousSite(prev.name)}>
          <b>‹</b>
          <span>{prev.name}</span>
        </button>
      ) : (
        <span />
      )}
      {next && (
        <button className="next" onClick={() => onStep(1)} aria-label={copy.near.nextSite(next.name)}>
          <span>{next.name}</span>
          <b>›</b>
        </button>
      )}
    </div>
  );
}

export function SiteStepSwitcher() {
  if (!import.meta.env.DEV) return null;
  const go = (d: number) => {
    const next = VARIANTS[(VARIANTS.indexOf(variant) + d + VARIANTS.length) % VARIANTS.length];
    const p = new URLSearchParams(location.search);
    p.set('variant', next);
    location.search = p.toString();
  };
  return (
    <div className="proto-switcher">
      <button onClick={() => go(-1)}>‹</button>
      <span>{NAMES[variant]}</span>
      <button onClick={() => go(1)}>›</button>
    </div>
  );
}
