import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { IOS_SCREENS, splashFile } from './ios-screens.ts';

// Brand-mark generator: the single source of truth for the app icon.
//
// iOS will not use an SVG for a home-screen icon — without a real PNG
// `apple-touch-icon` it renders a blank tile or a screenshot of the page. So we
// need rasterised icons, but a raster toolchain (sharp/canvas/ImageMagick) is a
// heavy native dependency for five flat shapes, and the offline/bundle-size
// story is a feature (see CLAUDE.md). So this is hand-rolled and dependency-free
// in the same spirit as the geometry code: a tiny supersampling rasteriser plus
// a minimal PNG writer over the zlib in Node's stdlib.
//
// The emblem is declared once as `EMBLEM` and emitted as BOTH the PNGs and
// `public/favicon.svg`, so the vector and raster marks cannot drift apart.
//
// Output is committed (like `public/data/sites.json`), so the app build stays
// fast and needs no image tooling. Re-run `npm run icons` after editing EMBLEM.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = resolve(root, 'public/icons');
const SPLASH_DIR = resolve(ICON_DIR, 'splash');

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

/** Icon background gradient. Averages to the app's --accent (#1f6b4f). */
const BG_TOP = '#26775a';
const BG_BOTTOM = '#17513b';

const STONE = '#f7f5f0'; // matches --bg
const MOON = '#f4d35e';

type Shape =
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string; alpha?: number }
  | {
      kind: 'rrect';
      x: number;
      y: number;
      w: number;
      h: number;
      r: number;
      fill: string;
      alpha?: number;
      /** Degrees clockwise about the rect's own centre. */
      rot?: number;
    };

/**
 * A standing stone flanked by two smaller stones on a ground line, under a full
 * moon — drawn in a 512x512 design space. Deliberately five bold shapes with no
 * thin strokes: a home-screen icon renders at ~120px and hairlines vanish there.
 * The stones are tilted and unequal on purpose; upright equal pills read as a
 * bar chart rather than as menhirs.
 */
const EMBLEM: Shape[] = [
  { kind: 'circle', cx: 256, cy: 168, r: 50, fill: MOON },
  { kind: 'rrect', x: 112, y: 400, w: 288, h: 26, r: 13, fill: STONE, alpha: 0.34 },
  { kind: 'rrect', x: 132, y: 296, w: 56, h: 112, r: 18, rot: -8, fill: STONE, alpha: 0.82 },
  { kind: 'rrect', x: 322, y: 284, w: 60, h: 124, r: 19, rot: 7, fill: STONE, alpha: 0.82 },
  { kind: 'rrect', x: 214, y: 228, w: 86, h: 180, r: 26, rot: 1.5, fill: STONE },
];

const DESIGN = 512;

// ---------------------------------------------------------------------------
// Minimal PNG writer (8-bit RGBA, filter type 0)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(pixels: Uint8Array, w: number, h: number): Buffer {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const dst = y * (stride + 1);
    raw[dst] = 0; // filter: None
    raw.set(pixels.subarray(y * stride, y * stride + stride), dst + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Rasteriser
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

class Canvas {
  readonly px: Uint8Array;
  constructor(readonly w: number, readonly h: number) {
    this.px = new Uint8Array(w * h * 4); // transparent
  }

  /** Source-over composite of a straight-alpha colour onto one pixel. */
  private blend(i: number, [r, g, b]: RGB, a: number): void {
    if (a <= 0) return;
    const dstA = this.px[i + 3] / 255;
    const outA = a + dstA * (1 - a);
    if (outA <= 0) return;
    for (let k = 0; k < 3; k++) {
      const src = [r, g, b][k];
      const dst = this.px[i + k];
      this.px[i + k] = Math.round((src * a + dst * dstA * (1 - a)) / outA);
    }
    this.px[i + 3] = Math.round(outA * 255);
  }

  /** Vertical gradient across the full canvas, fully opaque. */
  fillGradient(top: RGB, bottom: RGB): void {
    for (let y = 0; y < this.h; y++) {
      const t = this.h === 1 ? 0 : y / (this.h - 1);
      const row = [0, 1, 2].map((k) => Math.round(top[k] + (bottom[k] - top[k]) * t));
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        this.px[i] = row[0];
        this.px[i + 1] = row[1];
        this.px[i + 2] = row[2];
        this.px[i + 3] = 255;
      }
    }
  }

  /**
   * Fill an implicit shape with 4x4 supersampled coverage (antialiasing).
   * `box` bounds the scan so large canvases stay cheap.
   */
  fill(
    inside: (x: number, y: number) => boolean,
    colour: RGB,
    alpha: number,
    box: { x: number; y: number; w: number; h: number },
  ): void {
    const SS = 4;
    const x0 = Math.max(0, Math.floor(box.x));
    const y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(this.w, Math.ceil(box.x + box.w));
    const y1 = Math.min(this.h, Math.ceil(box.y + box.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            if (inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hits++;
          }
        }
        if (hits === 0) continue;
        this.blend((y * this.w + x) * 4, colour, alpha * (hits / (SS * SS)));
      }
    }
  }
}

