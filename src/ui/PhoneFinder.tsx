import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { LayerChips } from './LayerChips';
import { SearchIcon } from './icons';
import { copy } from '../copy';

// The phone's floating row (issue #109): a magnifier and the layer chips, at
// the top of the map. The desktop has both in its card, so on a phone they
// float over the map in the same way, and neither needs a tab.
//
// The chips get the room. A layer is switched on and off in the field all the
// time; a site is looked up by name rarely, because a visit starts from "what
// is near here", not from a name. So search is one round button, not a pill.
//
// The magnifier opens the search overlay for the map alone ('map'): places,
// postcodes, grid references and sites in one box, and a pick moves the map
// or opens the site. It fills no end of the journey.
//
// It sits in .map-area, so the full sheet covers it with the map, and the title
// card covers it on a first visit.

export function PhoneFinder() {
  const openSearch = useStore((s) => s.openSearch);

  // The zoom and basemap controls sit under the row. The map area carries its
  // height as --float-h, and the CSS moves the top right corner down by it.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const area = el?.parentElement;
    if (!el || !area) return;
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
  }, []);

  return (
    <div ref={ref} className="float-finder">
      <button
        className="float-search"
        onClick={() => openSearch('map')}
        aria-label={copy.search.open}
        title={copy.search.open}
      >
        <SearchIcon />
      </button>
      <LayerChips className="float-chips" />
    </div>
  );
}
