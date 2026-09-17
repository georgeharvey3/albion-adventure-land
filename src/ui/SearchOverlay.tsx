import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { loadCachedPlaces, type CachedPlace } from '../state/db';
import { loadGazetteer, type LoadedGazetteer } from '../search/places';
import { mergeOnline, searchLocal, searchOnline } from '../search/search';
import { parsePostcode } from '../search/postcode';
import { canonical, matchScore } from '../search/normalize';
import type { SearchResult } from '../search/types';
import { formatDistance } from '../geo/haversine';
import { FlagIcon, MapPinIcon } from './icons';

// The search overlay (issue #28). Opened from either end of the journey bar,
// and it fills THAT end — which is why there is no "start or destination?"
// question after picking a result.
//
// IT IS A PANEL OVER THE APP, NOT A SCREEN. It used to be full-height, and that
// was wrong: naming a place is one step of a journey you are already looking at,
// so taking the map and the other end away made it read as leaving the app. The
// panel now sits in the sheet's own footprint and is only as tall as its
// results, with a scrim carrying the modality the full screen used to.
//
// THE TWO-PASS RENDER IS THE POINT. Local results (the shipped dictionary, the
// app's own sites, coordinates, postcode districts) paint synchronously on every
// keystroke. Online results are merged in later, if they arrive at all. Nothing
// ever waits on the network, so the box behaves identically in a city and in a
// glen — there are just fewer rows in the glen.

const DEBOUNCE_MS = 200;

const SECTION_TITLES: Record<SearchResult['kind'], string> = {
  coords: 'Coordinates',
  postcode: 'Postcode',
  site: 'Sites',
  place: 'Places',
};

/**
 * Coordinates and postcodes always lead — typing one is an unambiguous
 * instruction, not a guess to be ranked. Sites and Places are then ordered by
 * their own best match, NOT by a fixed preference.
 *
 * That last part matters: with Sites permanently above Places, typing
 * "Ambleside" showed two wild-swim spots near Ambleside above the town of
 * Ambleside itself — the ranking was right and the grouping hid it. Ordering
 * the sections by their top row keeps the best answer visually first, which is
 * the one a thumb reaches for.
 */
const PINNED: SearchResult['kind'][] = ['coords', 'postcode'];

