import L from 'leaflet';

// Canvas-drawn shape markers. The map used to render pubs/swims/ruins as
// divIcon markers — real DOM nodes, ~1,750 of them — which made every marker
// rebuild and every pan/zoom crawl on mobile. Instead we subclass CircleMarker
// and draw the shape directly on the canvas renderer (the map is created with
// preferCanvas: true), keeping the shape-encodes-category design with zero
// marker DOM. Hit-testing is inherited from CircleMarker (circular, radius +
// clickTolerance) — an adequate tap target for all four shapes.
//
// This reaches into Leaflet 1.9 renderer internals (_ctx, _drawing,
// _fillStroke) — the standard pattern for custom canvas shapes, and stable
// across the 1.x line. If the renderer isn't canvas we fall back to the stock
// circle drawing rather than break.

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond';

export interface ShapeMarkerOptions extends L.CircleMarkerOptions {
  shape?: MarkerShape;
}

const ShapeMarkerClass = L.CircleMarker.extend({
  _updatePath(this: any) {
    const renderer = this._renderer;
    const shape: MarkerShape = this.options.shape ?? 'circle';
    const ctx: CanvasRenderingContext2D | undefined = renderer?._ctx;
    if (shape === 'circle' || !ctx) {
      renderer._updateCircle(this);
      return;
    }
    if (!renderer._drawing || this._empty()) return;

    const p = this._point;
    const r = Math.max(this._radius, 1);
    ctx.beginPath();
    if (shape === 'square') {
      ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
    } else if (shape === 'triangle') {
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y + r);
      ctx.lineTo(p.x - r, p.y + r);
    } else {
      // diamond
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y);
      ctx.lineTo(p.x, p.y + r);
      ctx.lineTo(p.x - r, p.y);
    }
    ctx.closePath();
    renderer._fillStroke(ctx, this);
  },
});

export function shapeMarker(
  latlng: L.LatLngExpression,
  options: ShapeMarkerOptions,
): L.CircleMarker {
  return new (ShapeMarkerClass as any)(latlng, options) as L.CircleMarker;
}
