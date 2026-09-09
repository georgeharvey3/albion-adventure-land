// Remembered view state: where the map was, which tab was open, and which site
// was selected. Installed web apps are cold-started by iOS whenever they have
// been backgrounded for more than a few minutes, so without this, coming back
// to the app means pinching back in and finding your place again.
//
// This is view state, not user state. It lives in localStorage rather than
// IndexedDB (which holds the precious visited/wishlist data) for two reasons:
// losing it costs nothing, and it has to be readable synchronously while the
// map and the store initialise — an async read would paint the default view
// first and then jump.

const KEY = 'albion:view';

export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

export type SheetTab = 'near' | 'filters' | 'outing' | 'stats';

const TABS: SheetTab[] = ['near', 'filters', 'outing', 'stats'];

export interface ViewState {
  map: MapView | null;
  tab: SheetTab | null;
  selectedSiteId: string | null;
}

const EMPTY: ViewState = { map: null, tab: null, selectedSiteId: null };

function validMap(v: unknown): v is MapView {
  if (!v || typeof v !== 'object') return false;
  const { lat, lng, zoom } = v as Record<string, unknown>;
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180 &&
    typeof zoom === 'number' &&
    Number.isFinite(zoom) &&
    zoom >= 0 &&
    zoom <= 22
  );
}

// Parsed once and kept in memory: every save merges into the whole blob, and
// re-reading + re-parsing localStorage on each map pan would be wasteful.
let cache: ViewState | null = null;

export function loadViewState(): ViewState {
  if (cache) return cache;
  cache = EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      cache = {
        map: validMap(parsed.map) ? parsed.map : null,
        tab: TABS.includes(parsed.tab as SheetTab) ? (parsed.tab as SheetTab) : null,
        // The site id is only checked for shape here; whether it still exists
        // is settled once the site data has loaded (see the store's init).
        selectedSiteId: typeof parsed.selectedSiteId === 'string' ? parsed.selectedSiteId : null,
      };
    }
  } catch {
    // Private mode, disabled storage, or a corrupt blob: start from defaults.
    cache = EMPTY;
  }
  return cache;
}

export function saveViewState(patch: Partial<ViewState>): void {
  const next = { ...loadViewState(), ...patch };
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Non-fatal — the view just won't be restored next launch.
  }
}
