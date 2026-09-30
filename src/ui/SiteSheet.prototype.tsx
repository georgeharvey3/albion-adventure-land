// PROTOTYPE — throwaway (issue #110 follow-up, #112). Not for main.
//
// Question: on a phone, can one sheet show a site, so the floating card and
// the rows that open in place both go? Three variants on the real app,
// switched by `?variant=` and the bar at the top:
//
//   now — PR #119 as it stands: the floating card at low, rows open in place.
//   A   — the site replaces the list in the sheet, photos first.
//   B   — the site replaces the list in the sheet, facts and actions first,
//         photos last.
//   C   — a peek: a pin tap opens only the site's header row at the low
//         height; a drag up opens the full site page.
//
// In A, B and C the tabs and the journey bar hide while a site is open, and
// closing the site (✕ or Esc) returns to the list at the height it was at.

import { useStore } from '../state/store';
import type { SheetHeight } from '../state/sheet';
import { SITE_TYPE_LABELS, siteSwatch, type Site } from '../data/types';
import { haversine, formatDistance } from '../geo/haversine';
import { directionsToSite } from '../links/googleMaps';
import { SiteBody } from './SiteDetail';
import { SITE_BODY_PARTS, type SiteBodyPart } from './siteBodyLayout';
import { copy } from '../copy';

export type ProtoVariant = 'now' | 'A' | 'B' | 'C';
const VARIANTS: ProtoVariant[] = ['now', 'A', 'B', 'C'];

/** The variant in the URL. Dev builds only; production is always `now`. */
export const protoVariant: ProtoVariant = (() => {
  if (!import.meta.env.DEV) return 'now';
  const v = new URLSearchParams(location.search).get('variant');
  return VARIANTS.includes(v as ProtoVariant) ? (v as ProtoVariant) : 'A';
})();

/** Whether the site shows in the sheet (A, B, C) instead of the card. */
export const siteInSheet = protoVariant !== 'now';

/** The height a pin tap opens the site at. */
export function protoPinHeight(): SheetHeight {
  return protoVariant === 'C' ? 'low' : 'mid';
}

/** The list height to go back to when the site closes. */
export const protoList: { height: SheetHeight } = { height: 'mid' };

const B_ORDER: SiteBodyPart[] = [
  'actions',
  'badges',
  'grade',
  'walkTime',
  'access',
  'hours',
  'writeUp',
  'source',
  'partOf',
  'listing',
  'gallery',
];

/** The site's head in the sheet: the low height in site mode. */
export function SiteSheetHead({ site }: { site: Site }) {
  const position = useStore((s) => s.position);
  const setSelected = useStore((s) => s.setSelected);
  const distance = position ? haversine(position, site) : null;
  const image = site.images?.[0];
  const close = (
    <button className="card-close proto-close" onClick={() => setSelected(null)} aria-label={copy.site.close}>
      ×
    </button>
  );

  if (protoVariant === 'C') {
    return (
      <div className="proto-peek">
        {image ? (
          <img className="row-thumb" src={`${import.meta.env.BASE_URL}${image.url}`} alt="" />
        ) : (
          <span className="row-thumb blank" style={{ background: siteSwatch(site) }} />
        )}
        <div className="proto-peek-main">
          <div className="proto-name">{site.name}</div>
          <div className="card-type">
            {SITE_TYPE_LABELS[site.category]}
            {distance !== null ? copy.site.away(formatDistance(distance)) : ''}
          </div>
        </div>
        <a
          className="btn primary proto-go"
          href={directionsToSite(site, position?.manual ? position : undefined)}
          target="_blank"
          rel="noreferrer"
        >
          {copy.site.directions}
        </a>
        {close}
      </div>
    );
  }

  return (
    <div className="proto-site-head">
      <div className="card-type">
        <span className="dot" style={{ background: siteSwatch(site) }} />
        {SITE_TYPE_LABELS[site.category]}
        {distance !== null ? copy.site.away(formatDistance(distance)) : ''}
      </div>
      <h2 className="card-title">{site.name}</h2>
      {close}
    </div>
  );
}

/** The rest of the site, under the head. */
export function SiteSheetBody({ site }: { site: Site }) {
  const order =
    protoVariant === 'B' ? B_ORDER : ['gallery', ...SITE_BODY_PARTS.filter((p) => p !== 'gallery' && p !== 'header')];
  return (
    <div className="row-body proto-site-body">
      <SiteBody site={site} showHeader={false} collapseDescription={false} order={order as SiteBodyPart[]} />
    </div>
  );
}

/** The floating switch between the variants. */
export function PrototypeSwitcher() {
  if (!import.meta.env.DEV) return null;
  const i = VARIANTS.indexOf(protoVariant);
  const go = (d: number) => {
    const next = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length];
    const url = new URL(location.href);
    url.searchParams.set('variant', next);
    location.href = url.toString();
  };
  return (
    <div className="proto-switcher">
      <button onClick={() => go(-1)} aria-label={copy.prototype.previous}>
        ‹
      </button>
      <span>{copy.prototype.labels[protoVariant]}</span>
      <button onClick={() => go(1)} aria-label={copy.prototype.next}>
        ›
      </button>
    </div>
  );
}
