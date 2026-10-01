import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useFilteredSites, useVisibleSites } from '../state/selectors';
import { STRIP_WINDOW, stripSites, windowToShow, type SiteView, type Strip as StripState } from '../state/strip';
import { siteSwatch, SITE_TYPE_COLORS, SITE_TYPE_SINGULAR, type Site } from '../data/types';
import { formatDistance } from '../geo/haversine';
import { formatDetour } from '../geo/corridor';
import type { Destination, Position } from '../state/store';
import { CheckIcon, StarIcon } from './icons';
import { KEY_RANK, stepCursor } from '../state/keys';
import { useKeyLayer } from './useKeyLayer';
import { copy } from '../copy';

// The strip (issue #89): the desktop Nearby, a row of site frames along the
// bottom of the map. What it shows and in what order is src/state/strip.ts.
//
// It reads the view the map reported on its last `moveend`, so a pan costs the
// strip nothing. It renders one window of frames and adds the next when the
// user scrolls near the end, because a view at z7 can hold about 3000 sites.
// Each picture is an <img loading="lazy">: a background image on 2000 frames
// downloads all 2000 pictures at once.
//
// A frame is a list row in another shape. A hover on it lifts its pin, a hover
// on a pin marks it, `j` and `k` move the cursor along it, and a click opens
// the spread (Spread.tsx), whose Prev and Next step along the same order.

/** The frame's picture, full bleed, with its figure as a badge. With no
 *  picture, or one that fails to load, a wash in the site's colour names the
 *  kind of site it stands for. */
