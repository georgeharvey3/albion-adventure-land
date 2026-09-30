import L from 'leaflet';
import { MapLabels } from './mapLabels';
import { PLATE_MAX_ZOOM, plateHasTile } from './plate';
import { copy } from '../copy';

// The three base layers the map can wear. Street is plain OpenStreetMap, the
// map every reader already knows how to read, with the lanes and the names
// that get you to a site and nothing drawn over them.
//
// Atlas is the default, and the one drawn for the app. It is two maps that
// hand over by zoom,
// the way a guidebook pairs a plate with a sheet map (issue #73):
//
// - At country scale, a hand-tinted plate: Stamen Watercolor, toned to the
//   almanac, with Esri relief pressed into it and the names lettered by the
//   app itself in Cardo (mapLabels.ts). This is where the story is told —
//   Britain as a book of wonders, not a road atlas.
// - From z12, Esri World Topo: an Ordnance Survey–based sheet with contours,
//   footpaths, soft relief and fell names in serif italic. This is where the
//   reader finds the stile. z11 is the crossing, both at once.
//
// A wash of the app's paper colour lies over both, so the map and the sheet
// under it read as one page. Satellite answers the other question a visiting
// companion gets asked — what does this place actually look like — is that
// "lake" a pond, where is the parking pull-in, how thick is the tree cover over
// the fall.
//
// Satellite is a *hybrid*: bare imagery loses every place name and every road,
// which is exactly what you need in a village or at a junction. So the imagery
// carries two transparent Esri reference layers on top — places and boundaries,
// then transportation — and "what is this" and "how do I get in" stay on the
// same screen.
//
// Every provider here is keyless raster tiles, which is what keeps the app
// backend-free and lets the service worker cache tiles by URL for offline use
// (see the runtimeCaching rules in vite.config.ts). Esri asks for attribution,
// which the layer carries. The watercolor plate is the app's own files. CARTO
// was the street map until it started to require a key (September 2026); a key
// in a client-only app is public, and Esri Topo is the better field map anyway.

// `street` keeps the id it had when it was the only street map, so a choice
// remembered from then still opens the same map.
export type BasemapId = 'street' | 'atlas' | 'satellite';

export const BASEMAP_IDS: BasemapId[] = ['street', 'atlas', 'satellite'];

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

interface TileSpec {
  url: string;
  maxZoom: number;
  /** Zoom past which the last real tile is upscaled rather than requested. */
  maxNativeZoom?: number;
  subdomains?: string;
  /** Class on the layer's container — how the CSS reaches a single layer. */
  className?: string;
  /** Zoom below which the layer draws nothing and requests nothing. */
  minZoom?: number;
  /** Opacity by zoom, for a layer that hands over to the one under it. */
  fade?: (zoom: number) => number;
  /** For a layer with a fixed set of tiles: whether a tile exists. */
  covers?: (coords: L.Coords) => boolean;
}

interface BasemapSpec extends TileSpec {
  attribution: string;
  /** Layers drawn over the base, in back-to-front order. */
  overlays?: (TileSpec | 'tint')[];
  /** Whether the app sets its own place names over it (mapLabels.ts). */
  names?: boolean;
}

// Imagery over rural Britain runs out around z19; keep zooming past it with
// upscaled tiles instead of dropping to a grey grid, because the pins stay
// useful even when the picture goes soft. The reference layers stop at the same
// zoom, so labels and imagery blur together rather than drifting apart.
const ESRI_MAX_ZOOM = 21;
const ESRI_MAX_NATIVE_ZOOM = 19;

// Stamen Watercolor for the country-scale view. It is the part of the map that
// tells the story: Britain as a hand-tinted plate in a book of wonders, not as
// a road atlas. It has no names at all, which is why it only owns the overview
// — mapLabels.ts sets the names in the app's own type — and why it hands over
// to the topo sheet as the reader zooms in to find the lane to a site.
//
// The tiles ship with the app (src/map/plate.ts, `npm run plate`), so the plate
// needs no provider, no key and no quota. They stop at z10; z11 is the z10
// tile upscaled, which the fade over the topo sheet hides.
const WATERCOLOR_LAST_ZOOM = 11;

