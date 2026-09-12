import L from 'leaflet';

// The two base layers the map can wear. Street is the default: it carries the
// paths, lanes and place names that get you to a site. Satellite answers the
// other question a visiting companion gets asked — what does this place
// actually look like — is that "lake" a pond, where is the parking pull-in,
// how thick is the tree cover over the fall.
//
// Satellite is a *hybrid*: bare imagery loses every place name and every road,
// which is exactly what you need in a village or at a junction. So the imagery
// carries two transparent Esri reference layers on top — places and boundaries,
// then transportation — and "what is this" and "how do I get in" stay on the
// same screen.
//
// Every provider here is keyless raster tiles, which is what keeps the app
// backend-free and lets the service worker cache tiles by URL for offline use
// (see the runtimeCaching rules in vite.config.ts). Esri World Imagery is the
// keyless imagery source that fits: it asks for attribution, which the layer
// carries. Mapbox, Google and Bing all want a key, and a key wants a server to
// hide it behind — see the no-backend rule in CLAUDE.md.

export type BasemapId = 'street' | 'satellite';

export const BASEMAP_IDS: BasemapId[] = ['street', 'satellite'];

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

interface TileSpec {
  url: string;
  maxZoom: number;
  /** Zoom past which the last real tile is upscaled rather than requested. */
  maxNativeZoom?: number;
  subdomains?: string;
}

interface BasemapSpec extends TileSpec {
  label: string;
  attribution: string;
  /** Transparent layers drawn over the base, in back-to-front order. */
  overlays?: TileSpec[];
}

// Imagery over rural Britain runs out around z19; keep zooming past it with
// upscaled tiles instead of dropping to a grey grid, because the pins stay
// useful even when the picture goes soft. The reference layers stop at the same
// zoom, so labels and imagery blur together rather than drifting apart.
const ESRI_MAX_ZOOM = 21;
const ESRI_MAX_NATIVE_ZOOM = 19;

// Note the {y}/{x} order on every ArcGIS URL — those tiles are row-then-column,
// the reverse of the XYZ convention. Swapping them silently serves the wrong
// part of the world rather than a 404, so it is easy to miss.
function esri(service: string): TileSpec {
  return {
    url: `${ESRI}/${service}/MapServer/tile/{z}/{y}/{x}`,
    maxZoom: ESRI_MAX_ZOOM,
    maxNativeZoom: ESRI_MAX_NATIVE_ZOOM,
  };
}

const SPECS: Record<BasemapId, BasemapSpec> = {
  street: {
    label: 'Street',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    subdomains: 'abc',
  },
  satellite: {
    label: 'Satellite',
    ...esri('World_Imagery'),
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    // Places before transportation: the road casings should draw over the label
    // halos, not under them, which is the order Esri designs the pair in.
    overlays: [
      esri('Reference/World_Boundaries_and_Places'),
      esri('Reference/World_Transportation'),
    ],
  },
};

export function basemapLabel(id: BasemapId): string {
  return SPECS[id].label;
}

function tileLayer(spec: TileSpec, attribution: string | undefined, zIndex: number): L.TileLayer {
  return L.tileLayer(spec.url, {
    attribution,
    maxZoom: spec.maxZoom,
    maxNativeZoom: spec.maxNativeZoom,
    subdomains: spec.subdomains ?? 'abc',
    // All tile layers share one pane, where DOM order decides what covers what.
    // An explicit z-index pins the stack instead of leaving it to the order the
    // layers happen to be added in.
    zIndex,
  });
}

/**
 * The whole basemap as one layer — base plus any transparent overlays — so a
 * caller adds and removes a basemap in a single call and can never leave half
 * of a hybrid on the map.
 */
export function createBasemap(id: BasemapId): L.LayerGroup {
  const spec = SPECS[id];
  const layers = [tileLayer(spec, spec.attribution, 1)];
  // The attribution belongs to the imagery. Repeating it per reference layer
  // would print the same Esri credit three times.
  spec.overlays?.forEach((o, i) => layers.push(tileLayer(o, undefined, 2 + i)));
  return L.layerGroup(layers);
}
