import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useFilteredSites, useVisibleSites } from '../state/selectors';
import { STRIP_WINDOW, stripSites, windowToShow, type SiteView } from '../state/strip';
import { siteSwatch, SITE_TYPE_LABELS, type Site } from '../data/types';
import { formatDistance } from '../geo/haversine';
import { formatDetour, formatProgress } from '../geo/corridor';
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
// the site card.

/** The frame's picture, or the painted placeholder in its layer colour (the
 *  peek's, pinPeek.ts) when there is none or it fails to load. */
function FramePlate({ site }: { site: Site }) {
  const [broken, setBroken] = useState(false);
  const image = site.images?.[0];
  if (!image || broken) {
    return <span className="strip-plate blank" style={{ background: siteSwatch(site) }} aria-hidden="true" />;
  }
  return (
    <span className="strip-plate">
      <img
        src={`${import.meta.env.BASE_URL}${image.url}`}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    </span>
  );
}

function frameFigure({ distance, detour, progress }: SiteView): string | null {
  if (detour !== null && progress !== null) return `${formatDetour(detour)} · ${formatProgress(progress)}`;
  return distance !== null ? formatDistance(distance) : null;
}

export const Strip = forwardRef<HTMLElement>(function Strip(_props, ref) {
  const filtered = useFilteredSites();
  const visible = useVisibleSites();
  const position = useStore((s) => s.position);
  const destination = useStore((s) => s.destination);
  const viewport = useStore((s) => s.viewport);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const setSelected = useStore((s) => s.setSelected);
  const lifted = useStore((s) => s.lifted);
  const setLifted = useStore((s) => s.setLifted);
  const dropLifted = useStore((s) => s.dropLifted);

  // useVisibleSites is the along-the-way list only when both ends are set.
  const journey = position && destination ? visible : null;
  const strip = useMemo(
    () => stripSites({ filtered, journey, anchor: position, viewport }),
    [filtered, journey, position, viewport],
  );
  const views = strip.kind === 'sites' ? strip.views : [];

  const [count, setCount] = useState(STRIP_WINDOW);
  const rowRef = useRef<HTMLUListElement>(null);

  // A new view is a new strip: back to the first window, at the start. A GPS
  // tick or a tick on a visit changes the frames in place and leaves the
  // scroll alone.
  const inJourney = !!journey;
  useEffect(() => {
    setCount(STRIP_WINDOW);
    rowRef.current?.scrollTo({ left: 0 });
  }, [viewport, inJourney]);

  const onScroll = (e: React.UIEvent<HTMLUListElement>) => {
    const row = e.currentTarget;
    if (count < views.length && row.scrollLeft + 2 * row.clientWidth >= row.scrollWidth) {
      setCount((n) => n + STRIP_WINDOW);
    }
  };

  // A mouse wheel scrolls up and down. The strip has only across.
  const onWheel = (e: React.WheelEvent<HTMLUListElement>) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
  };

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
  // must not scroll it away from what the user is looking at.
  const viewsRef = useRef(views);
  viewsRef.current = views;
  useEffect(() => {
    if (lifted?.by !== 'key') return;
    const index = viewsRef.current.findIndex((v) => v.site.id === lifted.id);
    if (index < 0) return;
    if (index >= count) {
      setCount(windowToShow(index));
      return;
    }
    rowRef.current
      ?.querySelector<HTMLElement>(`[data-site-id="${CSS.escape(lifted.id)}"]`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [lifted, count]);

  const message =
    strip.kind === 'zoomIn'
      ? copy.strip.zoomIn
      : views.length
        ? strip.from === 'centre'
          ? copy.strip.fromCentre
          : null
        : strip.from === 'journey'
          ? copy.near.noneInBudget
          : viewport
            ? copy.strip.none
            : null;

  return (
    <section ref={ref} className="strip" aria-label={copy.strip.region}>
      {message && <p className="strip-head">{message}</p>}
      {views.length > 0 && (
        <ul className="strip-row" ref={rowRef} onScroll={onScroll} onWheel={onWheel}>
          {views.slice(0, count).map((view) => {
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
                  <FramePlate site={site} />
                  <span className="frame-name">
                    {visited && <CheckIcon />}
                    {wishlisted && !visited && <StarIcon filled />}
                    {(visited || wishlisted) && ' '}
                    {site.name}
                  </span>
                  <span className="frame-sub">{SITE_TYPE_LABELS[site.category]}</span>
                  {figure && <span className="frame-fig">{figure}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});
