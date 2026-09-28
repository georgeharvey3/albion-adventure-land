import L from 'leaflet';

// The two base layers the map can wear. Street is the default: it carries the
// paths, lanes and place names that get you to a site. It is also most of the
// first screen a visitor sees, so it is drawn to match the almanac rather than
// borrowed as-is: a quiet CARTO Positron base, Esri shaded relief pressed into
// it, a wash of the app's paper colour, and Positron's labels on top. The hills
// that the sites sit on (tors, hillforts, scrambles) read at a glance, and the
// map and the sheet under it look like one page. Satellite answers the
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
  /** Class on the layer's container — how the CSS reaches a single layer. */
  className?: string;
}

interface BasemapSpec extends TileSpec {
  label: string;
  attribution: string;
  /** Layers drawn over the base, in back-to-front order. */
  overlays?: (TileSpec | 'tint')[];
}

// Imagery over rural Britain runs out around z19; keep zooming past it with
// upscaled tiles instead of dropping to a grey grid, because the pins stay
// useful even when the picture goes soft. The reference layers stop at the same
// zoom, so labels and imagery blur together rather than drifting apart.
const ESRI_MAX_ZOOM = 21;
const ESRI_MAX_NATIVE_ZOOM = 19;

// CARTO's Positron, split into its land and label halves so the relief and the
// tint can go between them. `{r}` asks for the @2x tiles on a high-density
// screen: this is the first screen a visitor sees, and blurry type is the
// quickest way to look unfinished.
function carto(style: string): TileSpec {
  return {
    url: `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`,
    maxZoom: 20,
    subdomains: 'abcd',
  };
}

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
    ...carto('light_nolabels'),
    attribution: '© OpenStreetMap contributors © CARTO · Relief © Esri',
    // Relief under the tint, so its shadows take the paper's hue; labels over
    // it, so the type keeps its full contrast.
    overlays: [
      {
        ...esri('World_Shaded_Relief'),
        // Esri draws this service only to z13. Upscaled a few levels it is a
        // soft wash that still says "hill"; past z16 it is a blur that fights
        // the lanes, so the layer bows out and the base carries on alone.
        maxZoom: 16,
        maxNativeZoom: 13,
        className: 'tiles-relief',
      },
      'tint',
      carto('light_only_labels'),
    ],
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
    className: spec.className,
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
  const layers: L.GridLayer[] = [tileLayer(spec, spec.attribution, 1)];
  // The attribution belongs to the base. Repeating it per overlay would print
  // the same credit on every layer.
  spec.overlays?.forEach((o, i) =>
    layers.push(o === 'tint' ? tintLayer(2 + i) : tileLayer(o, undefined, 2 + i)),
  );
  return L.layerGroup(layers);
}

/**
 * A flat wash of `--map-tint`, multiplied into the layers under it. Positron's
 * land is a near-white that sits slightly warm next to the app's cool paper,
 * and a CSS filter cannot move a grey towards green without shifting it
 * brown first. Multiplying by one colour can: the tint is the paper divided by
 * Positron's land, so land comes out exactly as the paper (see tokens.css).
 * The tiles are empty divs, so the wash costs no request and works offline.
 */
class TintLayer extends L.GridLayer {
  protected createTile(): HTMLElement {
    return document.createElement('div');
  }
}

function tintLayer(zIndex: number): L.GridLayer {
  return new TintLayer({ className: 'tiles-tint', zIndex, maxZoom: 20 });
}
