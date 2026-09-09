// Remembered map viewport (issue: reopening the iOS home-screen PWA dropped the
// user back to the zoomed-out default). Installed web apps are cold-started by
// iOS whenever they are backgrounded for more than a few minutes, so the map has
// to restore its own centre/zoom on boot or the field loop starts with a pinch.
//
// This is view state, not user state: it lives in localStorage rather than
// IndexedDB so the map can read it synchronously during init (an async read
// would show the default view first and then jump), and losing it costs nothing.

const KEY = 'albion:map-view';

export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

function valid(v: unknown): v is MapView {
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

export function loadMapView(): MapView | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : null;
  } catch {
    // Private mode / disabled storage: fall back to the default view.
    return null;
  }
}

export function saveMapView(view: MapView): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    // Non-fatal — the map just won't be restored next launch.
  }
}
