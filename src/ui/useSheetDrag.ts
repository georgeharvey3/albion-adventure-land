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
// Two places take a drag. The handle takes any pointer, and never scrolls.
// The list takes a touch only, and shares it with the scroll: after DRAG_SLOP
// px, `dragIntent` gives the touch to the sheet or leaves it to the list for
// the rest of the gesture. A sideways touch stays with the list, so the
// picture carousel in an open row still swipes.

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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function useSheetDrag({
  enabled,
  sheet,
  setSheet,
  stops,
  body,
}: {
  /** Off on the side panel, which has no vertical travel. */
  enabled: boolean;
  sheet: SheetHeight;
  setSheet: (sheet: SheetHeight) => void;
  /** Null until the app and the sheet head are measured. */
  stops: SheetStops | null;
  /** The list's scroll container, while it is mounted. */
  body: HTMLElement | null;
}) {
  // The sheet's height in px while a finger holds it; null when it rests.
  const [dragPx, setDragPx] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  // Set when the handle moved past the slop, so the click that follows the
  // pointerup is not also taken as a tap.
  const handleMoved = useRef(false);
  // The touch listeners are added once per list, so they read these through
  // a ref instead of a stale closure.
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
    setDragPx(clamp(d.startPx - (y - d.startY), stops.low, stops.full));
  };

  const end = () => {
    const d = drag.current;
    const { stops, setSheet } = live.current;
    drag.current = null;
    setDragPx(null);
    if (!d || !stops) return;
    const velocity = performance.now() - d.lastT > STILL ? 0 : d.velocity;
    const px = clamp(d.startPx - (d.lastY - d.startY), stops.low, stops.full);
    setSheet(snapSheet(stops, px, velocity));
  };

  const cancel = () => {
    drag.current = null;
    setDragPx(null);
  };

  const handleProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      handleMoved.current = false;
      if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (!begin(e.clientY)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      if (!handleMoved.current && Math.abs(e.clientY - d.startY) < DRAG_SLOP) return;
      handleMoved.current = true;
      move(e.clientY);
    },
    onPointerUp: () => {
      if (handleMoved.current) end();
      else cancel();
    },
    onPointerCancel: cancel,
    // A tap, or Enter and Space on the focused handle.
    onClick: () => {
      if (handleMoved.current) {
        handleMoved.current = false;
        return;
      }
      live.current.setSheet(tapHandle(live.current.sheet));
    },
  };

  useEffect(() => {
    if (!enabled || !body) return;
    let start: { x: number; y: number } | null = null;
    let mode: 'sheet' | 'scroll' | null = null;
    // The click that ends a sheet drag must not also open the row under it.
    let swallowUntil = 0;

    const onStart = (e: TouchEvent) => {
      mode = null;
      start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (mode === null) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_SLOP) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          mode = 'scroll';
          return;
        }
        mode = dragIntent({ dy, scrollTop: body.scrollTop, height: live.current.sheet });
        if (mode === 'sheet' && !begin(t.clientY)) mode = 'scroll';
      }
      if (mode === 'sheet') {
        e.preventDefault();
        move(t.clientY);
      }
    };
    const onEnd = () => {
      if (mode === 'sheet') {
        end();
        swallowUntil = performance.now() + 400;
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

    body.addEventListener('touchstart', onStart, { passive: true });
    // Not passive: a sheet drag must stop the list from scrolling.
    body.addEventListener('touchmove', onMove, { passive: false });
    body.addEventListener('touchend', onEnd);
    body.addEventListener('touchcancel', onCancel);
    body.addEventListener('click', onClick, true);
    return () => {
      body.removeEventListener('touchstart', onStart);
      body.removeEventListener('touchmove', onMove);
      body.removeEventListener('touchend', onEnd);
      body.removeEventListener('touchcancel', onCancel);
      body.removeEventListener('click', onClick, true);
    };
    // begin, move, end and cancel read only refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, body]);

  return { dragPx, handleProps };
}