export function SearchOverlay() {
  const target = useStore((s) => s.searchTarget);
  const sites = useStore((s) => s.sites);
  const hidden = useStore((s) => s.hidden);
  const position = useStore((s) => s.position);
  const destination = useStore((s) => s.destination);
  const closeSearch = useStore((s) => s.closeSearch);
  const applySearchResult = useStore((s) => s.applySearchResult);
  const setPicking = useStore((s) => s.setPicking);
  const useMyLocation = useStore((s) => s.useMyLocation);

  const [query, setQuery] = useState('');
  const [gazetteer, setGazetteer] = useState<LoadedGazetteer | null>(null);
  const [cached, setCached] = useState<CachedPlace[]>([]);
  const [online, setOnline] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The anchor results are ranked around: where you already are, or — when
  // you're setting the start and have no position yet — where you're heading.
  const near = position ?? destination ?? null;

  // On every open: the dictionary (memoised below its API, so this is free
  // after the first time) and the cache of previously-resolved places. The
  // cache is deliberately re-read each time rather than once — searching a
  // place online writes it there, so reopening is how those become available
  // to the offline pass in the same session.
  useEffect(() => {
    if (!target) return;
    void loadGazetteer().then(setGazetteer);
    void loadCachedPlaces().then(setCached);
  }, [target]);

  useEffect(() => {
    if (target) inputRef.current?.focus();
    else {
      // Reset between openings: reopening on the destination end should not
      // show the results of the last origin search.
      setQuery('');
      setOnline([]);
      setSearching(false);
    }
  }, [target]);

  // Local results: synchronous, every keystroke, no network, no loading state.
  const local = useMemo(() => {
    if (!gazetteer) return [];
    return searchLocal({ query, sites, hidden, gazetteer, cached, near });
    // `near` is a fresh object each render when it comes from the store; depend
    // on its coordinates instead so typing doesn't re-run on every GPS tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sites, hidden, gazetteer, cached, near?.lat, near?.lng]);

  // Online results: debounced, abortable, and entirely optional.
  useEffect(() => {
    const trimmed = query.trim();
    if (!target || trimmed.length < 2) {
      setOnline([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      void searchOnline({ query: trimmed, near, signal: controller.signal })
        .then((results) => {
          if (!controller.signal.aborted) setOnline(results);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      // Abort in flight: a slow answer for "bal" must never land after "bala".
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, target, near?.lat, near?.lng]);

  // Merge the two passes. Local rows keep the scores and provenance they
  // already have; only the genuinely new online rows are ranked in.
  //
  // The online rows are filtered against the CURRENT query first. They lag by a
  // debounce plus a round trip, so without this, typing past a word leaves the
  // previous query's answers on screen — "Bala" sitting under a box reading
  // "balax". Filtering rather than clearing keeps rows that are still valid as
  // the query grows, so the list doesn't flicker on every keystroke.
  const results = useMemo(() => {
    const q = canonical(query);
    const stillMatching = q ? online.filter((r) => matchScore(q, canonical(r.label)) > 0) : [];
    return mergeOnline(local, stillMatching, near);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, online, query, near?.lat, near?.lng]);

  // The panel is pinned to the bottom of the LAYOUT viewport, which the phone
  // keyboard covers rather than shrinks. Publish how much of the screen the
  // keyboard is eating so the panel can sit on top of it; 0 when there is no
  // keyboard, and never set at all where the API is missing.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!target || !vv) return;
    const apply = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb-inset', `${Math.round(covered)}px`);
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      document.documentElement.style.removeProperty('--kb-inset');
    };
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, closeSearch]);

  if (!target) return null;

  const isOrigin = target === 'origin';
  const grouped = groupByKind(results);

  const typed = query.trim().length >= 2;

  // "Nothing found" is a poor answer when we know WHY. A postcode with no
  // outward-code table shipped can only be resolved online, and saying so beats
  // letting the user retype it — see scripts/build-gazetteer.ts, which warns
  // when it builds without that data.
  const looksLikePostcode = !!parsePostcode(query.trim());
  const emptyMessage =
    looksLikePostcode && !gazetteer?.outcodes.size
      ? 'Postcode lookup needs a signal in this build — try a town or place name instead.'
      : looksLikePostcode && !navigator.onLine
        ? 'That postcode isn’t in the offline set. Try its district (the first half) or a nearby town.'
        : navigator.onLine
          ? 'Nothing found.'
          : 'Nothing found — you’re offline, so only saved places are searchable.';

  return (
    <>
      {/* Tapping past the panel is "never mind" — the same thing the ✕ does. */}
      <div className="search-scrim" onClick={closeSearch} aria-hidden="true" />
      <div className="search-overlay" role="dialog" aria-modal="true" aria-label="Search for a place">
      <header className="search-head">
        <span className="search-for">
          {isOrigin ? <MapPinIcon /> : <FlagIcon />}
          {isOrigin ? 'Start from' : 'Travel to'}
        </span>
        <button className="search-close" onClick={closeSearch} aria-label="Close search">
          ✕
        </button>
      </header>

      <div className="search-field">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Town, site, postcode or grid ref"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-label={isOrigin ? 'Search for a place to start from' : 'Search for a destination'}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear">
            ✕
          </button>
        )}
      </div>

      {/* The alternatives that don't involve typing. Each existed before search
          did, and each is still the fastest route for its own case.

          "Pick on the map" is offered at BOTH ends. It was only on the
          destination end, which made the origin look like the lesser end — you
          could always drop an origin pin, but only through the map's own
          control, which a user in the search panel has no reason to look for.
          The gesture is the same one either way; only the end it fills
          differs. "Use my location" stays origin-only, because a destination
          where you already are is not a journey. */}
      <div className="search-shortcuts">
        {isOrigin && (
          <button
            onClick={() => {
              useMyLocation();
              closeSearch();
            }}
          >
            📍 Use my location
          </button>
        )}
        <button
          onClick={() => {
            setPicking(target);
            closeSearch();
          }}
        >
          🗺 Pick on the map
        </button>
      </div>

      <div className="search-results">

        {typed && !grouped.length && !searching && <p className="search-hint">{emptyMessage}</p>}

        {grouped.map(({ kind, rows }) => (
          <section key={kind}>
            <h3 className="search-section">{SECTION_TITLES[kind]}</h3>
            <ul className="search-list">
              {rows.map((r) => (
                <li key={r.id}>
                  <button className="search-result" onClick={() => applySearchResult(r)}>
                    <span className="search-result-main">
                      <span className="search-result-label">{r.label}</span>
                      {r.detail && <span className="search-result-detail">{r.detail}</span>}
                    </span>
                    <span className="search-result-meta">
                      {r.distance !== undefined && (
                        <span className="search-result-distance">{formatDistance(r.distance)}</span>
                      )}
                      {/* Only "cached" is worth a badge: it explains why a place
                          you once looked up online is still here with no signal. */}
                      {r.source === 'cached' && (
                        <span className="search-result-badge" title="Saved from an earlier search">
                          saved
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {typed && searching && <p className="search-status">Looking for more…</p>}
      </div>

      {gazetteer?.attribution && <p className="search-attribution">{gazetteer.attribution}</p>}
      </div>
    </>
  );
}

/**
 * Bucket ranked results by kind, keeping each bucket in ranked order and
 * ordering the buckets themselves by their best row (see PINNED above).
 */
function groupByKind(
  results: SearchResult[],
): { kind: SearchResult['kind']; rows: SearchResult[] }[] {
  const buckets = new Map<SearchResult['kind'], SearchResult[]>();
  for (const r of results) {
    const bucket = buckets.get(r.kind);
    if (bucket) bucket.push(r);
    else buckets.set(r.kind, [r]);
  }

  return [...buckets.entries()]
    .map(([kind, rows]) => ({ kind, rows }))
    .sort((a, b) => {
      const pinnedA = PINNED.indexOf(a.kind);
      const pinnedB = PINNED.indexOf(b.kind);
      if (pinnedA !== -1 || pinnedB !== -1) {
        // Both pinned: keep PINNED's own order. One pinned: it goes first.
        if (pinnedA !== -1 && pinnedB !== -1) return pinnedA - pinnedB;
        return pinnedA !== -1 ? -1 : 1;
      }
      // Results arrive ranked, so row 0 is each bucket's best.
      return b.rows[0].score - a.rows[0].score;
    });
}
