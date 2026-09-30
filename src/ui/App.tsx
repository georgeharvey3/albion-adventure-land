import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { useGeolocation } from '../state/useGeolocation';
import { MapView } from '../map/MapView';
import { NearMeList } from './NearMeList';
import { Filters } from './Filters';
import { SiteDetail } from './SiteDetail';
import { Outing } from './Outing';
import { Stats } from './Stats';
import { JourneyBar } from './JourneyBar';
import { SearchOverlay } from './SearchOverlay';
import { TitleCard } from './TitleCard';
import { loadViewState, saveViewState, type SheetTab } from '../state/viewState';
import { KEY_RANK, onEscape } from '../state/keys';
import { useKeyLayer } from './useKeyLayer';
import { copy } from '../copy';

const TABS: SheetTab[] = ['near', 'filters', 'outing', 'stats'];

export function App() {
  const init = useStore((s) => s.init);
  const dataLoaded = useStore((s) => s.dataLoaded);
  const dataError = useStore((s) => s.dataError);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const tripCount = useStore((s) => s.outing?.stopIds.length ?? 0);
  const destination = useStore((s) => s.destination);
  const browse = useStore((s) => s.browse);
  const setBrowse = useStore((s) => s.setBrowse);
  const setSelected = useStore((s) => s.setSelected);
  const requestFinder = useStore((s) => s.requestFinder);
  // Reopen on the tab that was open when the app was last closed.
  // A first visit opens on Nearby: "what is close to me now" is the question
  // the app exists to answer.
  const [tab, setTab] = useState<SheetTab>(() => loadViewState().tab ?? 'near');
  const [collapsed, setCollapsed] = useState(false);
  // Only until the first dismissal: after that, the reader knows the app.
  const [titleOpen, setTitleOpen] = useState(() => !loadViewState().titleSeen);

  // Tapping a tab while collapsed expands the sheet to that tab; tapping the
  // active tab toggles collapse. Keeps the map fully visible on small screens.
  //
  // Browse mode is a way of reading the near-me list, so it ends when the
  // reader leaves that tab — and while it is on there is no map to free, so
  // collapsing is a no-op rather than a way to end up with a blank screen.
  const selectTab = (next: SheetTab) => {
    if (collapsed) {
      setCollapsed(false);
      setTab(next);
    } else if (next === tab) {
      if (!browse) setCollapsed(true);
    } else {
      if (next !== 'near') setBrowse(false);
      setTab(next);
    }
  };

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    saveViewState({ tab });
  }, [tab]);

  // Setting a destination is a question ("what's on the way?"); the near-me
  // list is where it gets answered, so show it rather than leaving the answer
  // behind whichever tab happened to be open. Clearing it changes nothing —
  // the user goes back to what they were doing.
  useEffect(() => {
    if (!destination) return;
    setTab('near');
    setCollapsed(false);
  }, [destination]);

  useGeolocation();

  // Keys (issue #88). Esc closes one layer per press, top first — see
  // KEY_RANK. The site card is the selection: on the map it floats, and in
  // browse mode it is the row open in place.
  useKeyLayer(!!selectedSiteId, KEY_RANK.card, onEscape(() => setSelected(null)));
  // Last, the sheet: browse mode ends first, then the sheet folds down.
  useKeyLayer(
    browse || !collapsed,
    KEY_RANK.sheet,
    onEscape(() => (browse ? setBrowse(false) : setCollapsed(true))),
  );
  // `/` puts the cursor in the site finder, which lives in the Nearby tab.
  useKeyLayer(true, KEY_RANK.list, ({ key }) => {
    if (key !== '/') return false;
    setTab('near');
    setCollapsed(false);
    requestFinder();
    return true;
  });

  return (
    <div className="app">
      {/* The card is positioned inside .map-area so it hugs the bottom of the
          map — i.e. it sits just above the sheet whether the sheet is expanded
          or collapsed, and never depends on viewport-height math.

          In browse mode the whole area is hidden rather than unmounted: tearing
          the Leaflet map down would throw away the view the reader is coming
          back to and rebuild every marker on return. Its ResizeObserver picks
          the size back up. */}
      <div className={browse ? 'map-area hidden' : 'map-area'}>
        <MapView />
        {selectedSiteId && <SiteDetail />}
        {titleOpen && <TitleCard onClosed={() => setTitleOpen(false)} />}
      </div>

      {/* The title card says it for itself while it is up. */}
      {!dataLoaded && !titleOpen && <div className="overlay">{copy.app.loading}</div>}
      {dataError && (
        <div className="overlay error">
          {copy.app.loadFailed.before(dataError)} <code>{copy.app.loadFailed.command}</code>
          {copy.app.loadFailed.after}
        </div>
      )}

      <div className={`sheet ${collapsed ? 'collapsed' : ''} ${browse ? 'browse' : ''}`}>
        {/* Persistent, above the tabs and outside the collapse: the journey
            anchor governs every tab, so it must not disappear with the body. */}
        <JourneyBar />
        <nav className="tabs">
          {TABS.map((id) => (
            <button
              key={id}
              className={!collapsed && tab === id ? 'tab active' : 'tab'}
              onClick={() => selectTab(id)}
            >
              {copy.app.tabs[id]}
              {id === 'outing' && tripCount > 0 && (
                <span className="tab-badge">{tripCount}</span>
              )}
            </button>
          ))}
          {/* Nothing to collapse towards while the map is hidden. */}
          {!browse && (
            <button
              className="tab collapse-toggle"
              onClick={() => setCollapsed((c) => !c)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? copy.app.expand : copy.app.collapse}
              title={collapsed ? copy.app.expand : copy.app.collapse}
            >
              {collapsed ? '▲' : '▼'}
            </button>
          )}
        </nav>
        {!collapsed && (
          <div className="sheet-body">
            {tab === 'near' && <NearMeList />}
            {tab === 'filters' && <Filters />}
            {tab === 'outing' && <Outing />}
            {tab === 'stats' && <Stats />}
          </div>
        )}
      </div>

      {/* A panel over the sheet's own footprint, not a full screen: you are
          naming one end of a journey you can still see. */}
      <SearchOverlay />
    </div>
  );
}
