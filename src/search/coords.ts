import { gridRefToLatLng } from '../geo/osgb';
import type { SearchResult } from './types';

// Typed-in coordinates (issue #28). Entirely local — this is the one search
// result that is identical online and off, and it is how you follow a grid
// reference out of a guidebook or a WhatsApp'd pin.

// "57.14, -2.10" / "57.14 -2.10" / "57.14N 2.10W". The hemisphere suffixes are
// optional; without them a bare negative means south/west as usual.
const DECIMAL =
  /^\s*(-?\d{1,3}(?:\.\d+)?)\s*(?:°)?\s*([NS])?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*(?:°)?\s*([EW])?\s*$/i;

// "57 08 53.4 N, 2 06 15.5 W" and the 57°08'53"N form.
const DMS =
  /^\s*(\d{1,3})[°\s:]+(\d{1,2})[''′\s:]+(\d{1,2}(?:\.\d+)?)["″\s]*([NS])\s*[,;\s]\s*(\d{1,3})[°\s:]+(\d{1,2})[''′\s:]+(\d{1,2}(?:\.\d+)?)["″\s]*([EW])\s*$/i;

function inRange(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function result(lat: number, lng: number, detail: string): SearchResult {
  return {
    id: `coords:${lat},${lng}`,
    kind: 'coords',
    label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    detail,
    lat,
    lng,
    source: 'local',
    // Coordinates are unambiguous — when someone pastes a pin they mean that
    // pin, so this outranks every fuzzy name match.
    score: 100,
  };
}

/**
 * Try to read the query as a literal location: decimal degrees, degrees /
 * minutes / seconds, or an OS grid reference. Returns null if it isn't one,
 * which is the overwhelmingly common case — so this runs first and cheaply.
 */
export function parseCoords(query: string): SearchResult | null {
  const decimal = DECIMAL.exec(query);
  if (decimal) {
    const [, latRaw, latHem, lngRaw, lngHem] = decimal;
    let lat = Number(latRaw);
    let lng = Number(lngRaw);
    if (latHem?.toUpperCase() === 'S') lat = -Math.abs(lat);
    if (lngHem?.toUpperCase() === 'W') lng = -Math.abs(lng);
    if (inRange(lat, lng)) return result(lat, lng, 'Coordinates');
  }

  const dms = DMS.exec(query);
  if (dms) {
    const [, latD, latM, latS, latHem, lngD, lngM, lngS, lngHem] = dms;
    let lat = Number(latD) + Number(latM) / 60 + Number(latS) / 3600;
    let lng = Number(lngD) + Number(lngM) / 60 + Number(lngS) / 3600;
    if (latHem.toUpperCase() === 'S') lat = -lat;
    if (lngHem.toUpperCase() === 'W') lng = -lng;
    if (inRange(lat, lng)) return result(lat, lng, 'Coordinates');
  }

  const grid = gridRefToLatLng(query);
  if (grid) {
    const out = result(grid.lat, grid.lng, `Grid ref ${query.toUpperCase().trim()}`);
    out.label = query.toUpperCase().replace(/\s+/g, ' ').trim();
    out.detail = `Grid reference · ${grid.lat.toFixed(4)}, ${grid.lng.toFixed(4)}`;
    return out;
  }

  return null;
}
