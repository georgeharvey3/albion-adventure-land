import { useEffect, useRef } from 'react';
import { createKeyHub, type KeyLayer, type KeyTarget } from '../state/keys';

// The window side of the one key handler (src/state/keys.ts). One listener for
// the whole app, added with the first layer.

const hub = createKeyHub();
let listening = false;

function targetOf(el: EventTarget | null): KeyTarget {
  if (!(el instanceof HTMLElement)) return 'none';
  if (el.isContentEditable) return 'text';
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return 'text';
  if (el instanceof HTMLInputElement) {
    // A checkbox takes no typing, so j and k still move the list while one has
    // the focus. A range slider counts as text: it owns the arrow keys.
    return ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(el.type)
      ? 'control'
      : 'text';
  }
  if (el.closest('button, a[href], summary, [role="button"], [role="menuitemradio"]')) return 'control';
  return 'none';
}

function onKeyDown(e: KeyboardEvent) {
  const handled = hub.handle({
    key: e.key,
    target: targetOf(e.target),
    modified: e.ctrlKey || e.metaKey || e.altKey,
  });
  if (handled) e.preventDefault();
}

/** Imperative registration, for code outside React (the Leaflet controls). */
export function registerKeyLayer(layer: KeyLayer): () => void {
  if (!listening) {
    window.addEventListener('keydown', onKeyDown);
    listening = true;
  }
  return hub.register(layer);
}

/**
 * Register a layer while `active` is true. `onKey` may change on every render;
 * the latest one always answers, and the layer keeps its place in the order.
 */
export function useKeyLayer(
  active: boolean,
  rank: number,
  onKey: KeyLayer['onKey'],
  options: { modal?: boolean; passive?: boolean } = {},
) {
  const latest = useRef(onKey);
  latest.current = onKey;
  const { modal, passive } = options;
  useEffect(() => {
    if (!active) return;
    return registerKeyLayer({ rank, modal, passive, onKey: (p) => latest.current(p) });
  }, [active, rank, modal, passive]);
}
