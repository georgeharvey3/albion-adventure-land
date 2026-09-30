import { useEffect, useMemo, useRef } from "react";
import { useStore } from "../state/store";
import { searchSites } from "../search/sites";
import {
  hybridTitle,
  siteSwatch,
  SITE_TYPE_LABELS,
  type Site,
} from "../data/types";
import { formatDistance, haversine } from "../geo/haversine";
import { CheckIcon, StarIcon } from "./icons";
import { copy } from "../copy";

// The site finder. Answers ONE question — "which of my sites is that?" — by
// name, and hands the answer to the surface the user is already on.
//
// It is not the journey search (src/ui/SearchOverlay.tsx). That one fills an
// end of a journey and searches the world: places, postcodes, coordinates, grid
// references, and sites. This one never touches the journey; it selects a site.
// Both remain able to find a site by name, deliberately — a name typed into
// either box should find the thing it names.
//
// WHERE IT LIVES. On a desktop only, in the card at the top left. The results
// show in the drawer, and a pick selects the site and sends the map to it. A
// phone has no room for a second box: its magnifier (src/ui/PhoneFinder.tsx,
// issue #109) opens the journey search for the map alone, which finds sites
// by name too.
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

/**
 * Take a site from the finder. `revealSite` first: a site
 * the filters exclude has no pin, so selecting it before revealing it would
 * open a card for nothing on the map. The map then flies to the site, and
 * `done` resets the finder: after a pick, the answer is what the user wants
 * to look at, not the search that found it.
 */
export function useFinderPick(done: () => void): (site: Site) => void {
  const revealSite = useStore((s) => s.revealSite);
  const setSelected = useStore((s) => s.setSelected);
  return (site) => {
    revealSite(site.id);
    setSelected(site.id);
    useStore.setState({
      focus: { lat: site.lat, lng: site.lng, zoom: 13, nonce: Date.now() },
    });
    done();
  };
}

export function SiteFinderField({
  query,
  onQuery,
  onClose,
  onPickFirst,
  focusRequest,
}: {
  query: string;
  onQuery: (next: string) => void;
  onClose: () => void;
  onPickFirst: () => void;
  /** A change puts the cursor back in the field (the `/` key, issue #88). */
  focusRequest: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // The field is always there, so the cursor waits for `/`.
  const firstRequest = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest !== firstRequest.current) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  return (
    <div className="finder-field">
      <input
        ref={ref}
        type="search"
        value={query}
        placeholder={copy.finder.field}
        aria-label={copy.finder.field}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          // Esc belongs to the key layer of the shell, so it closes the
          // finder only when nothing sits above it. Enter takes the top row —
          // the common case is that you typed enough of the name to have
          // already won.
          if (e.key === "Enter") {
            e.preventDefault();
            onPickFirst();
          }
        }}
      />
      <button
        className="finder-close"
        onClick={onClose}
        aria-label={copy.finder.close}
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
    return <p className="hint finder-empty">{copy.finder.none}</p>;
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
              {/* A trailhead or a car park is a real site you might be looking
                  for, but it is not a destination in its own right — naming its
                  listing is what stops it reading as one. */}
              {parentName ? copy.finder.under(parentName) : ""}
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
