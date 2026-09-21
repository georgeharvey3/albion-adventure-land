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

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'chevron';

export interface ShapeMarkerOptions extends L.CircleMarkerOptions {
  shape?: MarkerShape;
  /**
   * Two or more colours fill the shape with hard-edged diagonal bands instead
   * of one flat colour — the hybrid pin for a place that two sources file
   * under different categories (issue #37). One colour, or none, and the
   * marker fills normally from `fillColor`.
   */
  fillColors?: string[];
}

/** Trace the shape onto the context. The path is left open for the caller to
 *  fill, clip and stroke. */
function tracePath(ctx: CanvasRenderingContext2D, shape: MarkerShape, x: number, y: number, r: number) {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(x, y, r, 0, Math.PI * 2, false);
  } else if (shape === 'square') {
    ctx.rect(x - r, y - r, r * 2, r * 2);
  } else if (shape === 'triangle') {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.lineTo(x - r, y + r);
  } else if (shape === 'chevron') {
    // mountain-peak chevron (^) — hollow-bottomed triangle
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.lineTo(x + r * 0.4, y + r);
    ctx.lineTo(x, y - r * 0.1);
    ctx.lineTo(x - r * 0.4, y + r);
    ctx.lineTo(x - r, y + r);
  } else {
    // diamond
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
  }
  ctx.closePath();
}

/**
 * Fill the current path with diagonal bands, one per colour.
 *
 * Clip to the shape, then paint bands in a frame rotated 45°, so the boundary
 * runs bottom-left → top-right whatever the shape is and the first colour — the
 * representative's — takes the top-left. That is the same way round as the
 * `linear-gradient(135deg, …)` on the list dots (`swatchBackground` in
 * src/data/types.ts); a pin and its row dot reading as mirror images of each
 * other is exactly the confusion the stripe exists to remove. Bands are sized
 * off the shape's longest diagonal (`r * 2 * √2`, the square's) so the outer
 * ones always run past the clip — no shape can show an unpainted corner. The
 * half-pixel overlap keeps a background hairline from showing through the seam
 * on a fractional-DPR screen.
 */
function fillStripes(
  ctx: CanvasRenderingContext2D,
  options: ShapeMarkerOptions,
  colors: string[],
  x: number,
  y: number,
  r: number,
) {
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = options.fillOpacity ?? 1;
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  const span = r * 2 * Math.SQRT2;
  const band = span / colors.length;
  for (let i = 0; i < colors.length; i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(-span / 2 + i * band - 0.5, -span, band + 1, span * 2);
  }
  ctx.restore();
}

const ShapeMarkerClass = L.CircleMarker.extend({
  _updatePath(this: any) {
    const renderer = this._renderer;
    const options: ShapeMarkerOptions = this.options;
    const shape: MarkerShape = options.shape ?? 'circle';
    const stripes =
      options.fill !== false && options.fillColors && options.fillColors.length > 1
        ? options.fillColors
        : null;
    const ctx: CanvasRenderingContext2D | undefined = renderer?._ctx;
    // Nothing to do differently: a plain circle on a canvas renderer, or any
    // shape on a renderer we don't know how to draw into.
    if ((shape === 'circle' && !stripes) || !ctx) {
      renderer._updateCircle(this);
      return;
    }
    if (!renderer._drawing || this._empty()) return;

    const p = this._point;
    const r = Math.max(this._radius, 1);
    tracePath(ctx, shape, p.x, p.y, r);

    if (!stripes) {
      renderer._fillStroke(ctx, this);
      return;
    }
    fillStripes(ctx, options, stripes, p.x, p.y, r);
    // The stroke — ring colour, weight, dash — is the renderer's business and
    // has to stay in step with it, so borrow it back with the fill switched
    // off rather than reimplementing it here. `clip()` was undone by the
    // restore above, and the path survives it, so this strokes the shape.
    const fill = options.fill;
    options.fill = false;
    try {
      renderer._fillStroke(ctx, this);
    } finally {
      options.fill = fill;
    }
  },
});

export function shapeMarker(
  latlng: L.LatLngExpression,
  options: ShapeMarkerOptions,
): L.CircleMarker {
  return new (ShapeMarkerClass as any)(latlng, options) as L.CircleMarker;
}
