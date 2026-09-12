# Design — Albion Adventure Land

A locked design system for this app. Every surface reads this file before it
changes. Do not write a new system for each surface. Extend this file when the
system must grow.

The voice is a field almanac. The app is a reference book that you carry to a
place. It is dense, it is tabular, and it uses hairlines instead of cards. The
type does the work. The color does very little.

## Genre

Editorial.

## Surfaces

This app is one screen, not a set of routes. It has eight surfaces. Each surface
belongs to one macrostructure family.

| Surface           | Component        | Family   |
| ----------------- | ---------------- | -------- |
| Map and the shell | `MapView`, `App` | Shell    |
| Near me list      | `NearMeList`     | Index    |
| Filters           | `Filters`        | Index    |
| Outing            | `Outing`         | Index    |
| Saved             | `Stats`          | Index    |
| Journey bar       | `JourneyBar`     | Shell    |
| Site card         | `SiteDetail`     | Document |
| Picture viewer    | `Lightbox`       | Document |

## Macrostructure families

- **Shell** — Map / Diagram (19). The map is the composition. Chrome is small,
  quiet, and edge-aligned. Nothing competes with the map.
- **Index** — Index-First (13). The surface is a list. Hairlines divide the
  rows. The rows are the buttons. No hero, no cards, no reveal.
  - **Stat-Led knob** (04), reserved. The Saved surface is styled to lead with
    one large tabular figure, with the list under it as the qualifier.
    The markup for that figure does not exist yet: `Stats.tsx` renders only the
    wishlist, the visited log, and the hidden list. The rules `.stats-total`,
    `.stats-big`, `.stats-pct`, `.stats-bar`, `.stats-bar-fill` and
    `.stats-nudge` are in `src/index.css` and follow this system, but no
    component uses them. They wait for the completion-stats feature (F6).
- **Document** — Long Document (02). Continuous prose at a 65ch measure.
  Negative space divides the sections. Pictures sit at the text measure.

## Theme

Almanac. Light cool paper, uppercase labels, dense rows, tabular figures,
hairline dividers, outlined controls.

The accent is the same forest green the app shipped with. The neutrals now lean
cool and green, because a warm neutral under a green accent reads as an error
that a reader cannot name.

| Token                 | Value                    | Role                                            |
| --------------------- | ------------------------ | ----------------------------------------------- |
| `--color-paper`       | `oklch(97% 0.006 160)`   | The base surface                                |
| `--color-paper-2`     | `oklch(99.2% 0.004 160)` | Raised surfaces: the site card, the journey bar |
| `--color-paper-3`     | `oklch(94% 0.009 160)`   | Recessed bands and blank picture swatches       |
| `--color-rule`        | `oklch(87% 0.011 160)`   | Hairline dividers                               |
| `--color-rule-strong` | `oklch(79% 0.014 160)`   | Outlines of controls at rest                    |
| `--color-edge`        | `oklch(62% 0.013 162)`   | Boundaries that carry meaning alone             |
| `--color-muted`       | `oklch(46.2% 0.015 165)` | Secondary text. 6.46:1 on paper                 |
| `--color-ink`         | `oklch(24% 0.018 165)`   | Primary text. 15.02:1 on paper                  |
| `--color-accent`      | `oklch(45.2% 0.082 162)` | The one accent. 6.46:1 on paper                 |
| `--color-accent-ink`  | `oklch(99.2% 0.004 160)` | Text on an accent fill                          |
| `--color-accent-soft` | `oklch(92.8% 0.022 162)` | The selected row band                           |
| `--color-accent-deep` | `oklch(38% 0.075 162)`   | The filled primary button, pressed              |
| `--color-focus`       | `oklch(52% 0.15 162)`    | The focus ring. 4.48:1 on paper                 |
| `--color-warn`        | `oklch(70% 0.11 75)`     | The outing failure panel                        |
| `--color-danger`      | `oklch(52% 0.17 28)`     | Data load errors                                |
| `--color-wish`        | `oklch(52% 0.13 60)`     | The wishlist badge                              |

The accent covers less than 3 percent of any view. It marks the active tab, the
focus ring, a link, a selected row, and the stop numerals. It never fills a
large area.

## Typography

Two web fonts and no system stack. The fonts are self-hosted under `src/fonts`
and the service worker precaches them, because the app must work with no signal.

- **Display and body** — Cardo 400. Self-hosted, Latin and Latin Extended.
- **UI** — Instrument Sans, variable 400 to 700. Self-hosted, Latin and Latin
  Extended. The face is a sans, not a mono. It keeps the figure role because it
  carries a real `tnum` feature, so a column of distances still aligns.

The tokens `--font-display` and `--font-body` hold the same value. They stay two
names because they are two meanings. A later change to the prose face must not
move the place names with it.

### The one rule that holds the system together

**One serif, two jobs: the name of a place, and the prose that describes it.**

A site name, a listing name, a journey endpoint, and a trip stop use Cardo. The
write-up below the name uses Cardo too. Every other string uses the UI face.
This rule is what makes the app read as a guidebook instead of a list of
records.

