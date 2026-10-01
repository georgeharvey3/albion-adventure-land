import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { LayerChips } from './LayerChips';
import { JourneyBar } from './JourneyBar';
import { ListFilterIcon, SearchIcon } from './icons';
import { KEY_RANK, onEscape } from '../state/keys';
import { useKeyLayer } from './useKeyLayer';
import { copy } from '../copy';

// The floating row (issue #109): a magnifier and the layer chips, at
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
// ON A PHONE THE ROW IS THE JOURNEY (issue #126). The chips are gone. The
// journey pill (JourneyBar.tsx) takes the row: "Search here" and a route
// button, and the journey itself once one is set. The layers moved behind one
// round button at the end of the row, which opens them as a list under it, so
// a layer is still one tap plus one tap away, with no tab to open. The side
// panel keeps the magnifier and the chips, and its journey bar in the panel.
//
// It sits in .map-area, so the full sheet covers it, and the title
// card covers it on a first visit.

export function PhoneFinder({ phone }: { phone: boolean }) {
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

  if (phone) {
    return (
      <div ref={ref} className="float-finder">
        <JourneyBar phone />
        <LayersButton />
      </div>
    );
  }

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

/** The phone's layers: one round button, and the layer chips as a list under
 *  it. A chip tap keeps the list open, so several layers can change in one
 *  visit. A tap outside, the button again, or Esc closes it. */
function LayersButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useKeyLayer(open, KEY_RANK.menu, onEscape(() => setOpen(false)));
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <div className="float-layers" ref={ref}>
      <button
        className={open ? 'float-search on' : 'float-search'}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={copy.map.siteLayers}
        title={copy.map.siteLayers}
      >
        <ListFilterIcon />
      </button>
      {open && <LayerChips className="layers-menu" />}
    </div>
  );
}