function FramePlate({ site, figure }: { site: Site; figure: string | null }) {
  const [broken, setBroken] = useState(false);
  const image = site.images?.[0];
  const painted = !image || broken;
  return (
    <span
      className={painted ? 'strip-plate painted' : 'strip-plate'}
      style={painted ? ({ '--tint': SITE_TYPE_COLORS[site.category] } as React.CSSProperties) : undefined}
    >
      {painted ? (
        <i>{SITE_TYPE_SINGULAR[site.category]}</i>
      ) : (
        <img
          src={`${import.meta.env.BASE_URL}${image.url}`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      )}
      {figure && <span className="strip-badge">{figure}</span>}
    </span>
  );
}

/** The distance from the anchor, or on a journey the detour. The order of the
 *  strip already says how far along the way a site is. */
function frameFigure({ distance, detour }: SiteView): string | null {
  if (detour !== null) return formatDetour(detour);
  return distance !== null ? formatDistance(distance) : null;
}

/** The line over the frames: what the order is measured from, or why there
 *  are no frames. */
function stripHeading(
  strip: StripState,
  reported: boolean,
  position: Position | null,
  destination: Destination | null,
): string | null {
  if (strip.kind === 'zoomIn') return copy.strip.zoomIn;
  if (!strip.views.length) {
    if (strip.from === 'journey') return copy.strip.noneOnTheWay;
    return reported ? copy.strip.none : null;
  }
  if (strip.from === 'journey' && destination) return copy.strip.alongTheWay(destination.label);
  if (strip.from === 'centre' || !position) return copy.strip.fromCentre;
  if (position.label) return copy.strip.fromPlace(position.label);
  return position.manual ? copy.strip.fromPin : copy.strip.fromYou;
}

/** What the strip shows now. The spread steps through the same order. */
export function useStrip(): StripState {
  const filtered = useFilteredSites();
  const visible = useVisibleSites();
  const position = useStore((s) => s.position);
  const destination = useStore((s) => s.destination);
  const viewport = useStore((s) => s.viewport);
  // useVisibleSites is the along-the-way list only when both ends are set.
  const journey = position && destination ? visible : null;
  return useMemo(
    () => stripSites({ filtered, journey, anchor: position, viewport }),
    [filtered, journey, position, viewport],
  );
}

export const Strip = forwardRef<HTMLElement>(function Strip(_props, ref) {
  const position = useStore((s) => s.position);
  const destination = useStore((s) => s.destination);
  const viewport = useStore((s) => s.viewport);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const setSelected = useStore((s) => s.setSelected);
  const lifted = useStore((s) => s.lifted);
  const setLifted = useStore((s) => s.setLifted);
  const dropLifted = useStore((s) => s.dropLifted);

  const strip = useStrip();
  const views = strip.kind === 'sites' ? strip.views : [];

  /** How many frames are in the DOM. Not a count the user sees. */
  const [rendered, setRendered] = useState(STRIP_WINDOW);
  const rowRef = useRef<HTMLUListElement>(null);

  // A new view is a new strip: back to the first window, at the start. A GPS
  // tick or a tick on a visit changes the frames in place and leaves the
  // scroll alone. The journey list does not depend on the view, so a pan
  // leaves it alone too. A pan that the keyboard cursor caused keeps the
  // cursor's place: the effect below brings its frame back into sight.
  const inJourney = strip.kind === 'sites' && strip.from === 'journey';
  const viewKey = inJourney ? null : viewport;
  const liftedRef = useRef(lifted);
  liftedRef.current = lifted;
  useEffect(() => {
    if (liftedRef.current?.by === 'key') return;
    setRendered(STRIP_WINDOW);
    rowRef.current?.scrollTo({ left: 0 });
  }, [viewKey, inJourney]);

  const onScroll = (e: React.UIEvent<HTMLUListElement>) => {
    const row = e.currentTarget;
    if (rendered < views.length && row.scrollLeft + 2 * row.clientWidth >= row.scrollWidth) {
      setRendered((n) => n + STRIP_WINDOW);
    }
  };

  // A mouse wheel scrolls up and down. The strip has only across.
  const onWheel = (e: React.WheelEvent<HTMLUListElement>) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
  };

  /** Scroll the strip so that the frame for `id` is in sight. */
  const showFrame = (id: string) =>
    rowRef.current
      ?.querySelector<HTMLElement>(`[data-site-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });

  // Keys (issue #88): `j` and `k` move the cursor along the strip, and Enter
  // opens the frame under it.
  useKeyLayer(views.length > 0, KEY_RANK.list, ({ key }) => {
    if (key === 'j' || key === 'k') {
      const next = stepCursor(
        views.map((v) => v.site.id),
        lifted?.id ?? selectedSiteId,
        key === 'j' ? 1 : -1,
      );
      if (!next) return false;
      setLifted({ id: next, by: 'key' });
      return true;
    }
    if (key === 'Enter' && lifted?.by === 'key' && views.some((v) => v.site.id === lifted.id)) {
      setSelected(lifted.id);
      return true;
    }
    return false;
  });

  // Keep the cursor frame on screen. Only a key moves the strip: a pin lift
  // must not scroll it away from what the user is looking at. Keyed on the
  // view too, because the cursor's pan can re-sort the strip round it.
  const viewsRef = useRef(views);
  viewsRef.current = views;
  useEffect(() => {
    if (lifted?.by !== 'key') return;
    const index = viewsRef.current.findIndex((v) => v.site.id === lifted.id);
    if (index < 0) return;
    if (index >= rendered) {
      setRendered(windowToShow(index));
      return;
    }
    showFrame(lifted.id);
  }, [lifted, rendered, viewport]);

  // Keep the open site's frame on screen too, so a step in the spread shows
  // where it is in the strip. Once per new selection: after that, the user's
  // own scroll wins.
  const followRef = useRef<string | null>(null);
  useEffect(() => {
    followRef.current = selectedSiteId;
  }, [selectedSiteId]);
  useEffect(() => {
    const id = followRef.current;
    if (!id) return;
    const index = views.findIndex((v) => v.site.id === id);
    if (index < 0) {
      followRef.current = null;
      return;
    }
    if (index >= rendered) {
      setRendered(windowToShow(index));
      return;
    }
    followRef.current = null;
    showFrame(id);
  });

  const heading = stripHeading(strip, viewport !== null, position, destination);

  return (
    <section ref={ref} className="strip" aria-label={copy.strip.region}>
      {heading && <p className={views.length ? 'strip-head' : 'strip-head empty'}>{heading}</p>}
      {views.length > 0 && (
        <ul className="strip-row" ref={rowRef} onScroll={onScroll} onWheel={onWheel}>
          {views.slice(0, rendered).map((view) => {
            const { site, visited, wishlisted } = view;
            const figure = frameFigure(view);
            const classes = [
              'frame',
              site.id === selectedSiteId && 'selected',
              site.id === lifted?.id && 'lifted',
              visited && 'is-visited',
            ].filter(Boolean);
            return (
              <li key={site.id}>
                <button
                  className={classes.join(' ')}
                  data-site-id={site.id}
                  onClick={() => setSelected(site.id)}
                  onPointerEnter={(e) => {
                    if (e.pointerType === 'mouse') setLifted({ id: site.id, by: 'row' });
                  }}
                  onPointerLeave={() => dropLifted(site.id)}
                >
                  <FramePlate site={site} figure={figure} />
                  <span className="frame-name">
                    <span className="dot" style={{ background: siteSwatch(site) }} aria-hidden="true" />
                    <span className="frame-text">
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
      )}
    </section>
  );
});
