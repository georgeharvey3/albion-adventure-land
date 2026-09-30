// How big a pin is at a zoom (issue #74). Pure maths with no Leaflet, so the
// strip (src/state/strip.ts) can ask the same question as the map and run
// under `npm test`.

export function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Below this share of full size a pin is a speck: no ring, no tap. */
export const SPECK_BELOW = 0.7;

/** Pin size as a share of full size: a speck at z5, full size by z9. */
export function pinScale(zoom: number): number {
  return 0.3 + 0.7 * smoothstep((zoom - 5) / 4);
}

/** Whether pins are specks at this zoom (below about z7.2). No hover, no key,
 *  no peek and no strip frames below it. */
export function isSpeckZoom(zoom: number): boolean {
  return pinScale(zoom) < SPECK_BELOW;
}
