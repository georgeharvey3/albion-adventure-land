// The phone sheet (issue #110). One sheet with three heights replaces the old
// Browse and Map toggle:
//
// - low:  the map, with the journey bar and the tabs at the bottom.
// - mid:  the list over the lower half of the map.
// - full: the list over the whole screen. The map stays mounted under it.
//
// A drag on the handle moves the sheet between the heights. The rules here are
// pure, so the gesture code in useSheetDrag.ts only measures and applies them.
// This module imports nothing, so the tests can load it without a DOM.

export type SheetHeight = 'low' | 'mid' | 'full';

const ORDER: SheetHeight[] = ['low', 'mid', 'full'];

/** The share of the app that the middle height covers. */
const MID_SHARE = 0.5;

/** A release faster than this, in px per ms, is a flick. A flick goes on to
 *  the next height in its direction instead of the nearest one. */
export const FLICK = 0.5;

/** How far a finger moves, in px, before a drag on the list picks between
 *  the sheet and the scroll. */
export const DRAG_SLOP = 6;

export type SheetStops = Record<SheetHeight, number>;

/** The three heights in px, for an app `appHeight` tall whose low sheet (the
 *  handle, the journey bar and the tabs) is `lowHeight` tall. */
export function sheetStops(appHeight: number, lowHeight: number): SheetStops {
  return {
    low: lowHeight,
    mid: Math.max(lowHeight, Math.round(appHeight * MID_SHARE)),
    full: appHeight,
  };
}

export function sameStops(a: SheetStops | null, b: SheetStops | null): boolean {
  return !!a && !!b && a.low === b.low && a.mid === b.mid && a.full === b.full;
}

/** How much of the map, in px up from its bottom edge, the resting sheet
 *  covers. The map area stops at the low height, so only the middle height
 *  covers it. The full sheet hides the whole map, so nothing is fitted to it
 *  then. */
export function coveredBottom(stops: SheetStops, height: SheetHeight): number {
  return height === 'mid' ? stops.mid - stops.low : 0;
}

/** Whether the list lies over the map, so its rows show a picture and a
 *  teaser. On a phone an open site then takes the list's place in the sheet.
 *  On the side panel the map shows beside the list, so the rows open the
 *  floating card until the panel takes the window, and then open in place. A
 *  drag off the low height already shows the list. */
export function listInPlace(s: {
  height: SheetHeight;
  dragging: boolean;
  sidePanel: boolean;
}): boolean {
  if (s.sidePanel) return s.height === 'full';
  return s.height !== 'low' || s.dragging;
}

// On a phone a site opens in the sheet, in place of the list (issue #112).
// The tabs hide, and the journey bar stays. The peek heads the site: one row
// with a thumbnail, the name, the type and distance, and ×. The middle height
// adds the hero picture, and the full height is the whole page. At the low
// height there is no peek: the picture row's middle card is the selected
// site (issue #111), and a tap on the card opens it at the middle height. A
// selection off the low height opens the site at the height the sheet is at,
// from a pin or from a row. The side panel keeps the floating card and the
// rows that open in place.

/** Whether a selection at this height opens the site in the sheet. At the
 *  low height the picture row's middle card is the site (issue #111), so a
 *  selection there opens nothing: a card tap opens the site. */
export function opensInSheet(height: SheetHeight): boolean {
  return height !== 'low';
}

/** × or `Esc` on a phone. A site opened from the picture row goes back to the
 *  row, still selected, with its card in the middle. A site opened from the
 *  list goes back to the list at its height. A card with no site open in the
 *  sheet is cleared, and the height stays. */
export function closeSite(s: {
  siteInSheet: boolean;
  sheet: SheetHeight;
  listSheet: SheetHeight;
}): { keep: boolean; sheet: SheetHeight } {
  if (!s.siteInSheet) return { keep: false, sheet: s.sheet };
  if (s.listSheet === 'low') return { keep: true, sheet: 'low' };
  return { keep: false, sheet: s.listSheet };
}

/** The height the list comes back at when the open site closes: the height
 *  when the site opened. A step to another site keeps it. */
export function listHeight(s: {
  siteOpen: boolean;
  sheet: SheetHeight;
  listSheet: SheetHeight;
}): SheetHeight {
  return s.siteOpen ? s.listSheet : s.sheet;
}

/** "Show on map" in an open site: the low height on a phone, where the site
 *  stays selected as the picture row's card, and on the side panel the
 *  highest height that shows the card. */
export function showOnMap(sidePanel: boolean): SheetHeight {
  return sidePanel ? 'mid' : 'low';
}

/** Where a drag that let go at `px` settles. `velocity` is in px per ms, and
 *  positive is up. */
export function snapSheet(stops: SheetStops, px: number, velocity: number): SheetHeight {
  if (Math.abs(velocity) >= FLICK) {
    const up = velocity > 0;
    const next = up
      ? ORDER.find((h) => stops[h] > px)
      : [...ORDER].reverse().find((h) => stops[h] < px);
    return next ?? (up ? 'full' : 'low');
  }
  let best: SheetHeight = 'low';
  for (const h of ORDER) {
    if (Math.abs(stops[h] - px) < Math.abs(stops[best] - px)) best = h;
  }
  return best;
}

/** Whether a vertical drag on the list moves the sheet or scrolls the list.
 *  `dy` is positive for a finger that moves down. A drag up raises the sheet
 *  until it is full. A drag down lowers it only when the list is at its top,
 *  so the list scrolls back first. */
export function dragIntent(drag: {
  dy: number;
  scrollTop: number;
  height: SheetHeight;
}): 'sheet' | 'scroll' {
  if (drag.dy < 0) return drag.height === 'full' ? 'scroll' : 'sheet';
  return drag.scrollTop <= 0 ? 'sheet' : 'scroll';
}

/** One height up (1) or down (-1), stopping at both ends. `Esc` steps down. */
export function stepSheet(height: SheetHeight, dir: 1 | -1): SheetHeight {
  const i = ORDER.indexOf(height) + dir;
  return ORDER[Math.max(0, Math.min(ORDER.length - 1, i))];
}

/** A tap on the handle raises the sheet one height. From full it goes back to
 *  the middle, so a tap never hides the list it came from. */
export function tapHandle(height: SheetHeight): SheetHeight {
  return height === 'full' ? 'mid' : stepSheet(height, 1);
}

/** A tap on a tab. From low it opens the sheet at the middle height. On an
 *  open sheet another tab keeps the height, and the open tab lowers the sheet
 *  to free the map. */
export function tapTab<Tab extends string>(
  state: { tab: Tab; height: SheetHeight },
  next: Tab,
): { tab: Tab; height: SheetHeight } {
  if (state.height === 'low') return { tab: next, height: 'mid' };
  if (next === state.tab) return { tab: next, height: 'low' };
  return { tab: next, height: state.height };
}
