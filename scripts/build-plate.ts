import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Site } from '../src/data/types.ts';
import { isShown } from '../src/data/shown.ts';

// Builds the painted plate: the Stamen Watercolor tiles for the pin area,
// downloaded once and shipped with the app (src/map/plate.ts).
//
// The tiles come from the Cooper Hewitt archive. Stamen painted them, the
// museum holds them as a collection object, and it offers them for use in
// independent projects. They are CC BY 3.0; the map data under them is
// OpenStreetMap, CC BY-SA. The archive is frozen, so a tile never changes.
//
// The plate is the box round every site the app shows, with a margin. The map
// never pans past it. Zoomed out on a big screen, the view is wider than the
// plate, so the tiles also cover a surround: every tile that a VIEW-sized
// screen can show while the plate is centred in it. Like
// the gazetteer, the OUTPUT IS COMMITTED and `npm run build` does NOT run this:
// the plate changes only when a new source moves the edge of the pins.
//
//   npm run plate
//
// The script is resumable: a tile already on disk is not downloaded again.
// Tiles that the new plate no longer covers are deleted.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITES = resolve(root, 'public/data/sites.json');
const TILES_DIR = resolve(root, 'public/tiles/watercolor');
const PLATE_FILE = resolve(root, 'src/map/plate.json');

const ARCHIVE = 'https://watercolormaps.collection.cooperhewitt.org/tile/watercolor';

/** How far the plate reaches past the outermost pins. */
const MARGIN_KM = 80;

// z5 shows the whole plate on a phone. z10 is the last zoom the plate owns;
// the map upscales it at z11, where it fades over the topo sheet.
const MIN_ZOOM = 5;
const MAX_ZOOM = 10;

// The biggest screen the surround is sized for: a 4K display. A bigger screen
// shows the map's background colour past the surround at the lowest zooms.
const VIEW = { x: 3840, y: 2400 };

// This is somebody else's server, and a museum's at that.
const CONCURRENCY = 3;
const PAUSE_MS = 100;

interface Box {
  south: number;
  west: number;
  north: number;
  east: number;
}

function pinBox(sites: readonly Site[]): Box {
  const box = { south: 90, west: 180, north: -90, east: -180 };
  for (const { lat, lng } of sites) {
    box.south = Math.min(box.south, lat);
    box.north = Math.max(box.north, lat);
    box.west = Math.min(box.west, lng);
    box.east = Math.max(box.east, lng);
  }
  const dLat = MARGIN_KM / 111.32;
  // A degree of longitude is shortest at the edge nearest the pole.
  const dLng = dLat / Math.cos((box.north * Math.PI) / 180);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    south: round(box.south - dLat),
    west: round(box.west - dLng),
    north: round(box.north + dLat),
    east: round(box.east + dLng),
  };
}

/** A point's position in world pixels at zoom z (Web Mercator, 256 px tiles). */
function pixel(lat: number, lng: number, z: number): [number, number] {
  const size = 256 * 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * size, ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * size];
}

/** Inclusive tile range [x0, x1, y0, y1] at each zoom: the plate and its surround. */
type Ranges = Record<number, [number, number, number, number]>;

function rangesFor(box: Box): Ranges {
  const out: Ranges = {};
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    const [left, top] = pixel(box.north, box.west, z);
    const [right, bottom] = pixel(box.south, box.east, z);
    // Where the plate is narrower than the view, the view centres it, and the
    // surround is what shows either side.
    const padX = Math.max(0, (VIEW.x - (right - left)) / 2);
    const padY = Math.max(0, (VIEW.y - (bottom - top)) / 2);
    const last = 2 ** z - 1;
    const tile = (v: number) => Math.min(last, Math.max(0, Math.floor(v / 256)));
    out[z] = [tile(left - padX), tile(right + padX), tile(top - padY), tile(bottom + padY)];
  }
  return out;
}

function tilesFor(ranges: Ranges): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const [z, [x0, x1, y0, y1]] of Object.entries(ranges)) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([Number(z), x, y]);
  }
  return out;
}

const pathOf = ([z, x, y]: [number, number, number]) => resolve(TILES_DIR, `${z}/${x}/${y}.jpg`);

async function download(tile: [number, number, number]): Promise<void> {
  const [z, x, y] = tile;
  const url = `${ARCHIVE}/${z}/${x}/${y}.jpg`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(pathOf(tile)), { recursive: true });
      writeFileSync(pathOf(tile), bytes);
      return;
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url}: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/** Delete tiles the plate no longer covers, and the folders they leave empty. */
function prune(keep: Set<string>): number {
  if (!existsSync(TILES_DIR)) return 0;
  let removed = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        if (readdirSync(path).length === 0) rmSync(path, { recursive: true });
      } else if (!keep.has(path)) {
        rmSync(path);
        removed++;
      }
    }
  };
  walk(TILES_DIR);
  return removed;
}

async function main() {
  const sites = (JSON.parse(readFileSync(SITES, 'utf8')) as Site[]).filter(isShown);
  const box = pinBox(sites);
  const ranges = rangesFor(box);
  const tiles = tilesFor(ranges);
  console.log(`Plate: ${JSON.stringify(box)} from ${sites.length} sites, ${tiles.length} tiles z${MIN_ZOOM}–z${MAX_ZOOM}`);

  const removed = prune(new Set(tiles.map(pathOf)));
  if (removed) console.log(`Removed ${removed} tiles outside the plate`);

  const todo = tiles.filter((t) => !existsSync(pathOf(t)));
  console.log(`${tiles.length - todo.length} on disk, ${todo.length} to download`);
  let done = 0;
  const failed: string[] = [];
  const worker = async () => {
    for (let tile = todo.shift(); tile; tile = todo.shift()) {
      try {
        await download(tile);
      } catch (err) {
        failed.push((err as Error).message);
      }
      done++;
      if (done % 100 === 0) console.log(`  ${done} downloaded`);
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (failed.length) {
    // The plate file is not written, so the app keeps the last whole plate.
    console.error(`${failed.length} tiles failed. Run again to retry them:`);
    for (const f of failed.slice(0, 10)) console.error(`  ${f}`);
    process.exit(1);
  }
  writeFileSync(
    PLATE_FILE,
    JSON.stringify({ ...box, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, tiles: ranges }, null, 2) + '\n',
  );
  console.log(`Wrote ${PLATE_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
