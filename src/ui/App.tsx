import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { useGeolocation } from '../state/useGeolocation';
import { MapView } from '../map/MapView';
import { NearMeList } from './NearMeList';
import { Filters } from './Filters';
import { SiteDetail } from './SiteDetail';
import { Outing } from './Outing';
import { Stats } from './Stats';

type Tab = 'near' | 'filters' | 'outing' | 'stats';

const TABS: { id: Tab; label: string }[] = [
  { id: 'near', label: 'Near me' },
  { id: 'filters', label: 'Filters' },
  { id: 'outing', label: 'Outing' },
  { id: 'stats', label: 'Stats' },
];

export function App() {
  const init = useStore((s) => s.init);
  const dataLoaded = useStore((s) => s.dataLoaded);
  const dataError = useStore((s) => s.dataError);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const tripCount = useStore((s) => s.outing?.stopIds.length ?? 0);
  const [tab, setTab] = useState<Tab>('filters');
  const [collapsed, setCollapsed] = useState(false);

  // Tapping a tab while collapsed expands the sheet to that tab; tapping the
  // active tab toggles collapse. Keeps the map fully visible on small screens.
  const selectTab = (next: Tab) => {
    if (collapsed) {
      setCollapsed(false);
      setTab(next);
    } else if (next === tab) {
      setCollapsed(true);
    } else {
      setTab(next);
    }
  };

  useEffect(() => {
    void init();
  }, [init]);

  useGeolocation();

  return (
    <div className="app">
      {/* The card is positioned inside .map-area so it hugs the bottom of the
          map — i.e. it sits just above the sheet whether the sheet is expanded
          or collapsed, and never depends on viewport-height math. */}
      <div className="map-area">
        <MapView />
        {selectedSiteId && <SiteDetail />}
      </div>

      {!dataLoaded && <div className="overlay">Loading sites…</div>}
      {dataError && (
        <div className="overlay error">
          Couldn't load site data: {dataError}. Run <code>npm run ingest</code>.
        </div>
      )}

      <div className={collapsed ? 'sheet collapsed' : 'sheet'}>
        <nav className="tabs">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              className={!collapsed && tab === id ? 'tab active' : 'tab'}
              onClick={() => selectTab(id)}
            >
              {label}
              {id === 'outing' && tripCount > 0 && (
                <span className="tab-badge">{tripCount}</span>
              )}
            </button>
          ))}
          <button
            className="tab collapse-toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
            title={collapsed ? 'Expand panel' : 'Collapse panel'}
          >
            {collapsed ? '▲' : '▼'}
          </button>
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
    </div>
  );
}