function watercolor(): TileSpec {
  return {
    url: `${import.meta.env.BASE_URL}tiles/watercolor/{z}/{x}/{y}.jpg`,
    maxZoom: WATERCOLOR_LAST_ZOOM,
    maxNativeZoom: PLATE_MAX_ZOOM,
    covers: plateHasTile,
    className: 'tiles-watercolor',
    // Full strength to z10, under half at z11 over the topo sheet that is
    // loading beneath it, gone from z12. With the default whole-number zoom
    // steps, the crossing is one step and never a smear of both.
    fade: (z) => (z < WATERCOLOR_LAST_ZOOM ? 1 : z === WATERCOLOR_LAST_ZOOM ? 0.45 : 0),
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
    // OSM's own tiles have no @2x and stop at z19. Their usage policy asks for
    // the attribution below and for light use, which a visiting companion is.
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    subdomains: 'abc',
  },
  atlas: {
    ...esri('World_Topo_Map'),
    // Nothing is fetched from the topo sheet until the crossing.
    minZoom: WATERCOLOR_LAST_ZOOM,
    attribution:
      'Watercolor © Stamen Design, CC BY 3.0 · © OpenStreetMap contributors · Topo © Esri and its data providers · © GeoNames',
    // The topo sheet, the plate over it, the relief multiplied into the plate
    // so the uplands read in paint, and the paper wash over everything.
    overlays: [
      watercolor(),
      {
        ...esri('World_Shaded_Relief'),
        // The topo sheet carries its own relief, so this one belongs to the
        // plate alone and leaves with it.
        maxZoom: WATERCOLOR_LAST_ZOOM,
        maxNativeZoom: 13,
        className: 'tiles-relief',
      },
      'tint',
    ],
    names: true,
  },
  satellite: {
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
  return copy.map.basemaps[id];
}

function tileLayer(spec: TileSpec, attribution: string | undefined, zIndex: number): L.TileLayer {
  const options: L.TileLayerOptions = {
    attribution,
    maxZoom: spec.maxZoom,
    maxNativeZoom: spec.maxNativeZoom,
    // Never undefined. TileLayer takes `Math.max(minZoom, maxZoom)`, so an
    // undefined floor makes the ceiling NaN, and a layer with a NaN ceiling
    // draws at every zoom — the plate and its relief smeared over the topo.
    minZoom: spec.minZoom ?? 0,
    subdomains: spec.subdomains ?? 'abc',
    className: spec.className,
    // All tile layers share one pane, where DOM order decides what covers what.
    // An explicit z-index pins the stack instead of leaving it to the order the
    // layers happen to be added in.
    zIndex,
  };
  const layer = spec.fade
    ? new FadingTileLayer(spec.url, options, spec.fade)
    : L.tileLayer(spec.url, options);
  if (spec.covers) limitTiles(layer, spec.covers);
  return layer;
}

/**
 * Ask only for the tiles in a fixed set, so a missing one is never a 404.
 * Leaflet checks each tile with `_isValidTile` before it asks for it; the
 * typings leave that method out.
 */
function limitTiles(layer: L.TileLayer, covers: (coords: L.Coords) => boolean): void {
  const check = layer as unknown as { _isValidTile(coords: L.Coords): boolean };
  const leaflet = check._isValidTile.bind(layer);
  check._isValidTile = (coords) => covers(coords) && leaflet(coords);
}

/**
 * The whole basemap as one layer — base plus any transparent overlays — so a
 * caller adds and removes a basemap in a single call and can never leave half
 * of a hybrid on the map.
 */
export function createBasemap(id: BasemapId): L.LayerGroup {
  const spec = SPECS[id];
  const layers: L.Layer[] = [tileLayer(spec, spec.attribution, 1)];
  // The attribution belongs to the base. Repeating it per overlay would print
  // the same credit on every layer.
  spec.overlays?.forEach((o, i) => {
    if (o === 'tint') {
      layers.push(tintLayer(2 + i));
      return;
    }
    layers.push(tileLayer(o, undefined, 2 + i));
  });
  if (spec.names) layers.push(new MapLabels());
  return L.layerGroup(layers);
}

/**
 * A tile layer whose opacity follows the zoom, for a layer that hands the map
 * over to the one under it. The zoom steps are whole numbers, so the opacity
 * is set once per step, after the zoom lands.
 */
class FadingTileLayer extends L.TileLayer {
  constructor(
    url: string,
    options: L.TileLayerOptions,
    private readonly fade: (zoom: number) => number,
  ) {
    super(url, options);
  }

  private readonly follow = (e: L.LeafletEvent) =>
    this.setOpacity(this.fade((e.target as L.Map).getZoom()));

  onAdd(map: L.Map): this {
    super.onAdd(map);
    this.setOpacity(this.fade(map.getZoom()));
    map.on('zoomend', this.follow);
    return this;
  }

  onRemove(map: L.Map): this {
    map.off('zoomend', this.follow);
    return super.onRemove(map);
  }
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
  // Finished asynchronously and only while the layer is still on a map. A
  // tile returned without a `done` is finished by Leaflet on the next frame
  // with no such check, and a map torn down in between (React's dev-mode
  // double mount does exactly that) threw on every tile.
  protected createTile(_coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('div');
    requestAnimationFrame(() => {
      if (this._map) done(undefined, tile);
    });
    return tile;
  }
}

function tintLayer(zIndex: number): L.GridLayer {
  return new TintLayer({ className: 'tiles-tint', zIndex, maxZoom: 20 });
}
