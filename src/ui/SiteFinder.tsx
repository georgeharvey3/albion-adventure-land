import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { searchSites } from "../search/sites";
import { SITE_TYPE_COLORS, SITE_TYPE_LABELS, type Site } from "../data/types";
import { formatDistance, haversine } from "../geo/haversine";
import { CheckIcon, SearchIcon, StarIcon } from "./icons";

// The site finder. Answers ONE question — "which of my sites is that?" — by
// name, and hands the answer to the surface the user is already on.
//
// It is not the journey search (src/ui/SearchOverlay.tsx). That one fills an
// end of a journey and searches the world: places, postcodes, coordinates, grid
// references, and sites. This one never touches the journey; it selects a site.
// Both remain able to find a site by name, deliberately — a name typed into
// either box should find the thing it names.
//
// WHY IT LIVES IN THE NEARBY LIST. The finder's result IS a list row: picking
// one selects the site, and the selection is then read on the map as a card or
// in browse mode as the expanded row. Putting the control anywhere else would
// have made it a third search-shaped thing in the chrome; here it is the list's
// own control, next to Browse, costing nothing until it is opened.
//
// Name only, on purpose. The Filters tab is how you ask for a type and the
// journey search is how you ask for a place — a finder that also matched
// "stone circles" or "Cumbria" would be a second filter with different answers
// from the real one.

/**
 * How many name matches to carry into ranking. The pre-trim inside
 * `searchSites` sorts on the name score alone and cannot see distance, so it
 * would cut between two identically named sites arbitrarily — scan wide, then
 * let the tie-break below decide which ones survive to RESULT_LIMIT.
 */
const PRESCAN = 200;

/**
 * Rows shown. No paging: the ranking already puts the nearest of the equally
 * good matches on top, so row 26 is both further away and no better a name
 * match. Three more characters beats another page.
 */
const RESULT_LIMIT = 25;

export interface FinderResult {
  site: Site;
  distance: number | null;
  visited: boolean;
  wishlisted: boolean;
  /** The listing this site belongs under, when it is a subordinate point. */
  parentName?: string;
}

/**
 * Name matches, best first, ties broken by distance.
 *
 * The order of those two is the whole contract: you typed a name, so the name
 * wins; among sites the name fits equally well, the one you could reach today
 * is the one you meant. Blending distance INTO the score would let a near
 * weaker match outrank an exact one, which is the single failure a lookup by
 * name cannot have.
 */
export function useFinderResults(query: string): FinderResult[] {
  const sites = useStore((s) => s.sites);
  const hidden = useStore((s) => s.hidden);
  const visited = useStore((s) => s.visited);
  const wishlist = useStore((s) => s.wishlist);
  const position = useStore((s) => s.position);
  const lat = position?.lat;
  const lng = position?.lng;

  return useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const byId = new Map(sites.map((s) => [s.id, s]));
    const near = lat !== undefined && lng !== undefined ? { lat, lng } : null;

    const rows = searchSites(trimmed, sites, hidden, PRESCAN).flatMap((r) => {
      const site = r.siteId ? byId.get(r.siteId) : undefined;
      if (!site) return [];
      const parent = site.parentId ? byId.get(site.parentId) : undefined;
      return [
        {
          site,
          distance: near ? haversine(near, site) : null,
          visited: site.id in visited,
          wishlisted: wishlist.has(site.id),
          ...(parent ? { parentName: parent.name } : {}),
          score: r.score,
        },
      ];
    });

    rows.sort(
      (a, b) =>
        b.score - a.score ||
        (a.distance ?? Infinity) - (b.distance ?? Infinity),
    );
    return rows.slice(0, RESULT_LIMIT).map(({ score: _score, ...row }) => row);
  }, [query, sites, hidden, visited, wishlist, lat, lng]);
}

/** The magnifier that opens the field. Lives in the list's header row. */
export function SiteFinderToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={open ? "finder-toggle on" : "finder-toggle"}
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? "Close site search" : "Find a site"}
      title={open ? "Close site search" : "Find a site"}
    >
      <SearchIcon />
    </button>
  );
}

export function SiteFinderField({
  query,
  onQuery,
  onClose,
  onPickFirst,
}: {
  query: string;
  onQuery: (next: string) => void;
  onClose: () => void;
  onPickFirst: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="finder-field">
      <input
        ref={ref}
        type="search"
        value={query}
        placeholder="Find a site by name"
        aria-label="Find a site by name"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
          // Enter takes the top row — the common case is that you typed enough
          // of the name to have already won.
          if (e.key === "Enter") {
            e.preventDefault();
            onPickFirst();
          }
        }}
      />
      <button
        className="finder-close"
        onClick={onClose}
        aria-label="Close site search"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * The results, in place of the list. Rows carry the same marks as a list row —
 * type colour, visited tick, wishlist star, distance — because a result is the
 * row it is about to become, and "have I done this one?" is most often asked
 * of a site you are looking up by name.
 */
export function SiteFinderResults({
  results,
  onPick,
}: {
  results: FinderResult[];
  onPick: (site: Site) => void;
}) {
  if (!results.length) {
    return <p className="hint finder-empty">No site by that name.</p>;
  }
  return (
    <ul className="finder-results">
      {results.map(({ site, distance, visited, wishlisted, parentName }) => (
        <li
          key={site.id}
          className={visited ? "row is-visited" : "row"}
          onClick={() => onPick(site)}
        >
          <span
            className="dot"
            style={{ background: SITE_TYPE_COLORS[site.category] }}
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
              {/* A trailhead or a car park is a real site you might be looking
                  for, but it is not a destination in its own right — naming its
                  listing is what stops it reading as one. */}
              {parentName ? ` · under ${parentName}` : ""}
            </span>
          </span>
          <span className="row-dist">
            {distance !== null ? formatDistance(distance) : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Open/closed + query, with the "always starts closed and empty" rule in one
 *  place. Ephemeral like selection and browse: an abandoned search must not
 *  outlive the visit to the tab, let alone the session. */
export function useSiteFinder() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return {
    open,
    query,
    /** True while results are standing in for the list. */
    filtering: open && !!query.trim(),
    setQuery,
    close,
    toggle: () => (open ? close() : setOpen(true)),
  };
}
