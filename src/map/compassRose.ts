import { copy } from '../copy';

// The compass rose in the map's bottom-left corner (issue #73). It is the app
// logo (public/favicon.svg) redrawn as a printed mark: the same four long
// needles, four short ones and the triskele at the heart, in one ink instead
// of the logo's gold on navy. Each long needle is split down its spine, one
// half solid and one half open, which is how an engraved rose shows light.
//
// Plain markup rather than a component because Leaflet controls are not React
// (see iconMarkup in ui/icons.tsx for the same reason). Colour comes from
// `currentColor` and the `.rose-paper` class, so the rose takes its tokens
// from index.css like every other mark.

const LONG_SOLID = 'M0 -28 L-4 -4 L0 0 Z';
const LONG_OPEN = 'M0 -28 L4 -4 L0 0 Z';
const SHORT = 'M0 -17 L-3 -3 L0 0 L3 -3 Z';

// The logo's spiral arm, in the logo's 512-unit space centred on 256,256.
const SPIRAL = 'M256 256 C256 206 318 186 336 226 C350 258 318 280 296 262 C284 252 292 236 304 240';

const turn = (deg: number, body: string) => `<g transform="rotate(${deg})">${body}</g>`;

export const COMPASS_ROSE = `<span class="compass-n">${copy.map.north}</span><svg viewBox="-32 -32 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="miter">
<circle r="30" stroke-width="0.75"/>
<circle r="25" stroke-width="0.75" stroke-dasharray="0.5 2.5"/>
${[45, 135, 225, 315].map((d) => turn(d, `<path class="rose-paper" d="${SHORT}"/>`)).join('')}
${[0, 90, 180, 270]
  .map((d) => turn(d, `<path class="rose-paper" d="${LONG_OPEN}"/><path fill="currentColor" d="${LONG_SOLID}"/>`))
  .join('')}
<circle class="rose-paper" r="10"/>
<g transform="scale(0.097) rotate(-72.3) translate(-256 -256)" stroke-width="13" stroke-linecap="round">
${[0, 120, 240].map((d) => `<path d="${SPIRAL}" transform="rotate(${d} 256 256)"/>`).join('')}
</g>
</svg>`;
