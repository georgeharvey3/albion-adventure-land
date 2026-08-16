// iOS launch-image ("splash") device table.
//
// iOS only uses an `apple-touch-startup-image` whose media query matches the
// device exactly, so every screen size needs its own entry and its own raster.
// Shared by `scripts/icons.ts` (which renders the PNGs) and `vite.config.ts`
// (which injects the matching <link> tags into index.html), so the two can
// never drift apart — adding a device here is the only edit needed.
//
// Portrait only. There is no landscape image, and iOS falls back to the
// manifest's background colour, which is the same brand green as the splash.

export type IosScreen = {
  /** Devices sharing this screen; documentation only. */
  label: string;
  /** CSS pixels. */
  w: number;
  h: number;
  dpr: number;
};

export const IOS_SCREENS: IosScreen[] = [
  { label: 'iPhone SE / 8 / 7 / 6s', w: 375, h: 667, dpr: 2 },
  { label: 'iPhone 8 Plus', w: 414, h: 736, dpr: 3 },
  { label: 'iPhone X / XS / 11 Pro / 12 mini / 13 mini', w: 375, h: 812, dpr: 3 },
  { label: 'iPhone XR / 11', w: 414, h: 896, dpr: 2 },
  { label: 'iPhone XS Max / 11 Pro Max', w: 414, h: 896, dpr: 3 },
  { label: 'iPhone 12 / 12 Pro / 13 / 13 Pro / 14', w: 390, h: 844, dpr: 3 },
  { label: 'iPhone 12 Pro Max / 13 Pro Max / 14 Plus', w: 428, h: 926, dpr: 3 },
  { label: 'iPhone 14 Pro / 15 / 15 Pro / 16', w: 393, h: 852, dpr: 3 },
  { label: 'iPhone 14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus', w: 430, h: 932, dpr: 3 },
  { label: 'iPhone 16 Pro', w: 402, h: 874, dpr: 3 },
  { label: 'iPhone 16 Pro Max', w: 440, h: 956, dpr: 3 },
];

/** Filename for a screen's launch image, in device pixels. */
export function splashFile(s: IosScreen): string {
  return `splash-${s.w * s.dpr}x${s.h * s.dpr}.png`;
}

/** The exact media query iOS matches a launch image against. */
export function splashMedia(s: IosScreen): string {
  return (
    `screen and (device-width: ${s.w}px) and (device-height: ${s.h}px)` +
    ` and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)`
  );
}
