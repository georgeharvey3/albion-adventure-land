import L from 'leaflet';
import plate from './plate.json';
import { fenceBox, type CoveredInsets } from './insets';

// The painted plate: the Stamen Watercolor tiles that ship with the app
// (`npm run plate`, scripts/build-plate.ts). They cover the box round every
// shown site, and the surround a big screen shows past it when zoomed out.
//
// The tiles are the app's own files, so the plate costs no quota and needs no
// key. The service worker keeps them, so the plate works with no signal.

/** The box round the pins. The map pans no further than this. */
export const PLATE_BOUNDS = L.latLngBounds([plate.south, plate.west], [plate.north, plate.east]);

/** The zooms the plate has tiles for. The map upscales the last one. */
export const PLATE_MIN_ZOOM = plate.minZoom;
export const PLATE_MAX_ZOOM = plate.maxZoom;

const RANGES: Record<string, number[]> = plate.tiles;

/** Whether the app ships this tile. A tile it does not ship is never asked for. */
export function plateHasTile({ x, y, z }: L.Coords): boolean {
  const range = RANGES[z];
  if (!range) return false;
  const [x0, x1, y0, y1] = range;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/**
 * The pan limit at a zoom: the plate, grown by the covered insets and widened
 * on any axis where the view is bigger (fenceBox, insets.ts). Leaflet's own
 * limit breaks there: a drag runs past the plate onto blank map and springs
 * back when it is let go.
 */
function limitAt(map: L.Map, zoom: number, insets: CoveredInsets): L.LatLngBounds {
  const box = fenceBox(
    {
      min: map.project(PLATE_BOUNDS.getNorthWest(), zoom),
      max: map.project(PLATE_BOUNDS.getSouthEast(), zoom),
    },
    map.getSize(),
    insets,
  );
  return L.latLngBounds(
    map.unproject(L.point(box.min.x, box.min.y), zoom),
    map.unproject(L.point(box.max.x, box.max.y), zoom),
  );
}

/**
 * Keep the part of the map that the user can see on the plate, at every zoom
 * and every screen size. `insets` reads the covered insets now. Call the
 * returned function when they change.
 */
export function fenceToPlate(map: L.Map, insets: () => CoveredInsets): () => void {
  // A zoom is limited before it lands, against the limit of the zoom it lands
  // on, so a zoom in near the edge never shows past the plate for a moment.
  // `_limitCenter` is Leaflet's, and the typings leave it out.
  const m = map as unknown as {
    _limitCenter(center: L.LatLng, zoom: number, bounds?: L.LatLngBounds): L.LatLng;
  };
  const leaflet = m._limitCenter.bind(map);
  m._limitCenter = (center, zoom, bounds) =>
    leaflet(center, zoom, bounds && limitAt(map, zoom, insets()));
  // A drag reads the limit when it starts, so the limit follows the zoom.
  // Leaflet pans the map back inside a new limit when one is set.
  const update = () => map.setMaxBounds(limitAt(map, map.getZoom(), insets()));
  map.on('zoomend resize', update);
  update();
  return update;
}
