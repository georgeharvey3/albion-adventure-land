import type L from 'leaflet';

// The neatline around the map (issue #73): the border of a printed sheet. Two
// rules frame the view, and the band between them is divided into alternate
// ink and paper bars, one bar per step of latitude down the sides and of
// longitude along the top and the bottom — the scale that every engraved map
// carries on its edge. The step shrinks as the reader zooms in, from ten
// degrees to one minute, and the top and left edges print the values.
//
// It is live, not decoration: the bars are where the degrees really fall, so
// the border moves with the map and says where on the globe this sheet is.

const OUTER = 3;
const INNER = 8;
/** The shortest bar worth drawing. Below this the band turns to noise. */
const MIN_BAR_PX = 44;
/** Keep printed values clear of the corners, where the controls sit. */
const CORNER_PX = 64;

// Steps in degrees, from coarse to fine; the finest are whole minutes.
const STEPS = [10, 5, 2, 1, 1 / 2, 1 / 4, 1 / 6, 1 / 12, 1 / 20, 1 / 30, 1 / 60];

function stepFor(pxPerDegree: number): number {
  let chosen = STEPS[0];
  for (const s of STEPS) if (s * pxPerDegree >= MIN_BAR_PX) chosen = s;
  return chosen;
}

function degrees(value: number, positive: string, negative: string): string {
  const total = Math.round(Math.abs(value) * 60);
  const d = Math.floor(total / 60);
  const m = total % 60;
  const hemi = total === 0 ? '' : value > 0 ? positive : negative;
  return `${d}°${m ? `${String(m).padStart(2, '0')}′` : ''}${hemi}`;
}

/** Boundaries of the bars along one edge: the value, and its pixel offset. */
function ticks(from: number, to: number, step: number, toPx: (v: number) => number) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const out: { value: number; px: number; odd: boolean }[] = [];
  for (let i = Math.ceil(lo / step); i * step <= hi; i++) {
    out.push({ value: i * step, px: toPx(i * step), odd: Math.abs(i) % 2 === 1 });
  }
  return out;
}

/** Alternate bars between the ticks, clipped to [0, length]. */
function bars(t: { px: number; odd: boolean }[], length: number, firstOdd: boolean): [number, number][] {
  const cuts = [0, ...t.map((k) => k.px).sort((a, b) => a - b), length];
  const filled: [number, number][] = [];
  // The bar before the first tick has the opposite parity of that tick's bar.
  let odd = firstOdd;
  for (let i = 0; i < cuts.length - 1; i++) {
    if (odd) filled.push([cuts[i], cuts[i + 1]]);
    odd = !odd;
  }
  return filled;
}

export function frameMarkup(map: L.Map): string {
  const { x: w, y: h } = map.getSize();
  if (!w || !h) return '';
  const nw = map.containerPointToLatLng([0, 0]);
  const se = map.containerPointToLatLng([w, h]);
  const midLng = (nw.lng + se.lng) / 2;

  const lngStep = stepFor(w / (se.lng - nw.lng));
  const latStep = stepFor(h / (nw.lat - se.lat));
  const x = (lng: number) => map.latLngToContainerPoint([nw.lat, lng]).x;
  const y = (lat: number) => map.latLngToContainerPoint([lat, midLng]).y;
  const across = ticks(nw.lng, se.lng, lngStep, x);
  const down = ticks(se.lat, nw.lat, latStep, y).sort((a, b) => a.px - b.px);

  // Whether the bar at the very start of an edge is filled: the opposite of
  // the bar that starts at the first tick.
  const acrossStart = across.length ? across[0].odd : Math.floor(nw.lng / lngStep) % 2 === 0;
  const downStart = down.length ? down[0].odd : Math.floor(nw.lat / latStep) % 2 === 0;
  const band = INNER - OUTER;
  const rects: string[] = [];
  for (const [a, b] of bars(across, w, acrossStart)) {
    rects.push(`<rect x="${a}" y="${OUTER}" width="${b - a}" height="${band}"/>`);
    rects.push(`<rect x="${a}" y="${h - INNER}" width="${b - a}" height="${band}"/>`);
  }
  for (const [a, b] of bars(down, h, downStart)) {
    rects.push(`<rect x="${OUTER}" y="${a}" width="${band}" height="${b - a}"/>`);
    rects.push(`<rect x="${w - INNER}" y="${a}" width="${band}" height="${b - a}"/>`);
  }

  // Print every value when the bars are wide, every other one when they are not.
  const labels: string[] = [];
  const every = (px: number) => (px >= MIN_BAR_PX * 2 ? 1 : 2);
  const acrossEvery = every(lngStep * (w / (se.lng - nw.lng)));
  across.forEach((t, i) => {
    if (t.px < CORNER_PX || t.px > w - CORNER_PX || i % acrossEvery) return;
    labels.push(
      `<text x="${t.px}" y="${INNER + 11}" text-anchor="middle">${degrees(t.value, 'E', 'W')}</text>`,
    );
  });
  const downEvery = every(latStep * (h / (nw.lat - se.lat)));
  down.forEach((t, i) => {
    if (t.px < CORNER_PX * 2 || t.px > h - CORNER_PX * 2 || i % downEvery) return;
    labels.push(
      `<text x="${INNER + 3}" y="${t.px}" dominant-baseline="middle">${degrees(t.value, 'N', 'S')}</text>`,
    );
  });

  return `<svg class="map-frame" width="${w}" height="${h}" aria-hidden="true">
<path class="map-frame-band" fill-rule="evenodd" d="M0 0H${w}V${h}H0Z M${INNER} ${INNER}V${h - INNER}H${w - INNER}V${INNER}Z"/>
<g class="map-frame-bars">${rects.join('')}</g>
<rect class="map-frame-rule" x="${OUTER}" y="${OUTER}" width="${w - 2 * OUTER}" height="${h - 2 * OUTER}"/>
<rect class="map-frame-rule" x="${INNER}" y="${INNER}" width="${w - 2 * INNER}" height="${h - 2 * INNER}"/>
<g class="map-frame-values">${labels.join('')}</g>
</svg>`;
}
