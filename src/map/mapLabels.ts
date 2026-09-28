import L from 'leaflet';
import { loadGazetteer, type Place } from '../search/places';

// The names on the overview map (issue #73). The watercolor plate that the
// Atlas layer shows at country scale carries no names at all, so the app sets
// them itself, in its own type, the way an engraved map is lettered: seas and
// national parks in spaced italic capitals across the water and the land,
// cities in roman capitals, towns in roman with a small ring, peaks with a
// triangle. The names come from the shipped gazetteer (public/data/places.json),
// so they are there with no signal, like the rest of the overview.
//
// From z11 the topo sheet fades in with its own names, and these stand down:
// the lanes and the villages are its job, and two sets of names would fight.

type LabelKind = 'sea' | 'water' | 'area' | 'peak' | 'mark' | 'city' | 'town';

interface MapLabel {
  /** A `\n` breaks a sea name over two lines, as an engraver would. */
  name: string;
  lat: number;
  lng: number;
  kind: LabelKind;
  minZoom: number;
  maxZoom: number;
  /** Placement order: lower goes first and wins a collision. */
  rank: number;
  population: number;
}

// Seas, firths and bays. Hand-placed, because a water name sits in the middle
// of the water, which no gazetteer point marks. Zooms are chosen so that each
// name appears when its water fills a fair part of a phone screen.
const WATERS: [string, number, number, number, number][] = [
  ['Atlantic\nOcean', 54.5, -16, 4, 7],
  ['North\nSea', 55.8, 2.6, 4, 8],
  ['Irish\nSea', 53.9, -5.1, 5, 8],
  ['English Channel', 50.15, -2.2, 5, 8],
  ['Celtic Sea', 50.9, -7.4, 6, 8],
  ['Sea of the\nHebrides', 56.95, -7.1, 7, 9],
  ['The Minch', 58.05, -5.95, 7, 10],
  ['St George’s\nChannel', 52.05, -5.75, 7, 9],
  ['Bristol Channel', 51.33, -3.95, 8, 10],
  ['Cardigan\nBay', 52.4, -4.45, 8, 10],
  ['Liverpool Bay', 53.52, -3.45, 9, 10],
  ['Morecambe\nBay', 54.1, -2.98, 9, 10],
  ['Solway Firth', 54.85, -3.55, 9, 10],
  ['Firth of Clyde', 55.55, -5.02, 9, 10],
  ['Firth of Forth', 56.1, -2.9, 9, 10],
  ['Moray Firth', 57.72, -3.75, 8, 10],
  ['Pentland Firth', 58.72, -3.1, 9, 10],
  ['The Wash', 52.93, 0.28, 8, 10],
  ['Thames Estuary', 51.52, 0.85, 9, 10],
  ['Lyme Bay', 50.6, -3.0, 8, 10],
  ['Strait of Dover', 51.0, 1.45, 8, 10],
];

// The gazetteer's landmarks are all one kind; the map sets each sort
// differently. Anything not named here is an area — a national park, a glen,
// an island — and is lettered across the land.
const PEAKS = new Set([
  'Ben Nevis',
  'Yr Wyddfa',
  'Scafell Pike',
  'Helvellyn',
  'Ben Macdui',
  'Cadair Idris',
  'Pen y Fan',
]);
const MARKS = new Set([
  'Stonehenge',
  'Hadrian’s Wall',
  'Giant’s Causeway',
  'Cheddar Gorge',
  'Land’s End',
  'John o’ Groats',
]);
const INLAND_WATERS = new Set(['Loch Ness']);

// The last zoom at which the app letters the map. The topo sheet starts at the
// next one (see WATERCOLOR_LAST_ZOOM in basemaps.ts) and names the parks, the
// fells and the towns itself.
const SETTLEMENT_LAST_ZOOM = 10;
const LANDSCAPE_LAST_ZOOM = 10;

function fromPlace(p: Place): MapLabel | null {
  const base = { name: p.name, lat: p.lat, lng: p.lng, population: p.population };
  if (p.kind === 'landmark') {
    if (PEAKS.has(p.name)) return { ...base, kind: 'peak', minZoom: 9, maxZoom: LANDSCAPE_LAST_ZOOM, rank: 3 };
    if (MARKS.has(p.name)) return { ...base, kind: 'mark', minZoom: 9, maxZoom: LANDSCAPE_LAST_ZOOM, rank: 4 };
    if (INLAND_WATERS.has(p.name)) return { ...base, kind: 'water', minZoom: 8, maxZoom: LANDSCAPE_LAST_ZOOM, rank: 2 };
    return { ...base, kind: 'area', minZoom: 7, maxZoom: LANDSCAPE_LAST_ZOOM, rank: 2 };
  }
  // Villages have no population in the gazetteer and belong to Positron's zooms.
  if (p.kind === 'village') return null;
  const pop = p.population;
  const minZoom = pop >= 300_000 ? 5 : pop >= 100_000 ? 7 : pop >= 40_000 ? 8 : pop >= 10_000 ? 9 : 10;
  const city = pop >= 100_000;
  return { ...base, kind: city ? 'city' : 'town', minZoom, maxZoom: SETTLEMENT_LAST_ZOOM, rank: city ? 1 : 5 };
}

const WATER_LABELS: MapLabel[] = WATERS.map(([name, lat, lng, minZoom, maxZoom]) => ({
  name,
  lat,
  lng,
  kind: 'sea',
  minZoom,
  maxZoom,
  rank: 0,
  population: 0,
}));

