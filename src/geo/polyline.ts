// Google's encoded-polyline decoder (issue #29). OSRM returns route geometry in
// this format; `polyline6` is the same algorithm with six decimal places of
// precision instead of five, which matters at the scale of a single road.
//
// Dependency-free on purpose — the published decoders are all thirty lines of
// bit-twiddling wrapped in a package, and the offline/bundle-size story is a
// feature (CLAUDE.md). This is the whole algorithm:
//
//   each coordinate is a DELTA from the previous one, times 10^precision,
//   rounded to an integer, zig-zag encoded (negatives interleaved with
//   positives), then split into 5-bit chunks, low chunk first, each chunk
//   offset by 63 and every chunk but the last flagged with bit 6.
//
// We only ever decode; nothing in the app encodes a polyline.

import type { LatLng } from './haversine';

/** Decode an encoded polyline. `precision` is 5 for `polyline`, 6 for
 *  `polyline6`. A malformed string yields the points decoded so far rather
 *  than throwing — a half-drawn route still beats an exception on a code path
 *  whose whole contract is "never break the app". */
export function decodePolyline(encoded: string, precision = 6): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    lat += nextDelta();
    if (index > encoded.length) break;
    lng += nextDelta();
    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;

  // One zig-zag-encoded varint, consuming as many characters as it needs.
  function nextDelta(): number {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    // Zig-zag: the low bit is the sign.
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}