const circleTest = (cx: number, cy: number, r: number) => (x: number, y: number) =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

const rrectTest = (x0: number, y0: number, w: number, h: number, r: number, rot = 0) => {
  // Rotating the *sample point* backwards about the rect centre is equivalent to
  // rotating the rect, and keeps the inside-test axis-aligned.
  const a = (-rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const x1 = x0 + w;
  const y1 = y0 + h;
  return (px: number, py: number) => {
    let x = px;
    let y = py;
    if (rot !== 0) {
      const dx = px - cx;
      const dy = py - cy;
      x = cx + dx * cos - dy * sin;
      y = cy + dx * sin + dy * cos;
    }
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    // Distance from the rounded-corner centre, zero when inside the inner cross.
    const qx = Math.max(x0 + r - x, 0, x - (x1 - r));
    const qy = Math.max(y0 + r - y, 0, y - (y1 - r));
    return qx * qx + qy * qy <= r * r;
  };
};

/** Axis-aligned bounds of a shape in design space (rotation included). */
function shapeBounds(s: Shape): { x0: number; y0: number; x1: number; y1: number } {
  if (s.kind === 'circle') {
    return { x0: s.cx - s.r, y0: s.cy - s.r, x1: s.cx + s.r, y1: s.cy + s.r };
  }
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const a = ((s.rot ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [
    [s.x, s.y],
    [s.x + s.w, s.y],
    [s.x, s.y + s.h],
    [s.x + s.w, s.y + s.h],
  ]) {
    xs.push(cx + (px - cx) * cos - (py - cy) * sin);
    ys.push(cy + (px - cx) * sin + (py - cy) * cos);
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Tight bounding box of EMBLEM in design space — used to centre and scale it. */
const EMBLEM_BOX = (() => {
  const b = EMBLEM.map(shapeBounds);
  const x = Math.min(...b.map((v) => v.x0));
  const y = Math.min(...b.map((v) => v.y0));
  return {
    x,
    y,
    w: Math.max(...b.map((v) => v.x1)) - x,
    h: Math.max(...b.map((v) => v.y1)) - y,
  };
})();

/**
 * Draw EMBLEM onto `c`, scaled by `scale` and centred on `EMBLEM_BOX` at
 * (`cx`, `cy`) in canvas pixels.
 */
function drawEmblem(c: Canvas, cx: number, cy: number, scale: number): void {
  const ox = cx - (EMBLEM_BOX.x + EMBLEM_BOX.w / 2) * scale;
  const oy = cy - (EMBLEM_BOX.y + EMBLEM_BOX.h / 2) * scale;
  const X = (v: number) => ox + v * scale;
  const Y = (v: number) => oy + v * scale;

  for (const s of EMBLEM) {
    const colour = hexToRgb(s.fill);
    const alpha = s.alpha ?? 1;
    const test =
      s.kind === 'circle'
        ? circleTest(X(s.cx), Y(s.cy), s.r * scale)
        : rrectTest(X(s.x), Y(s.y), s.w * scale, s.h * scale, s.r * scale, s.rot ?? 0);
    const b = shapeBounds(s);
    c.fill(test, colour, alpha, {
      x: X(b.x0) - 1,
      y: Y(b.y0) - 1,
      w: (b.x1 - b.x0) * scale + 2,
      h: (b.y1 - b.y0) * scale + 2,
    });
  }
}

/**
 * A square app icon. `rounded` clips to a superellipse-ish rounded rect with
 * transparent corners (for `purpose: any`); square keeps the corners opaque so
 * the platform can apply its own mask (iOS squircle, Android maskable).
 */
function renderIcon(size: number, opts: { rounded: boolean; emblemScale: number }): Buffer {
  const c = new Canvas(size, size);
  const top = hexToRgb(BG_TOP);
  const bottom = hexToRgb(BG_BOTTOM);
  if (opts.rounded) {
    // Antialiased rounded background over transparency.
    const radius = size * 0.225;
    const test = rrectTest(0, 0, size, size, radius);
    for (let y = 0; y < size; y++) {
      const t = y / (size - 1);
      const row: RGB = [0, 1, 2].map((k) => Math.round(top[k] + (bottom[k] - top[k]) * t)) as RGB;
      c.fill(test, row, 1, { x: 0, y, w: size, h: 1 });
    }
  } else {
    c.fillGradient(top, bottom);
  }
  const scale = (size / DESIGN) * opts.emblemScale;
  drawEmblem(c, size / 2, size / 2, scale);
  return encodePng(c.px, size, size);
}

/** iOS launch image: the brand gradient with the emblem centred. */
function renderSplash(w: number, h: number): Buffer {
  const c = new Canvas(w, h);
  c.fillGradient(hexToRgb(BG_TOP), hexToRgb(BG_BOTTOM));
  // Sized off the short edge so portrait and landscape agree; sat slightly high
  // of centre, which reads as more deliberate than dead-centre on a tall screen.
  drawEmblem(c, w / 2, h * 0.46, (Math.min(w, h) * 0.42) / EMBLEM_BOX.w);
  return encodePng(c.px, w, h);
}

// ---------------------------------------------------------------------------
// SVG (same EMBLEM, so the vector favicon can't drift from the PNGs)
// ---------------------------------------------------------------------------

function renderSvg(): string {
  const body = EMBLEM.map((s) => {
    const opacity = s.alpha !== undefined ? ` opacity="${s.alpha}"` : '';
    if (s.kind === 'circle') {
      return `  <circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${s.fill}"${opacity}/>`;
    }
    const rot = s.rot
      ? ` transform="rotate(${s.rot} ${s.x + s.w / 2} ${s.y + s.h / 2})"`
      : '';
    return `  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}" fill="${s.fill}"${opacity}${rot}/>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DESIGN} ${DESIGN}">
  <!-- Generated by scripts/icons.ts — edit EMBLEM there, then \`npm run icons\`. -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/>
      <stop offset="1" stop-color="${BG_BOTTOM}"/>
    </linearGradient>
  </defs>
  <rect width="${DESIGN}" height="${DESIGN}" rx="${Math.round(DESIGN * 0.225)}" fill="url(#bg)"/>
${body}
</svg>
`;
}

// ---------------------------------------------------------------------------

function main(): void {
  mkdirSync(SPLASH_DIR, { recursive: true });

  const icons: [string, Buffer][] = [
    // `purpose: any` — rounded corners, transparent outside.
    ['icon-192.png', renderIcon(192, { rounded: true, emblemScale: 1 })],
    ['icon-512.png', renderIcon(512, { rounded: true, emblemScale: 1 })],
    // `purpose: maskable` — full bleed, emblem inside the 80% safe circle.
    ['icon-maskable-512.png', renderIcon(512, { rounded: false, emblemScale: 0.72 })],
    // iOS applies its own squircle mask, so this must be square and opaque.
    ['apple-touch-icon.png', renderIcon(180, { rounded: false, emblemScale: 1 })],
  ];
  for (const [name, buf] of icons) {
    writeFileSync(resolve(ICON_DIR, name), buf);
    console.log(`  ✓ icons/${name} (${(buf.length / 1024).toFixed(1)} kB)`);
  }

  const seen = new Set<string>();
  for (const screen of IOS_SCREENS) {
    const file = splashFile(screen);
    if (seen.has(file)) continue; // distinct devices can share a raster size
    seen.add(file);
    const buf = renderSplash(screen.w * screen.dpr, screen.h * screen.dpr);
    writeFileSync(resolve(SPLASH_DIR, file), buf);
    console.log(`  ✓ icons/splash/${file} (${(buf.length / 1024).toFixed(1)} kB)`);
  }

  writeFileSync(resolve(root, 'public/favicon.svg'), renderSvg());
  console.log('  ✓ favicon.svg');
}

main();
