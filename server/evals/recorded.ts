// Recorded network responses for the eval (issue #62). Photon, postcodes.io
// and OSRM answer from a file, so an eval run depends only on the model and
// works offline.
//
// In record mode each call goes to the live service, and its answer is added
// to the file. In replay mode a call with no recording answers as if there
// were no signal, and the key goes on the `misses` list, so the report can say
// which recordings to add with `npm run eval -- --record`.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { LatLng } from '../../src/geo/haversine';
import { liveNet, type Net } from '../net';

type Recordings = Record<string, unknown>;

const key = {
  photon: (query: string) => `photon:${query.trim().toLowerCase()}`,
  postcode: (formatted: string) => `postcode:${formatted}`,
  route: (a: LatLng, b: LatLng) => `route:${a.lat.toFixed(3)},${a.lng.toFixed(3)};${b.lat.toFixed(3)},${b.lng.toFixed(3)}`,
};

export interface RecordedNet extends Net {
  misses: Set<string>;
  /** Write new recordings to the file. Record mode only. */
  save(): void;
}

export function recordedNet(path: string, mode: 'replay' | 'record'): RecordedNet {
  const recordings: Recordings = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Recordings) : {};
  const misses = new Set<string>();

  async function through<T>(k: string, live: () => Promise<T>, empty: T): Promise<T> {
    if (k in recordings) return recordings[k] as T;
    if (mode === 'replay') {
      misses.add(k);
      return empty;
    }
    const answer = await live();
    recordings[k] = answer;
    return answer;
  }

  return {
    misses,
    photon: (query, near) => through(key.photon(query), () => liveNet.photon(query, near), []),
    postcode: (parsed) => through(key.postcode(parsed.formatted), () => liveNet.postcode(parsed), null),
    route: (from, to) => through(key.route(from, to), () => liveNet.route(from, to), null),
    save() {
      const sorted = Object.fromEntries(Object.entries(recordings).sort(([a], [b]) => a.localeCompare(b)));
      writeFileSync(path, `${JSON.stringify(sorted, null, 1)}\n`);
    },
  };
}
