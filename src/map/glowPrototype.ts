import L from 'leaflet';
import { categoryColorsOf, PARENT_CATEGORY_COLORS, parentOf } from '../data/types';
import type { FilteredSiteView } from '../state/selectors';

// PROTOTYPE — issue #74, throwaway. Three ways to draw the national-zoom glow,
// switched by `?variant=` on the real map. Nothing here is production code: it
// exists to pick a look, then gets rewritten properly.
//
// Pipeline, shared by all three: one offscreen canvas per colour. Every site
// stamps a soft black sprite into its colour's canvas, so the alpha piles up
// where sites crowd and saturates instead of blowing out. Then `source-in`
// tints the pile, and it lands on the visible canvas with the variant's blend.
// Drawn at 1 device pixel per CSS pixel: the glow is soft, retina buys nothing.

export type GlowVariant = 'off' | 'A' | 'B' | 'C';

export const GLOW_VARIANTS: { key: GlowVariant; name: string }[] = [
  { key: 'off', name: 'Today — dots only' },
  { key: 'A', name: 'Halo — layer glow, pins crossfade' },
  { key: 'B', name: 'Wash — hand-tinted bands' },
  { key: 'C', name: 'Embers — glow under specks' },
];

interface GlowConfig {
  /** Glow radius on the ground, metres. Clamped to a pixel range below. */
  radiusM: number;
  minPx: number;
  maxPx: number;
  /** Peak alpha one site stamps into its colour's pile. */
  stamp: number;
  /** Colour key: the parent layer (Folklore is one purple) or the leaf. */
  colorBy: 'parent' | 'leaf';
  blend: GlobalCompositeOperation;
  alpha: number;
  /** Posterise the pile into bands with an inked edge (the Wash). */
  bands?: number[];
  /** Zoom where the glow starts to go and where it has gone. */
  fadeFrom: number;
  fadeTo: number;
  /** Pins fade in as the glow fades out. False keeps them always on. */
  crossfadePins: boolean;
  /** Pins shrink to specks at national zoom (Embers). */
  speckPins: boolean;
}

const CONFIG: Record<Exclude<GlowVariant, 'off'>, GlowConfig> = {
  A: {
    radiusM: 18000,
    minPx: 12,
    maxPx: 70,
    stamp: 0.1,
    colorBy: 'parent',
    blend: 'source-over',
    alpha: 0.9,
    fadeFrom: 7.5,
    fadeTo: 9,
    crossfadePins: true,
    speckPins: false,
  },
  B: {
    radiusM: 20000,
    minPx: 12,
    maxPx: 70,
    stamp: 0.09,
    colorBy: 'parent',
    blend: 'multiply',
    alpha: 1,
    bands: [0.3, 0.7],
    fadeFrom: 7.5,
    fadeTo: 9,
    crossfadePins: true,
    speckPins: false,
  },
  C: {
    radiusM: 14000,
    minPx: 10,
    maxPx: 55,
    stamp: 0.08,
    colorBy: 'leaf',
    blend: 'source-over',
    alpha: 0.8,
    // Gone by z8: at regional zoom the pins say it all (feedback on #74).
    fadeFrom: 6.5,
    fadeTo: 8,
    crossfadePins: false,
    speckPins: true,
  },
};

export function glowConfig(v: GlowVariant): GlowConfig | null {
  return v === 'off' ? null : CONFIG[v];
}

function smooth(t: number) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** 1 at national zoom, 0 once the pins have taken over. */
export function glowAmount(cfg: GlowConfig, zoom: number) {
  return 1 - smooth((zoom - cfg.fadeFrom) / (cfg.fadeTo - cfg.fadeFrom));
}

/** Embers: pin radius multiplier, a speck at z5, full size at z9. */
export function speckScale(cfg: GlowConfig, zoom: number) {
  if (!cfg.speckPins) return 1;
  return 0.3 + 0.7 * smooth((zoom - 5) / 4);
}

const SPRITE_SIZE = 128;
let spriteCache: HTMLCanvasElement | null = null;
function sprite() {
  if (spriteCache) return spriteCache;
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE_SIZE;
  const ctx = c.getContext('2d')!;
  const h = SPRITE_SIZE / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  spriteCache = c;
  return c;
}

const PAD = 0.4;

export class GlowLayer extends L.Layer {
  private cfg: GlowConfig;
  private views: FilteredSiteView[] = [];
  private canvas!: HTMLCanvasElement;
  private scratch = document.createElement('canvas');
  private center!: L.LatLng;
  private zoomAt = 0;
  lastDrawMs = 0;

  constructor(cfg: GlowConfig) {
    super({ pane: 'glowPane' } as L.LayerOptions);
    this.cfg = cfg;
  }

  setViews(views: FilteredSiteView[]) {
    this.views = views;
    if (this._map) this.redraw();
    return this;
  }

