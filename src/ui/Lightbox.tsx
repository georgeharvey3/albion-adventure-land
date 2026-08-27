import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type SiteImage } from '../data/types';

// Full-screen viewer for a listing's guidebook pictures. Hand-rolled rather than
// pulled from a library, for the same reason the geometry is (see CLAUDE.md):
// the bundle and the offline story are features.
//
// Zoom is capped at the picture's own pixels — the guidebook plates vary from
// 284px wide to 878px, so a fixed multiplier would either waste the detail in a
// big plate or blow a small one up into mush. `MIN_MAX_SCALE` still allows a
// little upscaling on the small ones, because peering at a blurry carving beats
// not being able to enlarge it at all.
const MIN_MAX_SCALE = 2;
const MAX_MAX_SCALE = 8;
// A one-finger drag this far across, while not zoomed in, changes picture.
const SWIPE_PX = 60;

interface Point {
  x: number;
  y: number;
}

const ORIGIN: Point = { x: 0, y: 0 };

interface View {
  scale: number;
  offset: Point;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function Lightbox({
  images,
  startIndex,
  onClose,
}: {
  images: SiteImage[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [view, setView] = useState<View>({ scale: 1, offset: ORIGIN });
  const [maxScale, setMaxScale] = useState(MIN_MAX_SCALE);
  // The picture's laid-out size, computed rather than left to `max-width`, so
  // the pan clamp has an exact size to work from.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // Several pointermove events can fire between renders during a fast pinch, so
  // the gesture maths reads the view from a ref, never from the render's state.
  const viewRef = useRef(view);
  const setViewNow = useCallback((next: View) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Live pointers, keyed by pointerId: one is a pan or a swipe, two are a pinch.
  const pointers = useRef(new Map<number, Point>());
  // Pinch bookkeeping, and enough of the gesture's history to tell a swipe from
  // a tap on release.
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const dragStart = useRef<Point>(ORIGIN);
  const dragged = useRef(false);

  const image = images[index];
  const { scale, offset } = view;
  const zoomed = scale > 1.01;

  const reset = useCallback(() => setViewNow({ scale: 1, offset: ORIGIN }), [setViewNow]);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const next = i + delta;
        return next < 0 || next >= images.length ? i : next;
      });
      reset();
    },
    [images.length, reset],
  );

  // Zoom ceiling is per-picture, so it is recomputed whenever the displayed
  // picture (or the space it is laid out in) changes.
  const measure = useCallback(() => {
    const el = imgRef.current;
    const stage = stageRef.current;
    if (!el || !stage || !el.naturalWidth) return;
    // Open at the picture's own size, and shrink it only when it is wider or
    // taller than the stage. The `1` cap is the point: a 284px plate opens at
    // 284px, sharp, rather than being stretched across the screen into mush.
    const fit = Math.min(
      1,
      stage.clientWidth / el.naturalWidth,
      stage.clientHeight / el.naturalHeight,
    );
    const w = el.naturalWidth * fit;
    setBox({ w, h: el.naturalHeight * fit });
    // Zooming is still offered on everything. A downscaled plate goes back to
    // its own pixels and no further; one already shown at full size gets
    // MIN_MAX_SCALE, which is upscaling, but only once the reader asks for it.
    setMaxScale(Math.min(MAX_MAX_SCALE, Math.max(MIN_MAX_SCALE, el.naturalWidth / w)));
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, index]);

  // Keep the picture from being dragged so far that it leaves the screen: it may
  // travel by half the overhang in each axis, and not at all where it fits.
  const clamp = useCallback((next: Point, atScale: number): Point => {
    const stage = stageRef.current;
    const el = imgRef.current;
    if (!stage || !el) return next;
    const limitX = Math.max(0, (el.clientWidth * atScale - stage.clientWidth) / 2);
    const limitY = Math.max(0, (el.clientHeight * atScale - stage.clientHeight) / 2);
    return {
      x: Math.min(limitX, Math.max(-limitX, next.x)),
      y: Math.min(limitY, Math.max(-limitY, next.y)),
    };
  }, []);

