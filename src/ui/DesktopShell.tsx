import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  categoriesOf,
  parentOf,
  PARENT_CATEGORIES,
  PARENT_CATEGORY_COLORS,
  PARENT_CATEGORY_LABELS,
  SITE_TYPES,
  type ParentCategory,
  type Site,
  type SiteCategory,
} from '../data/types';
import { DRAWER_TABS, loadViewState, saveViewState, type DrawerTab } from '../state/viewState';
import { KEY_RANK, onEscape } from '../state/keys';
import { useKeyLayer } from './useKeyLayer';
import { JourneyBar } from './JourneyBar';
import { Filters } from './Filters';
import { Outing } from './Outing';
import { Stats } from './Stats';
import { SearchOverlay } from './SearchOverlay';
import { SiteFinderField, SiteFinderResults, useFinderResults } from './SiteFinder';
import { LogoMark } from './LogoMark';
import { Strip } from './Strip';
import { Spread } from './Spread';
import { NO_INSETS } from '../map/insets';
import { copy } from '../copy';

// The desktop shell (issue #89): from 1024 px, in place of the phone's sheet.
// The map fills the window. A card at the top left holds the brand, the site
// finder, the journey, the layer chips and the tab buttons, and each button
// opens its tab in a drawer under the card. The strip along the bottom is the
// desktop Nearby. The tab components are the phone's, with no change.
//
// The shell measures the parts of the map that it covers and puts them in the
// store as the covered insets (src/map/insets.ts). The fence, the strip's view
// and the floating controls all read that one value.

function useLayers(sites: Site[]) {
  return useMemo(() => {
    const leaves = new Map<ParentCategory, Set<SiteCategory>>();
    for (const site of sites) {
      for (const category of categoriesOf(site)) {
        const parent = parentOf(category);
        let set = leaves.get(parent);
        if (!set) leaves.set(parent, (set = new Set()));
        set.add(category);
      }
    }
    return PARENT_CATEGORIES.filter((p) => leaves.has(p)).map((parent) => ({
      parent,
      leaves: SITE_TYPES.filter((t) => leaves.get(parent)!.has(t)),
    }));
  }, [sites]);
}

/** One chip per layer: the quick form of the switch at the head of each layer
 *  in Filters. No counts. */
function LayerChips() {
  const sites = useStore((s) => s.sites);
  const activeTypes = useStore((s) => s.activeTypes);
  const setTypesActive = useStore((s) => s.setTypesActive);
  const layers = useLayers(sites);
  return (
    <div className="desk-chips">
      {layers.map(({ parent, leaves }) => {
        const on = leaves.filter((t) => activeTypes.has(t)).length;
        const allOn = on === leaves.length;
        return (
          <button
            key={parent}
            className={`chip ${allOn ? 'on' : on ? 'mixed' : 'off'}`}
            onClick={() => setTypesActive(leaves, !allOn)}
            aria-pressed={allOn}
            aria-label={copy.filters.show(PARENT_CATEGORY_LABELS[parent])}
          >
            <span className="dot" style={{ background: PARENT_CATEGORY_COLORS[parent] }} />
            {PARENT_CATEGORY_LABELS[parent]}
          </button>
        );
      })}
    </div>
  );
}

/** The narrowest window that shows the drawer and the spread together. */
const SPREAD_AND_DRAWER = 1200;

