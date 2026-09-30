// The covered insets (issue #87, Q19): the bands along the edges of the map
// that the desktop chrome lies over. The strip covers the bottom, the drawer
// column covers the left while it is open, and the spread covers the right.
//
// One value feeds everything that needs to know what the user can see: the
// plate fence, the strip's view box, and the controls that stay clear of the
// chrome. On a phone every inset is 0.
//
// Only a full band along an edge is an inset. The card on its own is a box in
// the top left corner, and the map shows below it, so it is not one.
//
// Pure pixel maths, with no Leaflet, so it runs under `npm test`.

export interface CoveredInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: CoveredInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export function sameInsets(a: CoveredInsets, b: CoveredInsets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

interface Pt {
  x: number;
  y: number;
}

/** The centre of the part of the view that shows, in container pixels. The
 *  spread pans its site here (issue #90). */
export function openCentre(view: Pt, insets: CoveredInsets): Pt {
  return {
    x: (insets.left + view.x - insets.right) / 2,
    y: (insets.top + view.y - insets.bottom) / 2,
  };
}

/** A box in layer pixels at one zoom: `min` is the north-west corner. */
export interface PixelBox {
  min: Pt;
  max: Pt;
}

/**
 * The pan limit at one zoom, in pixels. The plate grows by the covered insets,
 * so its edge can go under the chrome, where nobody sees it, while the part of
 * the map that shows never runs past the plate. Then, on any axis where the
 * view is bigger than that box, the box widens to exactly the view, so that
 * axis cannot move (see fenceToPlate in plate.ts).
 */
export function fenceBox(plate: PixelBox, view: Pt, insets: CoveredInsets): PixelBox {
  const min = { x: plate.min.x - insets.left, y: plate.min.y - insets.top };
  const max = { x: plate.max.x + insets.right, y: plate.max.y + insets.bottom };
  const padX = Math.max(0, (view.x - (max.x - min.x)) / 2);
  const padY = Math.max(0, (view.y - (max.y - min.y)) / 2);
  return {
    min: { x: min.x - padX, y: min.y - padY },
    max: { x: max.x + padX, y: max.y + padY },
  };
}
