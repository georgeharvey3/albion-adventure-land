import type { LatLng } from './haversine';

// OS National Grid reference → WGS84 (issue #28).
//
// CLAUDE.md says to build this step only if a source actually needs it. Search
// is that source: British guidebooks, walk descriptions and rescue-post signs
// all give grid references, and typing "NN 166 712" into the destination box is
// a real thing a user of this app will do. The site CSVs still carry lat/lng
// and do NOT go through here — ingest is untouched.
//
// Hand-rolled and dependency-free, like the rest of src/geo. Two stages, both
// from the Ordnance Survey's "A guide to coordinate systems in Great Britain":
//
//   1. Inverse transverse Mercator: grid easting/northing → OSGB36 lat/lon on
//      the Airy 1830 ellipsoid.
//   2. Helmert transformation: OSGB36 → WGS84 (the datum Leaflet and the
//      geolocation API speak).
//
// The Helmert step is the approximate one — OS's own OSTN15 grid-shift file is
// centimetre-accurate where this is metre-accurate. Metres are far below the
// precision of "drive me to this valley", so the simple transform is right here.

// Airy 1830, the ellipsoid the National Grid is projected on.
const AIRY_A = 6377563.396;
const AIRY_B = 6356256.909;
// WGS84.
const WGS_A = 6378137.0;
const WGS_B = 6356752.314245;

// National Grid projection: scale factor, true origin, false origin offsets.
const F0 = 0.9996012717;
const LAT0 = (49 * Math.PI) / 180;
const LON0 = (-2 * Math.PI) / 180;
const E0 = 400000;
const N0 = -100000;

/**
 * Parse an OS grid reference into grid metres.
 *
 * Accepts the two-letter form with any even number of digits, spaced or not:
 * "NN1665471296", "NN 16654 71296", "nn 166 712", "SU12204220". Returns null
 * for anything else — including the six-figure-without-letters form, which is
 * ambiguous outside a known map sheet.
 */
export function parseGridRef(input: string): { easting: number; northing: number } | null {
  const text = input.toUpperCase().replace(/\s+/g, '');
  const match = /^([A-HJ-Z]{2})(\d+)$/.exec(text);
  if (!match) return null;

  const [, letters, digits] = match;
  if (digits.length % 2 !== 0 || digits.length > 10) return null;

  // The 100 km squares: a 5×5 lettered grid (I omitted), with the first letter
  // picking a 500 km square and the second a 100 km square inside it. The
  // arithmetic below is the standard decoding of that scheme, relative to the
  // grid's false origin south-west of the Scilly Isles.
  const l1 = letterIndex(letters[0]);
  const l2 = letterIndex(letters[1]);
  if (l1 < 0 || l2 < 0) return null;

  const e100k = ((l1 - 2) % 5) * 5 + (l2 % 5);
  const n100k = 19 - Math.floor(l1 / 5) * 5 - Math.floor(l2 / 5);
  if (e100k < 0 || e100k > 6 || n100k < 0 || n100k > 12) return null;

  // Pad the digits out to metres: "166" means 16600, not 166.
  const half = digits.length / 2;
  const pad = (s: string) => Number(s.padEnd(5, '0'));

  return {
    easting: e100k * 100000 + pad(digits.slice(0, half)),
    northing: n100k * 100000 + pad(digits.slice(half)),
  };
}

/** Index into the I-less alphabet the grid squares use. */
function letterIndex(ch: string): number {
  const code = ch.charCodeAt(0) - 65; // 'A'
  if (code < 0 || code > 25 || ch === 'I') return -1;
  return code > 8 ? code - 1 : code; // skip I
}