  // Zoom about a fixed screen point (the pinch midpoint, or the double-tap
  // position) so the thing under the fingers stays under the fingers. The
  // transform is `translate(offset) scale(s)` about the element centre, so a
  // point `u` in unscaled local coordinates sits at `centre + offset + s*u`.
  const zoomAbout = useCallback(
    (nextScale: number, screenPoint: Point, from: View) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const local = {
        x: (screenPoint.x - centre.x - from.offset.x) / from.scale,
        y: (screenPoint.y - centre.y - from.offset.y) / from.scale,
      };
      const next = {
        x: screenPoint.x - centre.x - nextScale * local.x,
        y: screenPoint.y - centre.y - nextScale * local.y,
      };
      setViewNow({
        scale: nextScale,
        offset: nextScale <= 1.01 ? ORIGIN : clamp(next, nextScale),
      });
    },
    [clamp, setViewNow],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragged.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: distance(a, b), scale: viewRef.current.scale };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);

    if (pointers.current.size >= 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const ratio = distance(a, b) / (pinchStart.current.dist || 1);
      const next = Math.min(maxScale, Math.max(1, pinchStart.current.scale * ratio));
      dragged.current = true;
      zoomAbout(next, midpoint(a, b), viewRef.current);
      return;
    }

    if (Math.abs(now.x - dragStart.current.x) > 6 || Math.abs(now.y - dragStart.current.y) > 6) {
      dragged.current = true;
    }
    // Panning only means something once the picture is bigger than the screen;
    // unzoomed, a one-finger drag is a swipe between pictures instead.
    if (viewRef.current.scale > 1.01) {
      const { scale: s, offset: o } = viewRef.current;
      setViewNow({
        scale: s,
        offset: clamp({ x: o.x + (now.x - prev.x), y: o.y + (now.y - prev.y) }, s),
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const start = dragStart.current;
    const wasPinching = pointers.current.size >= 2;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;

    if (wasPinching || pointers.current.size > 0) return;

    const dx = e.clientX - start.x;
    const stillFitted = viewRef.current.scale <= 1.01;
    if (stillFitted && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(e.clientY - start.y)) {
      go(dx < 0 ? 1 : -1);
      return;
    }
    // A clean tap on the backdrop (not the picture) closes, matching the usual
    // full-screen-viewer habit.
    if (!dragged.current && e.target === stageRef.current) onClose();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (viewRef.current.scale > 1.01) reset();
    else zoomAbout(maxScale, { x: e.clientX, y: e.clientY }, viewRef.current);
  };

  // Wheel zoom, about the cursor. Registered by hand because it must be
  // non-passive: without preventDefault the browser scrolls the page underneath.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const from = viewRef.current;
      const next = Math.min(maxScale, Math.max(1, from.scale * Math.exp(-e.deltaY / 400)));
      zoomAbout(next, { x: e.clientX, y: e.clientY }, from);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [maxScale, zoomAbout]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, reset]);

  // Rendered into <body>, not in place. The detail card sets `z-index: 600`, which
  // makes it a stacking context: any z-index used inside it is resolved against
  // its siblings only, so the viewer could never rise above Leaflet's controls
  // (z-index 1000) while it stayed a descendant of the card.
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Picture viewer">
      <button className="lightbox-close" onClick={onClose} aria-label="Close viewer">
        ×
      </button>
      {images.length > 1 && (
        <div className="lightbox-count" aria-live="polite">
          {index + 1} / {images.length}
        </div>
      )}
      <div
        className="lightbox-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <img
          ref={imgRef}
          src={`${import.meta.env.BASE_URL}${image.url}`}
          alt={image.caption ?? ''}
          onLoad={measure}
          draggable={false}
          style={{
            width: box ? `${box.w}px` : undefined,
            height: box ? `${box.h}px` : undefined,
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            cursor: zoomed ? 'grab' : 'zoom-in',
          }}
        />
      </div>
      {images.length > 1 && (
        <>
          <button
            className="lightbox-nav prev"
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="Previous picture"
          >
            ‹
          </button>
          <button
            className="lightbox-nav next"
            onClick={() => go(1)}
            disabled={index === images.length - 1}
            aria-label="Next picture"
          >
            ›
          </button>
        </>
      )}
      {image.caption && <p className="lightbox-caption">{image.caption}</p>}
    </div>,
    document.body,
  );
}