The system stack was the one part of the page that no one chose. A description
in the default font of the device reads as unstyled text beside a serif name.
The serif takes the prose for this reason.

### The UI face has two roles

1. **Figures** — distances, counts, percentages, detour figures, stop numerals,
   trip length. Always with `font-variant-numeric: tabular-nums`.
2. **Labels** — the small uppercase category and section labels, at 0.08em of
   letter-spacing. A mixed-case label joins this role only when it needs a
   weight above 400, because Cardo has no bold. The button label and the layer
   name are the two that do.

Do not use the UI face for a third role. A third role makes it a second body
font, which is slop. The tag chips stay on the serif for this reason: they are
400, and the UI face makes the tag block taller on a phone.

### Controls

A form control does not inherit the page font. A button, an input, a select and
a textarea each take the face of the browser, which is Arial on Linux. The base
rule in `src/index.css` gives all four `font: inherit`. Without it, every
control that sets no family of its own is a third font on the page.

Leaflet is the other source. Its stylesheet sets `'Lucida Console'` on the zoom
buttons, so `src/index.css` overrides that pair by name.

### Weights

Cardo ships at 400 only. Never set a weight above 400 on a Cardo element, a
place name or prose: the browser synthesizes the bold and the letterforms break.
Size and color carry the hierarchy instead.

Two chrome labels want a 600, the button label and the layer name. Both use the
UI face, which is variable 400 to 700 and takes a real weight.

### Scale

A 1.2 ratio from a 16px base. Six steps. No surface uses more than five.

The body step is the one exception to the ratio. Cardo has a small x-height, so
16px of Cardo reads smaller than 16px of a sans. 17px corrects it.

| Token        | Size      | Use                                                    |
| ------------ | --------- | ------------------------------------------------------ |
| `--text-2xs` | 0.694rem  | UI labels in caps only                                 |
| `--text-xs`  | 0.833rem  | Figures, captions, secondary text, control labels      |
| `--text-md`  | 1.0625rem | Body prose, site names                                 |
| `--text-lg`  | 1.2rem    | The card title                                         |
| `--text-xl`  | 1.44rem   | Reserved                                               |
| `--text-2xl` | 1.728rem  | The Saved figure                                       |

Line height is 1.15 for display, 1.3 for interface rows, and 1.6 for prose.

## Icons

One icon set, vendored. The paths come from Lucide (ISC licence, v1.45.0) and
live in `src/ui/icons.tsx`. They are copied, not installed, because the bundle
story is a feature and because two call sites are not React.

- **Stroke** — 1.5px, square terminals, miter joins. This is not Lucide's
  default of 2px round. The thinner square stroke makes an icon read as a drawn
  mark on a printed page, which is the same reason the dividers are hairlines.
- **Colour** — every icon strokes `currentColor`. An icon takes the colour of
  the thing that labels it. Never give an icon a colour rule of its own.
- **Size** — 16, 20 or 24. Nothing between. 16 is the inline default. The map
  controls use 20.
- **Accessibility** — icons are `aria-hidden="true"` because each one repeats a
  visible label. An icon-only control must carry its own `aria-label`.

The eight icons and what each one means:

| Icon         | Meaning                                                             |
| ------------ | ------------------------------------------------------------------- |
| `MapPinIcon` | A position: the drop-pin control, "here", the manual pin hints      |
| `FlagIcon`   | The destination: the map marker, the journey bar, the trip terminus |
| `CheckIcon`  | Visited, or in the trip                                             |
| `StarIcon`   | Wishlist. Filled when on, outline when off                          |
| `BanIcon`    | Hidden                                                              |
| `ClockIcon`  | The walk time                                                       |
| `MapIcon`    | Browse mode is on, and this returns to the map                      |
| `ListIcon`   | Browse mode is off, and this opens the list                         |

### What stays as text

`✕ ▸ ▾ ▴ ▲ ▼ → ↗` are typographic marks, not icons. They render in the page
font, they take the ink colour, and they scale with the text. Replacing them
with SVG would add markup and change nothing a reader can see.

### Emoji are banned

No emoji in the interface. The operating system draws them, so their colour,
weight and alignment are outside this system, and they look different on every
device. If a new affordance needs a mark, add one path to `src/ui/icons.tsx`.

## Spacing

A 4-point scale with named steps. The values are in `tokens.css`. Use a named
token. Do not write a raw pixel value.

## Shape

Almanac is a printed page, not a card deck. Radii are near zero.

- `--radius-sm` 2px — chips, badges, thumbnails
- `--radius-md` 3px — buttons, panels, the site card
- `--radius-pill` 999px — the layer switch only, because the switch is a
  platform affordance and a reader recognizes it by its shape

A hairline replaces a card border wherever the content already has an edge.

## Motion

Two primitives. No more.

1. The layer switch slides, 120ms, `--ease-in-out`.
2. The disclosure caret rotates, 120ms, `--ease-out`.

A button press moves 1px with no transition, because instant feedback is not an
animation.

