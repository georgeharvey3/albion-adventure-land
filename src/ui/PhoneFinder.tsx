import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { KEY_RANK, onEscape } from '../state/keys';
import type { Site } from '../data/types';
import { useKeyLayer } from './useKeyLayer';
import { LayerChips } from './LayerChips';
import { SiteFinderField, SiteFinderResults, useFinderResults } from './SiteFinder';

// The phone's floating finder (issue #109): a pill at the top of the map, and
// one row of layer chips under it. The desktop has both in its card, so on a
// phone they float over the map in the same way, and neither needs a tab.
//
// While a query is in, the results take the place of the chips. A pick
// selects the site and sends the map to it, as on the desktop. The Filters
// tab keeps the leaves and the tags; the chips are the quick form only.
//
// It sits in .map-area, so browse mode hides it with the map, and the title
// card covers it on a first visit.

export function PhoneFinder() {
  const revealSite = useStore((s) => s.revealSite);
  const setSelected = useStore((s) => s.setSelected);
  const finderWanted = useStore((s) => s.finderWanted);
  const takeFinderRequest = useStore((s) => s.takeFinderRequest);

  const [query, setQuery] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const results = useFinderResults(query);
  const finding = !!query.trim();

  // A closed finder gives the cursor back, so the keyboard on a phone folds.
  const close = () => {
    setQuery('');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const pickFound = (site: Site) => {
    revealSite(site.id);
    setSelected(site.id);
    useStore.setState({ focus: { lat: site.lat, lng: site.lng, zoom: 13, nonce: Date.now() } });
    close();
  };

  // `/` asks for the finder (App.tsx), which ends browse mode first so the
  // pill is on screen to take the cursor.
  useEffect(() => {
    if (!finderWanted) return;
    takeFinderRequest();
    setFocusRequest((n) => n + 1);
  }, [finderWanted, takeFinderRequest]);

  // The zoom and basemap controls sit under the pill and the chips. The map
  // area carries their height as --float-h, and the CSS moves the top right
  // corner down by it. Only the resting height counts: the results cover the
  // controls while they show, and the controls stay where they are.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const area = el?.parentElement;
    if (!el || !area || finding) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      // Browse mode hides the map area, and a hidden box measures nothing.
      if (!box.height) return;
      const h = Math.ceil(box.bottom - area.getBoundingClientRect().top);
      area.style.setProperty('--float-h', `${h}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [finding]);

  // Esc clears the results first. The site card sits above (KEY_RANK).
  useKeyLayer(finding, KEY_RANK.search, onEscape(close));

  return (
    <div ref={ref} className="float-finder">
      <SiteFinderField
        query={query}
        onQuery={setQuery}
        onClose={close}
        onPickFirst={() => {
          const first = results[0];
          if (first) pickFound(first.site);
        }}
        focusRequest={focusRequest}
        pill
      />
      {finding ? (
        <div className="float-results">
          <SiteFinderResults results={results} onPick={pickFound} />
        </div>
      ) : (
        <LayerChips className="float-chips" />
      )}
    </div>
  );
}
