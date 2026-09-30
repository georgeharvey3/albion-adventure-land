import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { useVisibleSites } from "../state/selectors";
import {
  hybridTitle,
  siteSwatch,
  SITE_TYPE_COLORS,
  SITE_TYPE_LABELS,
  type Site,
} from "../data/types";
import { formatDistance } from "../geo/haversine";
import { formatDetour, formatProgress } from "../geo/corridor";
import { SiteBody } from "./SiteDetail";
import { CheckIcon, MapPinIcon, StarIcon } from "./icons";
import { KEY_RANK, stepCursor } from "../state/keys";
import { rowSheet, showOnMap } from "../state/sheet";
import { protoList, siteInSheet } from "./SiteSheet.prototype";
import { useKeyLayer } from "./useKeyLayer";
import { useSidePanel } from "./useWideScreen";
import { copy } from "../copy";

// Near me now (spec F4): every visible site sorted by haversine distance from
// the current position, respecting the active type filter. Tap a row to open it
// on the map / in the detail card.
//
// With a destination set (issue #14) this same list becomes the "along the way"
// list: the corridor filter has already dropped anything outside the detour
// budget, the rows arrive in travel order, and the trailing figure switches
// from raw distance to the two numbers that matter on a drive — what the stop
// costs you and how far into the journey it falls.
//
// While the list lies over the map (`inPlace`: the phone sheet at its middle
// or full height, issue #110), rows gain a thumbnail and a teaser, and tapping
// one opens the full write-up *in place* rather than throwing the reader to a
// card floating under the sheet. An opened site is stepped through with the
// prev/next bar closing it, or the arrow keys, so reading ten in a row costs
// ten taps rather than twenty. The side panel shows the map beside the list,
// so there the rows are compact and open the card until the panel takes the
// window.
//
// Only the nearest PAGE_SIZE rows are rendered (with "show more" paging) —
// mounting all ~2,600 rows was a large chunk of the mobile jank, and the
// near-me loop only ever needs the top of the list.

const PAGE_SIZE = 150;