  onAdd() {
    this.canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated');
    this.canvas.style.position = 'absolute';
    this.canvas.style.transformOrigin = '0 0';
    this.getPane()!.appendChild(this.canvas);
    this.redraw();
    return this;
  }

  onRemove() {
    L.DomUtil.remove(this.canvas);
    return this;
  }

  getEvents() {
    return {
      moveend: this.redraw,
      viewreset: this.redraw,
      zoom: this.onZoom,
      zoomanim: this.onZoomAnim,
    } as unknown as { [name: string]: L.LeafletEventHandlerFn };
  }

  // The same transform Leaflet's own renderers use, so the glow scales with
  // the tiles through a zoom and only repaints once the zoom has settled.
  private onZoomAnim(e: L.ZoomAnimEvent) {
    this.transform(e.center, e.zoom);
  }
  private onZoom() {
    this.transform(this._map.getCenter(), this._map.getZoom());
  }
  private transform(center: L.LatLng, zoom: number) {
    const map = this._map as any;
    if (!this.center) return;
    const scale = map.getZoomScale(zoom, this.zoomAt);
    const viewHalf = map.getSize().multiplyBy(0.5 + PAD);
    const cur = map.project(this.center, zoom);
    const offset = viewHalf.multiplyBy(-scale).add(cur).subtract(map._getNewPixelOrigin(center, zoom));
    L.DomUtil.setTransform(this.canvas, offset, scale);
  }

  redraw() {
    const map = this._map;
    if (!map) return;
    const t0 = performance.now();
    const cfg = this.cfg;
    const size = map.getSize();
    const w = Math.round(size.x * (1 + 2 * PAD));
    const h = Math.round(size.y * (1 + 2 * PAD));
    const topLeft = map.containerPointToLayerPoint(size.multiplyBy(-PAD)).round();
    L.DomUtil.setPosition(this.canvas, topLeft);
    this.center = map.getCenter();
    this.zoomAt = map.getZoom();
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    if (glowAmount(cfg, this.zoomAt) <= 0) return;

    // Metres per pixel at the view's latitude, for a glow sized on the ground.
    const mpp = (40075016 * Math.cos((this.center.lat * Math.PI) / 180)) / (256 * 2 ** this.zoomAt);
    const r = Math.min(cfg.maxPx, Math.max(cfg.minPx, cfg.radiusM / mpp));

    const groups = new Map<string, L.Point[]>();
    for (const { site } of this.views) {
      const colors =
        cfg.colorBy === 'parent'
          ? [PARENT_CATEGORY_COLORS[parentOf(site.category)]]
          : categoryColorsOf(site);
      const p = map.latLngToLayerPoint([site.lat, site.lng]).subtract(topLeft);
      if (p.x < -r || p.y < -r || p.x > w + r || p.y > h + r) continue;
      for (const c of colors) {
        let list = groups.get(c);
        if (!list) groups.set(c, (list = []));
        list.push(p);
      }
    }

    const sc = this.scratch;
    sc.width = w;
    sc.height = h;
    const s = sc.getContext('2d', { willReadFrequently: !!cfg.bands })!;
    const spr = sprite();
    // Biggest pile first, so a sparse layer lands on top instead of under.
    const ordered = [...groups].sort((a, b) => b[1].length - a[1].length);
    for (const [color, pts] of ordered) {
      s.globalCompositeOperation = 'source-over';
      s.clearRect(0, 0, w, h);
      s.globalAlpha = cfg.stamp;
      for (const p of pts) s.drawImage(spr, p.x - r, p.y - r, r * 2, r * 2);
      s.globalAlpha = 1;
      if (cfg.bands) posterise(s, w, h, cfg.bands);
      s.globalCompositeOperation = 'source-in';
      s.fillStyle = color;
      s.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = cfg.blend;
      ctx.globalAlpha = cfg.alpha;
      ctx.drawImage(sc, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.lastDrawMs = performance.now() - t0;
  }
}

// The Wash: snap the alpha pile to a few flat tints, like a hand-coloured
// county map, and ink a darker line where one tint meets the next.
function posterise(s: CanvasRenderingContext2D, w: number, h: number, bands: number[]) {
  const img = s.getImageData(0, 0, w, h);
  const d = img.data;
  const level = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3] / 255;
    let l = 0;
    while (l < bands.length && a >= bands[l]) l++;
    level[i] = l;
  }
  const tint = [0, 0.28, 0.5];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = level[i];
      const edge =
        l > 0 &&
        ((x > 0 && level[i - 1] < l) ||
          (y > 0 && level[i - w] < l) ||
          (x < w - 1 && level[i + 1] < l) ||
          (y < h - 1 && level[i + w] < l));
      d[i * 4 + 3] = Math.round(255 * (edge ? 0.75 : tint[Math.min(l, tint.length - 1)]));
    }
  }
  s.putImageData(img, 0, 0);
}
