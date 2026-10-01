import { useEffect, useRef, useState } from 'react';
import {
  DRAG_SLOP,
  dragIntent,
  snapSheet,
  tapHandle,
  type SheetHeight,
  type SheetStops,
} from '../state/sheet';

// The drag that moves the phone sheet (issue #110). No gesture library: the
// rules are in state/sheet.ts, and this hook only feeds them the finger.
//
// Two places take a touch drag. The sheet head — the handle, the journey bar
// and the tabs — never scrolls, so any vertical drag on it moves the sheet,
// after DRAG_SLOP px so a tap on a tab stays a tap. The list shares the touch
// with its scroll: `dragIntent` gives the touch to the sheet or leaves it to
// the list for the rest of the gesture. A drag up on the list always scrolls,
// so only the head raises the sheet. The list decides on the first move,
// because iOS starts its own scroll on that move and ignores a later
// `preventDefault`. A sideways touch stays with the list, so the picture
// carousel in an open row still swipes. A mouse or a pen drags the handle.

interface Drag {
  startY: number;
  startPx: number;
  lastY: number;
  lastT: number;
  /** px per ms, positive up. */
  velocity: number;
}

/** A pause this long, in ms, before the finger lifts cancels the flick. */
const STILL = 100;

/** How long, in ms, after a sheet drag ends a click is taken as part of it. */
const CLICK_AFTER_DRAG = 400;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The sheet height under a finger at `y`. */
const heightAt = (d: Drag, y: number, stops: SheetStops) =>
  clamp(d.startPx - (y - d.startY), stops.low, stops.full);

export function useSheetDrag({
  enabled,
  sheet,
  setSheet,
  stops,
  head,
  body,
}: {
  /** Off on the side panel, which has no vertical travel. */
  enabled: boolean;
  sheet: SheetHeight;
  setSheet: (sheet: SheetHeight) => void;
  /** Null until the app and the sheet head are measured. */
  stops: SheetStops | null;
  /** The sheet head. */
  head: HTMLElement | null;
  /** The list's scroll container, while it is mounted. */
  body: HTMLElement | null;
}) {
  // The sheet's height in px while a finger holds it; null when it rests.
  const [dragPx, setDragPx] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  // Set when the handle moved past the slop, so the click that follows the
  // pointerup is not also taken as a tap.
  const handleMoved = useRef(false);
  // The touch listeners are added once per element, so they read these
  // through a ref instead of a stale closure.
  const live = useRef({ sheet, stops, setSheet });
  live.current = { sheet, stops, setSheet };

  const begin = (y: number): boolean => {
    const { sheet, stops } = live.current;
    if (!stops) return false;
    const now = performance.now();
    drag.current = { startY: y, startPx: stops[sheet], lastY: y, lastT: now, velocity: 0 };
    return true;
  };

  const move = (y: number) => {
    const d = drag.current;
    const stops = live.current.stops;
    if (!d || !stops) return;
    const now = performance.now();
    const dt = now - d.lastT;
    // Smoothed, because one late touch event makes a wild sample.
    if (dt > 0) d.velocity = 0.7 * ((d.lastY - y) / dt) + 0.3 * d.velocity;
    d.lastY = y;
    d.lastT = now;
    setDragPx(heightAt(d, y, stops));
  };

  const end = () => {
    const d = drag.current;
    const { stops, setSheet } = live.current;
    drag.current = null;
    setDragPx(null);
    if (!d || !stops) return;
    const velocity = performance.now() - d.lastT > STILL ? 0 : d.velocity;
    setSheet(snapSheet(stops, heightAt(d, d.lastY, stops), velocity));
  };

  const cancel = () => {
    drag.current = null;
    setDragPx(null);
  };

  const handleProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      handleMoved.current = false;
      // A touch on the handle is a touch on the head, handled below.
      if (!enabled || e.pointerType === 'touch') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!begin(e.clientY)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || e.pointerType === 'touch') return;
      if (!handleMoved.current && Math.abs(e.clientY - d.startY) < DRAG_SLOP) return;
      handleMoved.current = true;
      move(e.clientY);
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'touch') return;
      if (handleMoved.current) end();
      else cancel();
    },
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') cancel();
    },
    // A tap, or Enter and Space on the focused handle.
    onClick: () => {
      if (handleMoved.current) {
        handleMoved.current = false;
        return;
      }
      live.current.setSheet(tapHandle(live.current.sheet));
    },
  };

  // One effect per element. The list mounts during a drag off the low height,
  // and a shared effect would then tear down the head's listeners, and the
  // drag they hold, under the finger.
  useEffect(() => (enabled && head ? listen(head, 'head') : undefined), [enabled, head]);
  useEffect(() => (enabled && body ? listen(body, 'list') : undefined), [enabled, body]);

  // Reads only refs and the stable helpers above, so a listener added once
  // stays current.
  function listen(el: HTMLElement, kind: 'head' | 'list') {
    let start: { x: number; y: number } | null = null;
    let mode: 'sheet' | 'scroll' | null = null;
    // Past the slop: the finger dragged, so the click that ends the gesture
    // must not also press the tab or open the row under it.
    let moved = false;
    let swallowUntil = 0;

    const onStart = (e: TouchEvent) => {
      mode = null;
      moved = false;
      start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      // A second finger is a pinch, not a drag.
      if (e.touches.length !== 1) {
        if (mode === 'sheet') cancel();
        start = null;
        mode = null;
        return;
      }
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= DRAG_SLOP) moved = true;
      if (mode === null) {
        if (dx === 0 && dy === 0) return;
        if (kind === 'head' && !moved) return;
        if (Math.abs(dx) > Math.abs(dy)) mode = 'scroll';
        else if (kind === 'head') mode = 'sheet';
        else mode = dragIntent({ dy, scrollTop: el.scrollTop });
        // The browser has already taken the touch for its own scroll.
        if (mode === 'sheet' && (!e.cancelable || !begin(start.y))) mode = 'scroll';
      }
      if (mode === 'sheet') {
        e.preventDefault();
        move(t.clientY);
      }
    };
    const onEnd = () => {
      if (mode === 'sheet') {
        end();
        if (moved) swallowUntil = performance.now() + CLICK_AFTER_DRAG;
      }
      start = null;
      mode = null;
    };
    const onCancel = () => {
      if (mode === 'sheet') cancel();
      start = null;
      mode = null;
    };
    const onClick = (e: MouseEvent) => {
      if (performance.now() > swallowUntil) return;
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    // Not passive: a sheet drag must stop the list from scrolling.
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onCancel);
    el.addEventListener('click', onClick, true);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
      el.removeEventListener('click', onClick, true);
    };
  }

  return { dragPx, handleProps };
}
