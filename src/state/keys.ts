// The one keyboard handler (issue #88). Every surface that answers a key
// registers a layer here instead of adding its own window listener, so two
// surfaces can never both act on one key press.
//
// A layer has a rank. A key goes to the layers from the top rank down, and the
// first layer that handles it stops it. So Esc closes the top layer only: the
// lightbox, then the site card, then search, then the sheet.
//
// This module knows nothing about the DOM. The glue that listens on the window
// and says what the key was pressed in lives in src/ui/useKeyLayer.ts.

/** Where the key was pressed. A text field owns every key except Esc, and a
 *  button or a link owns Enter and Space. */
export type KeyTarget = 'text' | 'control' | 'none';

export interface KeyPress {
  key: string;
  target: KeyTarget;
  /** Ctrl, Alt or Meta was held. Those keys belong to the browser. */
  modified: boolean;
}

export interface KeyLayer {
  rank: number;
  /** Return true when the layer handled the key. That stops it. */
  onKey: (press: KeyPress) => boolean;
  /** A modal layer is the only layer that gets keys while it is up. */
  modal?: boolean;
  /** A passive layer sees every key, before the rules below apply, and never
   *  stops one. The title card uses it: any key dismisses the card, and the
   *  same key still does what the reader meant. */
  passive?: boolean;
}

/** The Esc order, top first. Equal ranks never show together, or the one
 *  registered last wins. */
export const KEY_RANK = {
  menu: 60,
  lightbox: 50,
  card: 40,
  search: 30,
  sheet: 10,
  list: 0,
} as const;

function reaches(press: KeyPress): boolean {
  if (press.key === 'Escape') return true;
  if (press.modified || press.target === 'text') return false;
  if (press.target === 'control' && (press.key === 'Enter' || press.key === ' ')) return false;
  return true;
}

export function createKeyHub() {
  // Registration order breaks a tie in rank: the newest layer is on top.
  const layers: KeyLayer[] = [];

  return {
    register(layer: KeyLayer): () => void {
      layers.push(layer);
      return () => {
        const i = layers.indexOf(layer);
        if (i >= 0) layers.splice(i, 1);
      };
    },

    /** Returns true when a layer handled the key, so the caller can stop the
     *  browser's own action for it. */
    handle(press: KeyPress): boolean {
      for (const layer of layers) if (layer.passive) layer.onKey(press);
      if (!reaches(press)) return false;
      const ordered = layers
        .map((layer, i) => ({ layer, i }))
        .filter(({ layer }) => !layer.passive)
        .sort((a, b) => b.layer.rank - a.layer.rank || b.i - a.i);
      for (const { layer } of ordered) {
        if (layer.onKey(press)) return true;
        if (layer.modal) return false;
      }
      return false;
    },
  };
}

export type KeyHub = ReturnType<typeof createKeyHub>;

/** A layer body that answers Esc and nothing else, which is most of them. */
export function onEscape(close: () => void): KeyLayer['onKey'] {
  return ({ key }) => {
    if (key !== 'Escape') return false;
    close();
    return true;
  };
}

/** The row `j` (delta 1) or `k` (delta -1) moves to from `current`.
 *
 *  It stops at both ends rather than wrapping: the list is sorted by distance,
 *  so a wrap from the furthest site to the nearest is a jump across Britain.
 *  With no current row, or one the filter has since hidden, it starts at the
 *  top — the nearest site is the one the reader most likely wants. */
export function stepCursor(ids: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (!ids.length) return null;
  const index = current === null ? -1 : ids.indexOf(current);
  if (index < 0) return ids[0];
  return ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
}