export function DesktopShell() {
  const searchTarget = useStore((s) => s.searchTarget);
  const tripCount = useStore((s) => s.outing?.stopIds.length ?? 0);
  const revealSite = useStore((s) => s.revealSite);
  const setSelected = useStore((s) => s.setSelected);
  const finderWanted = useStore((s) => s.finderWanted);
  const takeFinderRequest = useStore((s) => s.takeFinderRequest);
  const setCoveredInsets = useStore((s) => s.setCoveredInsets);
  const selectedSiteId = useStore((s) => s.selectedSiteId);

  const [drawer, setDrawer] = useState<DrawerTab | null>(() => loadViewState().drawer);
  useEffect(() => {
    saveViewState({ drawer });
  }, [drawer]);

  // The site finder is always in the card, and its results show in the drawer
  // (issue #87, Q11). The journey search shows there too, before either.
  const [query, setQuery] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const results = useFinderResults(query);
  const finding = !!query.trim();
  const drawerOpen = !!searchTarget || finding || drawer !== null;

  const pickFound = (site: Site) => {
    revealSite(site.id);
    setSelected(site.id);
    useStore.setState({ focus: { lat: site.lat, lng: site.lng, zoom: 13, nonce: Date.now() } });
    setQuery('');
  };

  // From 1024 px to 1199 px the drawer and the spread do not fit together, so
  // a spread closes the drawer (issue #87, Q5).
  // A drawer opened at that width closes the spread, and a window that
  // shrinks to it with both open closes the drawer.
  const narrow = () => window.innerWidth < SPREAD_AND_DRAWER;
  useEffect(() => {
    if (selectedSiteId && narrow()) setDrawer(null);
  }, [selectedSiteId]);
  useEffect(() => {
    if (!selectedSiteId || drawer === null) return;
    const onResize = () => {
      if (narrow()) setDrawer(null);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [selectedSiteId, drawer]);
  const openDrawer = (tab: DrawerTab | null) => {
    if (tab && selectedSiteId && narrow()) setSelected(null);
    setDrawer(tab);
  };

  // `/` asks for the finder (App.tsx). Here the finder is always mounted.
  useEffect(() => {
    if (!finderWanted) return;
    takeFinderRequest();
    setFocusRequest((n) => n + 1);
  }, [finderWanted, takeFinderRequest]);

  // Esc: the finder's results first, then the drawer. The site card and the
  // journey search sit above both (KEY_RANK).
  useKeyLayer(finding && !searchTarget, KEY_RANK.search, onEscape(() => setQuery('')));
  useKeyLayer(drawer !== null, KEY_RANK.sheet, onEscape(() => setDrawer(null)));

  // The covered insets. The strip covers the bottom, and the spread the right.
  // The card and the drawer cover the left as one column, but only while the
  // drawer is open: the card alone is a box in the corner, and the map shows
  // under it.
  const railRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLElement>(null);
  const spreadRef = useRef<HTMLElement>(null);
  const spreadOpen = !!selectedSiteId;
  useEffect(() => {
    const measure = () => {
      // The strip's top padding is a fade the map shows through, so the
      // covered band starts where its content does.
      const strip = stripRef.current;
      const stripTop = strip
        ? strip.getBoundingClientRect().top + parseFloat(getComputedStyle(strip).paddingTop)
        : window.innerHeight;
      const rail = railRef.current?.getBoundingClientRect();
      // offsetWidth, not the box: the spread slides in, and a transform moves
      // the box but not the band it covers once it lands.
      const spread = spreadRef.current;
      setCoveredInsets({
        top: 0,
        right: spread ? spread.offsetWidth : 0,
        bottom: Math.round(window.innerHeight - stripTop),
        left: drawerOpen && rail ? Math.round(rail.right) : 0,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (stripRef.current) ro.observe(stripRef.current);
    if (railRef.current) ro.observe(railRef.current);
    if (spreadRef.current) ro.observe(spreadRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [drawerOpen, spreadOpen, setCoveredInsets]);

  // Back to a phone: nothing is covered.
  useEffect(() => () => setCoveredInsets(NO_INSETS), [setCoveredInsets]);

  return (
    <>
      <div ref={railRef} className={drawerOpen ? 'desk-rail open' : 'desk-rail'}>
        <div className="desk-card">
          <div className="desk-brand">
            <LogoMark className="desk-logo" />
            <span className="desk-name">{copy.title.name}</span>
          </div>
          <SiteFinderField
            query={query}
            onQuery={setQuery}
            onClose={() => setQuery('')}
            onPickFirst={() => {
              const first = results[0];
              if (first) pickFound(first.site);
            }}
            focusRequest={focusRequest}
            focusOnMount={false}
          />
          <JourneyBar />
          <LayerChips />
          <nav className="desk-tabs">
            {DRAWER_TABS.map((id) => (
              <button
                key={id}
                className={drawer === id ? 'tab active' : 'tab'}
                onClick={() => openDrawer(drawer === id ? null : id)}
                aria-pressed={drawer === id}
              >
                {copy.app.tabs[id]}
                {id === 'outing' && tripCount > 0 && <span className="tab-badge">{tripCount}</span>}
              </button>
            ))}
          </nav>
        </div>
        {drawerOpen && (
          <div className={searchTarget ? 'desk-drawer bare' : 'desk-drawer'}>
            {searchTarget ? (
              <SearchOverlay />
            ) : finding ? (
              <SiteFinderResults results={results} onPick={pickFound} />
            ) : (
              <>
                {drawer === 'filters' && <Filters />}
                {drawer === 'outing' && <Outing />}
                {drawer === 'stats' && <Stats />}
              </>
            )}
          </div>
        )}
      </div>
      <Strip ref={stripRef} />
      <Spread ref={spreadRef} />
    </>
  );
}
