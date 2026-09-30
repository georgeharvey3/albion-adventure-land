import L from 'leaflet';
import { categoryColorsOf } from '../data/types';
import type { FilteredSiteView } from '../state/selectors';
import { smoothstep } from './zoomScale';

// The national-zoom glow (issue #74). Across the whole of Britain ~2,600 pins
// read as scattered crumbs; a soft wash in each layer's colour shows where the
// places are thick on the ground — scrambles in the Lakes and Snowdonia, pubs
// round Birmingham — and the pins, shrunk to specks, sit on top of it. By z8
// the glow has gone: at regional zoom the pins say everything it did.
//
// Hand-rolled on one canvas, no heatmap library. Each colour gets an offscreen
// pile: every site stamps a soft black sprite into its colour's pile, so the
// alpha builds up where sites crowd and saturates instead of blowing out. Then
// `source-in` tints the pile, and it lands on the visible canvas. Nothing is
// counted and nothing shows a number — the glow is a density, not a statistic.
//
// It follows the filter because it is fed the same `useFilteredSites` list as
// the pins, which is `matchesFilter` (src/state/filter.ts).
//
// Panning costs nothing: the canvas carries a margin on every side and moves
// with its pane; it repaints only when a pan or zoom has settled. Through a
// zoom it is scaled with the same transform Leaflet's own renderers use, so it
// grows and shrinks with the tiles instead of jumping.

/** Zoom where the glow starts to fade, and where it has gone. */
const FADE_FROM = 6.5;
const FADE_TO = 8;

// Glow radius on the ground, clamped in pixels so it neither vanishes at z4
// nor floods a county at z7.
const RADIUS_M = 14000;
const MIN_PX = 10;
const MAX_PX = 55;

/** Peak alpha one site stamps into its colour's pile. */
const STAMP = 0.08;
const GLOW_ALPHA = 0.8;

/** Share of the viewport drawn beyond each edge, so a pan shows no bare edge. */
const PAD = 0.4;

/** 1 at national zoom, 0 from z8. */
export function glowAmount(zoom: number): number {
  return 1 - smoothstep((zoom - FADE_FROM) / (FADE_TO - FADE_FROM));
}

const SPRITE_SIZE = 128;
let spriteCache: HTMLCanvasElement | null = null;
function sprite(): HTMLCanvasElement {
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

export class GlowLayer extends L.Layer {
  private views: readonly FilteredSiteView[] = [];
  private canvas: HTMLCanvasElement | null = null;
  // One scratch canvas reused for every colour's pile. The glow is soft, so
  // both canvases run at one pixel per CSS pixel: retina would quadruple the
  // work for no visible gain.
  private pile = document.createElement('canvas');
  private drawnCenter: L.LatLng | null = null;
  private drawnZoom = 0;

  constructor(options?: L.LayerOptions) {
    super();
    // L.Layer's constructor ignores its argument. Without this the `pane`
    // option is lost: the canvas lands in the overlay pane, and the glow pane's
    // fade in MapView.tsx never reaches it.
    L.setOptions(this, options);
  }

  setViews(views: readonly FilteredSiteView[]): this {
    this.views = views;
    this.redraw();
    return this;
  }

  onAdd(): this {
    this.canvas = L.DomUtil.create('canvas', 'glow-canvas leaflet-zoom-animated');
    this.getPane()!.appendChild(this.canvas);
    this.redraw();
    return this;
  }

  onRemove(): this {
    if (this.canvas) L.DomUtil.remove(this.canvas);
    this.canvas = null;
    return this;
  }

  getEvents() {
    // Leaflet's typings want a plain handler map; these handlers take the
    // specific event types, which the map is happy to hand them.
    return {
      moveend: this.redraw,
      viewreset: this.redraw,
      zoom: this.onZoom,
      zoomanim: this.onZoomAnim,
    } as unknown as { [name: string]: L.LeafletEventHandlerFn };
  }

  private onZoomAnim(e: L.ZoomAnimEvent) {
    this.transform(e.center, e.zoom);
  }

  // A pinch zooms without a `zoomanim`, one `zoom` event per frame.
  private onZoom() {
    this.transform(this._map.getCenter(), this._map.getZoom());
  }

  // Leaflet's own Renderer._updateTransform, which is private, so copied.
  private transform(center: L.LatLng, zoom: number) {
    const map = this._map as L.Map & { _getNewPixelOrigin(c: L.LatLng, z: number): L.Point };
    if (!this.canvas || !this.drawnCenter) return;
    const scale = map.getZoomScale(zoom, this.drawnZoom);
    const viewHalf = map.getSize().multiplyBy(0.5 + PAD);
    const offset = viewHalf
      .multiplyBy(-scale)
      .add(map.project(this.drawnCenter, zoom))
      .subtract(map._getNewPixelOrigin(center, zoom));
    L.DomUtil.setTransform(this.canvas, offset, scale);
  }

  redraw(): void {
    const map = this._map;
    const canvas = this.canvas;
    if (!map || !canvas) return;

    const size = map.getSize();
    const w = Math.round(size.x * (1 + 2 * PAD));
    const h = Math.round(size.y * (1 + 2 * PAD));
    const topLeft = map.containerPointToLayerPoint(size.multiplyBy(-PAD)).round();
    L.DomUtil.setPosition(canvas, topLeft);
    this.drawnCenter = map.getCenter();
    this.drawnZoom = map.getZoom();
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    // From z8 there is no glow to draw, so a regional pan costs nothing.
    if (glowAmount(this.drawnZoom) <= 0) return;

    // Metres per pixel at the view's latitude, for a glow sized on the ground.
    const mpp =
      (40075016 * Math.cos((this.drawnCenter.lat * Math.PI) / 180)) / (256 * 2 ** this.drawnZoom);
    const r = Math.min(MAX_PX, Math.max(MIN_PX, RADIUS_M / mpp));

    // A merged place (issue #37) glows in every colour it answers to, as its
    // striped pin does.
    const byColor = new Map<string, L.Point[]>();
    for (const { site } of this.views) {
      const p = map.latLngToLayerPoint([site.lat, site.lng]).subtract(topLeft);
      if (p.x < -r || p.y < -r || p.x > w + r || p.y > h + r) continue;
      for (const color of categoryColorsOf(site)) {
        let points = byColor.get(color);
        if (!points) byColor.set(color, (points = []));
        points.push(p);
      }
    }

    const pile = this.pile;
    if (pile.width !== w || pile.height !== h) {
      pile.width = w;
      pile.height = h;
    }
    const pctx = pile.getContext('2d')!;
    const spr = sprite();
    // Biggest pile first, so a sparse layer lands on top instead of under.
    const ordered = [...byColor].sort((a, b) => b[1].length - a[1].length);
    ctx.globalAlpha = GLOW_ALPHA;
    for (const [color, points] of ordered) {
      pctx.globalCompositeOperation = 'source-over';
      pctx.clearRect(0, 0, w, h);
      pctx.globalAlpha = STAMP;
      for (const p of points) pctx.drawImage(spr, p.x - r, p.y - r, r * 2, r * 2);
      pctx.globalAlpha = 1;
      pctx.globalCompositeOperation = 'source-in';
      pctx.fillStyle = color;
      pctx.fillRect(0, 0, w, h);
      ctx.drawImage(pile, 0, 0);
    }
    ctx.globalAlpha = 1;
  }
}