The "you are here" halo is the one loop. It is not a primitive of the system: it
marks live position, and it stops under reduced motion.

Never transition `width`, `height`, `top`, `left`, `margin` or `padding`. These
are layout properties and each frame costs a reflow. Use `transform` and
`opacity`.

- Easings: `--ease-out` is `cubic-bezier(0.16, 1, 0.3, 1)`. `--ease-in` is
  `cubic-bezier(0.7, 0, 0.84, 0)`. `--ease-in-out` is
  `cubic-bezier(0.65, 0, 0.35, 1)`. The browser default `ease` is banned.
- Durations: `--dur-micro` 120ms, `--dur-short` 220ms, `--dur-long` 420ms.
- Reduced motion: both primitives and the button press collapse. The "you are here"
  halo stops and holds its expanded state.

## Interaction

- Every interactive element has a `:focus-visible` ring at 2px in
  `--color-focus`, with a 2px offset. The ring appears instantly. Never put a
  transition on the ring.
- A lone button-shaped control carries a `--color-edge` outline, which is 3.30:1
  against the paper. The filter chip is the one exception: a filter panel shows
  forty chips at once, and edges at 3:1 make it a grid of boxes. A chip is
  identified by its label at 15:1 and by its fill, so it keeps the lighter
  `--color-rule-strong` hairline.
- A clickable label never wraps to two lines. Every one of them carries
  `white-space: nowrap`.
- Leaflet takes colour strings, not CSS variables. `MapView.tsx` reads
  `--color-accent` from the token layer once and caches it. Do not write a hex
  value there: the route lines drifted a shade away from the app the last time
  the palette moved.
- Silent success. A visited toggle shows its result on the row. It does not
  raise a message.
- Hover is never the only affordance. This app runs on a phone.
- Disabled controls drop to 0.4 opacity and `cursor: default`.

## What every surface shares

- The serif face, and the rule that it sets place names and prose only.
- The accent color and its 3 percent budget.
- The UI face and its two roles.
- The hairline divider. No surface draws a card border around a list.
- The focus ring.
- The spacing scale.

## What a surface can vary

- The macrostructure inside its family.
- Row density. The map list is tight. The browse list is open, because a reader
  in browse mode has the whole screen.
- Whether a picture appears. Only the Document family carries pictures at full
  measure.

## Per-family allowances

- **Shell** — no ornament of any kind. The map is the content.
- **Index** — no pictures above 56px, no card fills, no reveal on scroll.
- **Document** — pictures at the text measure, a snap strip when there are two
  or more, and a 65ch measure on prose.

## Banned in this app

- Card inside a card. The filter layers were a bordered panel that held chips.
  They are hairline bands now.
- A thick colored stripe on one edge of a row or a panel.
- A shadow on any surface except the site card, the picture viewer, and the map
  overlay. Those three float above the map and need the separation.
- A raw hex or `oklch()` value in `src/index.css`. Add a token first.
- Any new color outside the table above.

## Exports

Drop-in formats for this design system.

### tokens.css

The file `tokens.css` at the project root holds the full token block. The app
imports it at the top of `src/index.css`.

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: oklch(97% 0.006 160);
  --color-paper-2: oklch(99.2% 0.004 160);
  --color-paper-3: oklch(94% 0.009 160);
  --color-rule: oklch(87% 0.011 160);
  --color-ink: oklch(24% 0.018 165);
  --color-muted: oklch(46.2% 0.015 165);
  --color-accent: oklch(45.2% 0.082 162);
  --color-accent-ink: oklch(99.2% 0.004 160);
  --font-display: "Cardo", ui-serif, Georgia, serif;
  --font-body: "Cardo", ui-serif, Georgia, serif;
  --font-ui: "Instrument Sans", system-ui, -apple-system, sans-serif;
  --spacing-sm: 0.75rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --text-md: 1.0625rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "paper": { "$value": "oklch(97% 0.006 160)", "$type": "color" },
    "ink": { "$value": "oklch(24% 0.018 165)", "$type": "color" },
    "muted": { "$value": "oklch(46.2% 0.015 165)", "$type": "color" },
    "rule": { "$value": "oklch(87% 0.011 160)", "$type": "color" },
    "accent": { "$value": "oklch(45.2% 0.082 162)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Cardo", "$type": "fontFamily" },
    "ui": { "$value": "Instrument Sans", "$type": "fontFamily" }
  },
  "space": {
    "sm": { "$value": "0.75rem", "$type": "dimension" },
    "md": { "$value": "1rem", "$type": "dimension" },
    "lg": { "$value": "1.5rem", "$type": "dimension" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 97% 0.006 160;
  --foreground: 24% 0.018 165;
  --primary: 45.2% 0.082 162;
  --primary-foreground: 99.2% 0.004 160;
  --muted: 94% 0.009 160;
  --muted-foreground: 46.2% 0.015 165;
  --border: 87% 0.011 160;
  --input: 79% 0.014 160;
  --ring: 52% 0.15 162;
  --radius: 3px;
}
```
