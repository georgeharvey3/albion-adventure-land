import { copy } from '../copy';

// Great-circle distance (spec §7.1). MVP ordering metric — "as the crow flies".
// Replaced by cached road travel time for routing decisions in Phase 2.

const R = 6371000; // Earth radius, metres

export interface LatLng {
  lat: number;
  lng: number;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distance in metres between two WGS84 points. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Human-friendly distance: "850 m" under 1 km, else "12.3 km". */
export function formatDistance(metres: number): string {
  if (metres < 1000) return copy.units.m(Math.round(metres));
  if (metres < 10000) return copy.units.km((metres / 1000).toFixed(1));
  return copy.units.km(Math.round(metres / 1000));
}
