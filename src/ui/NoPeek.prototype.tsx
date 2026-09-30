// PROTOTYPE — throwaway (issue #111 follow-up). Not for main.
//
// Question: with the picture row at the low height, is the site peek one
// widget too many? Two variants on the real app, switched by `?variant=` and
// the bar at the top:
//
//   now — PR #121 as it stands: a site open at the low height shows the peek,
//         and the row shows over it. The middle frame is the open site.
//   N   — no peek at the low height. The middle card is the selected site,
//         and the tabs stay. A pin tap or a swipe selects. A tap on a card
//         opens the site at the middle height. Lowering the sheet from a site
//         goes back to the row, with that card in the middle. The map pans
//         at the low height only when the selected pin is out of sight.

type Variant = 'now' | 'N';
const VARIANTS: Variant[] = ['N', 'now'];
const NAMES: Record<Variant, string> = {
  N: 'N — card is the peek',
  now: 'now — peek + row (#121)',
};

export const variant: Variant = (() => {
  if (!import.meta.env.DEV) return 'now';
  const v = new URLSearchParams(location.search).get('variant');
  return VARIANTS.includes(v as Variant) ? (v as Variant) : 'N';
})();

/** Variant N: the row's middle card is the peek. */
export const noPeek = variant === 'N';

/** N: `cardOpen` is set by a card tap, the one way up from the low height
 *  that opens the site. `skipRestore` stops the list height coming back when
 *  N itself clears the selection. */
export const proto = { cardOpen: false, skipRestore: false };

export function NoPeekSwitcher() {
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