/** Grid easting/northing → OSGB36 latitude/longitude, in radians. */
function gridToAiry(easting: number, northing: number): { lat: number; lon: number } {
  const a = AIRY_A;
  const b = AIRY_B;
  const e2 = (a * a - b * b) / (a * a);
  const n = (a - b) / (a + b);
  const n2 = n * n;
  const n3 = n * n * n;

  // Iterate northing → footpoint latitude. Converges in a handful of passes at
  // National Grid extents; the loop cap is belt and braces.
  let lat = LAT0;
  let M = 0;
  for (let i = 0; i < 20; i++) {
    lat = (northing - N0 - M) / (a * F0) + lat;

    const dLat = lat - LAT0;
    const sLat = lat + LAT0;
    const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * dLat;
    const Mb = (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(dLat) * Math.cos(sLat);
    const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * dLat) * Math.cos(2 * sLat);
    const Md = (35 / 24) * n3 * Math.sin(3 * dLat) * Math.cos(3 * sLat);
    M = b * F0 * (Ma - Mb + Mc - Md);

    if (Math.abs(northing - N0 - M) < 0.00001) break;
  }

  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;

  const tanLat = Math.tan(lat);
  const t2 = tanLat * tanLat;
  const t4 = t2 * t2;
  const t6 = t4 * t2;
  const secLat = 1 / cosLat;

  const VII = tanLat / (2 * rho * nu);
  const VIII = (tanLat / (24 * rho * nu ** 3)) * (5 + 3 * t2 + eta2 - 9 * t2 * eta2);
  const IX = (tanLat / (720 * rho * nu ** 5)) * (61 + 90 * t2 + 45 * t4);
  const X = secLat / nu;
  const XI = (secLat / (6 * nu ** 3)) * (nu / rho + 2 * t2);
  const XII = (secLat / (120 * nu ** 5)) * (5 + 28 * t2 + 24 * t4);
  const XIIA = (secLat / (5040 * nu ** 7)) * (61 + 662 * t2 + 1320 * t4 + 720 * t6);

  const dE = easting - E0;
  const dE2 = dE * dE;

  return {
    lat: lat - VII * dE2 + VIII * dE2 * dE2 - IX * dE2 * dE2 * dE2,
    lon: LON0 + X * dE - XI * dE * dE2 + XII * dE * dE2 * dE2 - XIIA * dE * dE2 * dE2 * dE2,
  };
}

// Helmert transformation OSGB36 → WGS84. These are the OS-published WGS84 →
// OSGB36 parameters with every sign flipped, which is the standard way to run
// the transform backwards at this accuracy.
const TX = 446.448;
const TY = -125.157;
const TZ = 542.06;
const SCALE = -20.4894e-6;
const RX = degToRad(0.1502 / 3600);
const RY = degToRad(0.247 / 3600);
const RZ = degToRad(0.8421 / 3600);

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Airy 1830 lat/lon (radians) → WGS84 lat/lng (degrees), via geocentric XYZ. */
function airyToWgs84(lat: number, lon: number): LatLng {
  const e2Airy = (AIRY_A * AIRY_A - AIRY_B * AIRY_B) / (AIRY_A * AIRY_A);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const nu = AIRY_A / Math.sqrt(1 - e2Airy * sinLat * sinLat);

  // Cartesian on the source ellipsoid (height 0 — we have no elevation, and a
  // few hundred metres of it moves the result by centimetres).
  const x1 = nu * cosLat * Math.cos(lon);
  const y1 = nu * cosLat * Math.sin(lon);
  const z1 = nu * (1 - e2Airy) * sinLat;

  // Seven-parameter Helmert.
  const s1 = 1 + SCALE;
  const x2 = TX + x1 * s1 - y1 * RZ + z1 * RY;
  const y2 = TY + x1 * RZ + y1 * s1 - z1 * RX;
  const z2 = TZ - x1 * RY + y1 * RX + z1 * s1;

  // Cartesian back to WGS84 geodetic, iterating on latitude.
  const e2Wgs = (WGS_A * WGS_A - WGS_B * WGS_B) / (WGS_A * WGS_A);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let outLat = Math.atan2(z2, p * (1 - e2Wgs));
  for (let i = 0; i < 20; i++) {
    const sin = Math.sin(outLat);
    const nu2 = WGS_A / Math.sqrt(1 - e2Wgs * sin * sin);
    const next = Math.atan2(z2 + e2Wgs * nu2 * sin, p);
    if (Math.abs(next - outLat) < 1e-12) {
      outLat = next;
      break;
    }
    outLat = next;
  }

  return {
    lat: (outLat * 180) / Math.PI,
    lng: (Math.atan2(y2, x2) * 180) / Math.PI,
  };
}

/**
 * Convert an OS grid reference to WGS84. Returns null if it doesn't parse or
 * lands outside the National Grid's extent.
 */
export function gridRefToLatLng(input: string): LatLng | null {
  const grid = parseGridRef(input);
  if (!grid) return null;
  const { lat, lon } = gridToAiry(grid.easting, grid.northing);
  const point = airyToWgs84(lat, lon);
  // Sanity box around Britain and Ireland: a grid square that decodes to the
  // mid-Atlantic means the reference was nonsense, not that the maths failed.
  if (point.lat < 49 || point.lat > 61.5 || point.lng < -9 || point.lng > 2.5) return null;
  return point;
}
