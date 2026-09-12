/**
 * Icons — vendored from Lucide (https://lucide.dev), ISC licence, v1.45.0.
 *
 * Copied rather than installed. Three reasons:
 *
 *  1. The offline/bundle story is a feature of this app (see CLAUDE.md), and
 *     ten paths cost about a kilobyte against a dependency's two or three.
 *  2. Two call sites are not React. Leaflet builds its own control button and
 *     its `divIcon` takes an HTML string, so a component alone would not cover
 *     them — `iconMarkup()` below serves those two.
 *  3. The stroke is tuned to the Almanac voice: 1.5px with square terminals
 *     rather than Lucide's 2px round, so an icon reads as a drawn mark on a
 *     printed page rather than as a UI chrome glyph. See design.md.
 *
 * Every icon inherits `currentColor`, so an icon beside an accent label is
 * accent and an icon beside muted text is muted, with no rule of its own.
 *
 * To add one: copy the inner markup of the Lucide SVG into PATHS, keeping the
 * 24x24 viewBox, then export a component for it. Do not mix in a second icon
 * set — one stroke voice per project.
 */

const VIEWBOX = '0 0 24 24';

/**
 * The inner markup of each Lucide source file, verbatim. Held as strings so the
 * React components and the Leaflet markup helper share one definition; they are
 * compile-time constants in this module and never carry outside input.
 */
const PATHS = {
  mapPin:
    '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="M4.929 4.929 19.07 19.071"/>',
  /* The walk figure is a duration, so it takes a clock rather than a walker.
     Lucide's `footprints` is four paths and turns to mush at 16px; the word
     "Walk" in the label already carries the mode of travel. */
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  list: '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
} as const;

type IconName = keyof typeof PATHS;

export type IconProps = {
  /** 16 by default — the inline size. Snap to 16, 20 or 24; nothing between. */
  size?: 16 | 20 | 24;
  /** Fill the shape with the current colour. Only the star uses it (on/off). */
  filled?: boolean;
  className?: string;
};

function Icon({ name, size = 16, filled = false, className }: IconProps & { name: IconName }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox={VIEWBOX}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      /* Decorative in every current use: the icon repeats a label that is
         already in the accessibility tree, or sits on a control with its own
         aria-label. A future icon-only control must carry its own label. */
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}

export const MapPinIcon = (p: IconProps) => <Icon name="mapPin" {...p} />;
export const FlagIcon = (p: IconProps) => <Icon name="flag" {...p} />;
export const BanIcon = (p: IconProps) => <Icon name="ban" {...p} />;
export const ClockIcon = (p: IconProps) => <Icon name="clock" {...p} />;
export const MapIcon = (p: IconProps) => <Icon name="map" {...p} />;
export const ListIcon = (p: IconProps) => <Icon name="list" {...p} />;
export const CheckIcon = (p: IconProps) => <Icon name="check" {...p} />;
export const StarIcon = (p: IconProps) => <Icon name="star" {...p} />;

/**
 * The same icon as a standalone SVG string, for the two places that build their
 * own DOM: the Leaflet control button and the destination `divIcon`. Neither
 * can take a React element.
 */
export function iconMarkup(name: IconName, size: 16 | 20 | 24 = 20): string {
  return (
    `<svg class="icon" width="${size}" height="${size}" viewBox="${VIEWBOX}" fill="none" ` +
    `stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" ` +
    `aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
  );
}