// Rough box sizes for the collision pass, in px per character at the sizes in
// index.css (.map-label--*). Measuring the real text would force a layout for
// every candidate on every move; an estimate a little on the generous side
// keeps names apart just as well.
const METRICS: Record<LabelKind, { size: number; perChar: number; centred: boolean }> = {
  sea: { size: 16, perChar: 16 * 0.9, centred: true },
  water: { size: 14, perChar: 14 * 0.62, centred: true },
  area: { size: 13, perChar: 13 * 0.95, centred: true },
  city: { size: 15, perChar: 15 * 0.82, centred: false },
  town: { size: 14, perChar: 14 * 0.5, centred: false },
  peak: { size: 14, perChar: 14 * 0.5, centred: false },
  mark: { size: 14, perChar: 14 * 0.5, centred: false },
};

// Point labels hang off a mark at their anchor: the text starts this far right.
const MARK_OFFSET = 9;
const GAP = 6;
/** Keep names clear of the map's edge: a name cut by the edge reads as a mistake. */
const EDGE = 12;

type Box = [number, number, number, number];

function overlaps(a: Box, b: Box): boolean {
  return a[0] < b[2] + GAP && b[0] < a[2] + GAP && a[1] < b[3] + GAP && b[1] < a[3] + GAP;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class MapLabels extends L.Layer {
  private container: HTMLElement | null = null;
  private labels: MapLabel[] = WATER_LABELS;
  /** The names on the map now, with their spans, so a pinch can move them. */
  private placed: { el: HTMLElement; lat: number; lng: number }[] = [];

  onAdd(map: L.Map): this {
    // Above the tiles (200) and under the paper finish (250), so the grain
    // prints over the names as it does over the land; far under the pins.
    const pane = map.getPane('labelPane') ?? map.createPane('labelPane');
    pane.style.zIndex = '230';
    pane.style.pointerEvents = 'none';
    // leaflet-zoom-hide: the names vanish while a zoom animates and are set
    // afresh when it lands, instead of sliding off their places.
    this.container = L.DomUtil.create('div', 'map-labels leaflet-zoom-hide', pane);
    map.on('moveend resize', this.draw, this);
    map.on('zoom', this.follow, this);
    loadGazetteer().then((g) => {
      const places = g.places.map(fromPlace).filter((l): l is MapLabel => l !== null);
      this.labels = [...WATER_LABELS, ...places].sort(
        (a, b) => a.rank - b.rank || b.population - a.population,
      );
      this.draw();
    });
    this.draw();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off('moveend resize', this.draw, this);
    map.off('zoom', this.follow, this);
    this.container?.remove();
    this.container = null;
    this.placed = [];
    return this;
  }

  // A pinch zooms without a `zoomanim`: one `zoom` event per frame, and each
  // one moves the pixel origin, so a name left at its old layer point floats
  // off its place until the fingers lift. Pin every name to its place through
  // the gesture, at its own size. Only the names already set are moved — which
  // names fit is decided again on `moveend`, as before. An animated zoom hides
  // the names instead (leaflet-zoom-hide), so this has nothing to do then.
  private follow(): void {
    const map = this._map;
    if (!map || (map as L.Map & { _animatingZoom?: boolean })._animatingZoom) return;
    for (const { el, lat, lng } of this.placed) {
      const { x, y } = map.latLngToLayerPoint([lat, lng]);
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
    }
  }

  private draw(): void {
    const map = this._map;
    if (!map || !this.container) return;
    const zoom = map.getZoom();
    const bounds = map.getBounds().pad(0.15);
    const size = map.getSize();
    // Layer points place the names; container points decide whether one fits.
    const origin = map.containerPointToLayerPoint([0, 0]);
    const inside = (b: Box) =>
      b[0] - origin.x >= EDGE &&
      b[1] - origin.y >= EDGE &&
      b[2] - origin.x <= size.x - EDGE &&
      b[3] - origin.y <= size.y - EDGE;
    const taken: Box[] = [];
    const html: string[] = [];
    const kept: MapLabel[] = [];

    for (const label of this.labels) {
      if (zoom < label.minZoom || zoom > label.maxZoom) continue;
      if (!bounds.contains([label.lat, label.lng])) continue;
      const m = METRICS[label.kind];
      const lines = label.name.split('\n');
      const width = Math.max(...lines.map((l) => l.length)) * m.perChar;
      const height = lines.length * m.size * 1.25;
      const { x, y } = map.latLngToLayerPoint([label.lat, label.lng]);
      const box: Box = m.centred
        ? [x - width / 2, y - height / 2, x + width / 2, y + height / 2]
        : [x - 4, y - height / 2, x + MARK_OFFSET + width, y + height / 2];
      if (!inside(box) || taken.some((t) => overlaps(t, box))) continue;
      taken.push(box);
      kept.push(label);
      html.push(
        `<span class="map-label map-label--${label.kind}" style="left:${Math.round(x)}px;top:${Math.round(y)}px">${lines
          .map(escape)
          .join('<br>')}</span>`,
      );
    }
    this.container.innerHTML = html.join('');
    const spans = this.container.children;
    this.placed = kept.map((l, i) => ({ el: spans[i] as HTMLElement, lat: l.lat, lng: l.lng }));
  }
}