// Row thumbnail: the listing's first guidebook plate, or a flat tile in the
// category colour when there is no picture (only ~14% of sites have one, and a
// ragged left edge down a reading list is worse than a plain swatch). A picture
// that fails to load falls back to the same tile rather than a broken-image box.
function RowThumb({ site }: { site: Site }) {
  const [broken, setBroken] = useState(false);
  const image = site.images?.[0];
  const tint = SITE_TYPE_COLORS[site.category];

  if (!image || broken) {
    return (
      <span
        className="row-thumb blank"
        style={{ background: tint }}
        aria-hidden="true"
      />
    );
  }
  return (
    <img
      className="row-thumb"
      src={`${import.meta.env.BASE_URL}${image.url}`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}

export function NearMeList({ inPlace }: { inPlace: boolean }) {
  const views = useVisibleSites();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const position = useStore((s) => s.position);
  const geoError = useStore((s) => s.geoError);
  const destination = useStore((s) => s.destination);
  const routeSort = useStore((s) => s.routeSort);
  const setRouteSort = useStore((s) => s.setRouteSort);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const setSelected = useStore((s) => s.setSelected);
  const sheet = useStore((s) => s.sheet);
  const setSheet = useStore((s) => s.setSheet);
  const sidePanel = useSidePanel();
  const lifted = useStore((s) => s.lifted);
  const setLifted = useStore((s) => s.setLifted);
  const dropLifted = useStore((s) => s.dropLifted);

  const routeMode = !!position && !!destination;
  const expandedRef = useRef<HTMLLIElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  // Set when the open row should be brought to the top of the list — see the
  // scroll effect below. `smoothScroll` marks a row the reader tapped open.
  const pendingScroll = useRef(false);
  const smoothScroll = useRef(false);
  // The selection the scroll effect last saw, so it can tell when something
  // outside the list — a "Part of" or "Nearby in this listing" link inside an
  // open write-up — has moved the selection to another row.
  const lastSelected = useRef(selectedSiteId);

  /** Open a site from the list. A row opened at the middle height raises the
   *  sheet to full, so the write-up has the room to be read (state/sheet.ts). */
  const openRow = (id: string) => {
    // PROTOTYPE: the site opens in the sheet at the height the list is at.
    if (siteInSheet && !sidePanel) {
      protoList.height = sheet;
      setSelected(id);
      return;
    }
    setSheet(rowSheet(sheet, sidePanel));
    setSelected(id);
  };

  /** Step to the site before or after the open one, in whatever order the list
   *  is currently in (distance, or travel order on a corridor). Stops at both
   *  ends rather than wrapping: the list is sorted, so wrapping from the
   *  furthest site back to the nearest would be a jump across Britain. */
  const goToNeighbour = useCallback(
    (delta: number) => {
      const index = views.findIndex((v) => v.site.id === selectedSiteId);
      if (index < 0) return;
      const next = index + delta;
      if (next < 0 || next >= views.length) return;
      pendingScroll.current = true;
      setSelected(views[next].site.id);
    },
    [views, selectedSiteId, setSelected],
  );

  // A sheet raised over the map with a site open shows that site's row. On a
  // phone the list mounts already in place, so this also covers a first open.
  // Declared before the scroll effect below, which it feeds.
  useEffect(() => {
    if (inPlace) pendingScroll.current = true;
  }, [inPlace]);

  // Bring the open site to the top of the list. When the reader was moved to it
  // — raising the sheet on a site picked from the map, or stepping to a
  // neighbour — it jumps there. When they tapped the row themselves it glides
  // there instead: a row tapped near the bottom of the screen would otherwise
  // open below the fold with no sign that anything happened, and the glide
  // shows where the write-up went. (Closing a row that sat above it can also
  // pull the tapped row out from under the finger, so staying put isn't an
  // option either.)
  //
  // The site can sit past the paging limit (a distant pin, or a long walk down
  // the list), so the limit is raised first and the effect runs again once the
  // row actually exists.
  //
  // A listing link inside the open write-up selects another site without going
  // through the list, and that row can be anywhere — above or below. It glides
  // there like a tapped row, or the reader is left looking at a closed entry
  // with no sign that anything opened.
  useEffect(() => {
    const changed = selectedSiteId !== lastSelected.current;
    lastSelected.current = selectedSiteId;
    if (inPlace && selectedSiteId && changed && !pendingScroll.current) {
      pendingScroll.current = true;
      smoothScroll.current = true;
    }
    if (!inPlace || !selectedSiteId || !pendingScroll.current) return;
    const index = views.findIndex((v) => v.site.id === selectedSiteId);
    if (index < 0) {
      pendingScroll.current = false; // filtered out — nothing to scroll to
      smoothScroll.current = false;
      return;
    }
    if (index >= limit) {
      setLimit(Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE);
      return;
    }
    // The list header is sticky in place, so the row lands under it
    // unless it is told to stop short. Measured, because the hint wraps to a
    // second line on a narrow phone.
    const row = expandedRef.current;
    if (row) {
      row.style.scrollMarginTop = `${headRef.current?.offsetHeight ?? 0}px`;
      const reduceMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      row.scrollIntoView({
        block: "start",
        behavior: smoothScroll.current && !reduceMotion ? "smooth" : "auto",
      });
    }
    pendingScroll.current = false;
    smoothScroll.current = false;
  }, [inPlace, selectedSiteId, limit, views]);

  // Keys (issue #88). `j` and `k` move the cursor down and up the list, and
  // the cursor lifts the row and its pin. `Enter` opens the row the cursor is
  // on. With a row open in place, `j`, `k` and the arrow keys do what the
  // prev/next bar does with a tap. The picture viewer is a modal key layer, so
  // none of this happens under it.
  useKeyLayer(true, KEY_RANK.list, ({ key }) => {
    const step = key === "j" || key === "ArrowRight" ? 1 : key === "k" || key === "ArrowLeft" ? -1 : 0;
    if (inPlace && selectedSiteId && step) {
      goToNeighbour(step);
      return true;
    }
    if (key === "j" || key === "k") {
      const next = stepCursor(
        views.map((v) => v.site.id),
        lifted?.id ?? selectedSiteId,
        step as 1 | -1,
      );
      if (!next) return false;
      setLifted({ id: next, by: "key" });
      return true;
    }
    // Enter opens the keyboard cursor's row, never a site the mouse happens to
    // rest on. And only a row the list shows: a lift can outlive the filter.
    if (
      key === "Enter" &&
      lifted?.by === "key" &&
      views.some((v) => v.site.id === lifted.id)
    ) {
      if (inPlace) {
        pendingScroll.current = true;
        smoothScroll.current = true;
      }
      openRow(lifted.id);
      return true;
    }
    return false;
  });

  // Keep the cursor row on screen. Only a key moves the view: a row lifted by
  // the mouse is already under it, and a pin lift must not scroll the list away
  // from what the reader is looking at. The rows are read through a ref, so a
  // GPS tick that re-sorts the list does not scroll it again.
  const viewsRef = useRef(views);
  viewsRef.current = views;
  useEffect(() => {
    if (lifted?.by !== "key") return;
    const index = viewsRef.current.findIndex((v) => v.site.id === lifted.id);
    if (index < 0) return;
    if (index >= limit) {
      setLimit(Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE);
      return;
    }
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-site-id="${CSS.escape(lifted.id)}"]`,
    );
    if (!row) return;
    row.style.scrollMarginTop = `${headRef.current?.offsetHeight ?? 0}px`;
    row.scrollIntoView({ block: "nearest" });
  }, [lifted, limit]);

  // A row lifts its pin under a mouse only. A touch has no hover, and the tap
  // that follows it opens the site anyway.
  const hoverProps = (id: string) => ({
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") setLifted({ id, by: "row" });
    },
    onPointerLeave: () => dropLifted(id),
  });

  return (
    <div className="list">
      <div className="list-head" ref={headRef}>
        {!position && (
          <p className="hint">
            {geoError ?? copy.near.locating} {copy.near.dropPin.before}{" "}
            <MapPinIcon /> {copy.near.dropPin.after}
          </p>
        )}
        {position && !destination && (
          <p className="hint">
            {copy.near.count(views.length, !!position.manual)}
          </p>
        )}
      </div>
      {routeMode && (
        <div className="route-head">
          <p className="hint">
            {copy.near.onTheWay(views.length, destination.label)}
          </p>
          {/* Travel order answers "what's next?"; least detour answers "what's
              cheapest?". Both are useful on the same corridor, so the sort is a
              toggle rather than a decision made for the user. */}
          <div className="mode-toggle route-sort">
            <button
              className={routeSort === "progress" ? "mode-opt on" : "mode-opt"}
              onClick={() => setRouteSort("progress")}
            >
              {copy.near.travelOrder}
            </button>
            <button
              className={routeSort === "detour" ? "mode-opt on" : "mode-opt"}
              onClick={() => setRouteSort("detour")}
            >
              {copy.near.leastDetour}
            </button>
          </div>
        </div>
      )}
      {routeMode && views.length === 0 && (
        <p className="hint">{copy.near.noneInBudget}</p>
      )}
      <ul ref={listRef}>
        {views.slice(0, limit).map((view, i) => {
          const { site, distance, detour, progress, visited, wishlisted } =
            view;
          const selected = site.id === selectedSiteId;
          const expanded = inPlace && selected;
          const liftedRow = lifted?.id === site.id;
          const trailing =
            detour !== null && progress !== null ? (
              <span className="row-dist row-route">
                <span className="row-detour">{formatDetour(detour)}</span>
                <span className="row-progress">
                  {formatProgress(progress)}
                </span>
              </span>
            ) : (
              <span className="row-dist">
                {distance !== null ? formatDistance(distance) : "—"}
              </span>
            );

          // Beside the map (the side panel): the row is the whole control and
          // selection opens the floating card.
          if (!inPlace) {
            return (
              <li
                key={site.id}
                data-site-id={site.id}
                className={`row ${selected ? "selected" : ""} ${visited ? "is-visited" : ""} ${liftedRow ? "lifted" : ""}`}
                onClick={() => setSelected(site.id)}
                {...hoverProps(site.id)}
              >
                <span
                  className="dot"
                  style={{ background: siteSwatch(site) }}
                  title={hybridTitle(site)}
                />
                <span className="row-main">
                  <span className="row-name">
                    {visited && <CheckIcon />}
                    {wishlisted && !visited && <StarIcon filled />}
                    {(visited || wishlisted) && " "}
                    {site.name}
                  </span>
                  <span className="row-sub">
                    {SITE_TYPE_LABELS[site.category]}
                    {site.county ? ` · ${site.county}` : ""}
                  </span>
                </span>
                {trailing}
              </li>
            );
          }

          // Neighbours come from the full list, not the rendered page, so the
          // last row on screen still steps forward (raising the limit as it
          // goes) instead of dead-ending at an arbitrary multiple of 150.
          const prev = expanded ? views[i - 1] : undefined;
          const next = expanded ? views[i + 1] : undefined;

          // In place: a real disclosure button, so the write-up opens under
          // the row and the reader keeps their place in the list.
          return (
            <li
              key={site.id}
              data-site-id={site.id}
              ref={expanded ? expandedRef : undefined}
              className={`row rich ${expanded ? "expanded" : ""} ${
                visited ? "is-visited" : ""
              } ${liftedRow ? "lifted" : ""}`}
              {...hoverProps(site.id)}
            >
              <button
                className="row-head"
                onClick={() => {
                  if (expanded) {
                    setSelected(null);
                    return;
                  }
                  pendingScroll.current = true;
                  smoothScroll.current = true;
                  openRow(site.id);
                }}
                aria-expanded={expanded}
              >
                <RowThumb site={site} />
                <span className="row-main">
                  <span className="row-name">
                    {visited && <CheckIcon />}
                    {wishlisted && !visited && <StarIcon filled />}
                    {(visited || wishlisted) && " "}
                    {site.name}
                  </span>
                  <span className="row-sub">
                    {SITE_TYPE_LABELS[site.category]}
                    {site.county ? ` · ${site.county}` : ""}
                  </span>
                  {!expanded && site.description && (
                    <span className="row-teaser">{site.description}</span>
                  )}
                </span>
                {trailing}
              </button>
              {expanded && (
                <div className="row-body">
                  {/* The row header above is already the site's header — name,
                    type and distance — so the body starts at the write-up. */}
                  <SiteBody
                    site={site}
                    showHeader={false}
                    collapseDescription={false}
                    onShowOnMap={() => setSheet(showOnMap(sidePanel))}
                  />
                  {/* Naming the neighbours turns the step into a decision
                    rather than a leap in the dark. The bar is sticky (see
                    .row-nav): it closes the entry, but on a write-up longer
                    than the screen it rides the bottom of the viewport, so
                    the step to the next site never costs a scroll past text
                    the reader has already given up on. */}
                  <div className="row-nav">
                    <button
                      className="row-nav-btn"
                      onClick={() => goToNeighbour(-1)}
                      disabled={!prev}
                      aria-label={
                        prev
                          ? copy.near.previousSite(prev.site.name)
                          : copy.near.noPrevious
                      }
                    >
                      <span className="row-nav-dir">{copy.near.previous}</span>
                      {prev && (
                        <span className="row-nav-name">{prev.site.name}</span>
                      )}
                    </button>
                    <button
                      className="row-nav-btn next"
                      onClick={() => goToNeighbour(1)}
                      disabled={!next}
                      aria-label={
                        next
                          ? copy.near.nextSite(next.site.name)
                          : copy.near.noNext
                      }
                    >
                      <span className="row-nav-dir">{copy.near.next}</span>
                      {next && (
                        <span className="row-nav-name">{next.site.name}</span>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {views.length > limit && (
        <p className="hint">
          <button
            className="link"
            onClick={() => setLimit((n) => n + PAGE_SIZE)}
          >
            {copy.near.showMore(Math.min(PAGE_SIZE, views.length - limit))}
          </button>{" "}
          {copy.near.remaining(views.length - limit, routeMode)}
        </p>
      )}
    </div>
  );
}
