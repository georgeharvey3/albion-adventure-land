import { useState } from 'react';
import { useStore } from '../state/store';
import { showOnMap, stepSheet } from '../state/sheet';
import { SITE_TYPE_LABELS, hybridTitle, siteSwatch, type Site } from '../data/types';
import { formatDistance, haversine } from '../geo/haversine';
import { RowThumb } from './RowThumb';
import { SiteBody } from './SiteDetail';
import { Foot, Sliver, takeNudge, variant } from './SiteStep.prototype';
import { copy } from '../copy';

// The site in the phone sheet (issue #112). The owner chose this design from a
// prototype (variant C): a pin tap opens a peek, and a drag up opens the site.
//
// The peek is the low height of the sheet while a site is open. It sits in the
// sheet head under the journey bar, in place of the tabs, so a drag on it
// moves the sheet as a drag on the tabs does. It holds one row: a thumbnail,
// the name, the type and distance, and ×. Directions is in the body. It shows
// no number but the distance. The body under it is the card's order without
// its header: the hero picture shows at the middle height, and the full
// height is the page.

/** The peek row. A tap on the name raises the sheet one height, as the handle
 *  does. PROTOTYPE (#113): the hint that a swipe steps comes from
 *  SiteStep.prototype.tsx. */
export function SitePeek({
  site,
  slideIn = '',
  prevSite,
  nextSite,
  onStep,
}: {
  site: Site;
  slideIn?: string;
  /** The site a step goes to, or undefined at an end. */
  prevSite?: Site;
  nextSite?: Site;
  onStep: (dir: 1 | -1) => void;
}) {
  const position = useStore((s) => s.position);
  const sheet = useStore((s) => s.sheet);
  const setSheet = useStore((s) => s.setSheet);
  const setSelected = useStore((s) => s.setSelected);
  const distance = position ? haversine(position, site) : null;
  const [nudge] = useState(() => !slideIn && !!nextSite && takeNudge());

  return (
    <div className="proto-peek-wrap">
    <div className={`site-peek proto-${variant}${slideIn}${nudge ? ' proto-nudge' : ''}`}>
      <Sliver site={prevSite} side="prev" onStep={() => onStep(-1)} />
      <RowThumb key={site.id} site={site} />
      <button className="site-peek-main" onClick={() => setSheet(stepSheet(sheet, 1))}>
        <span className="site-peek-name">{site.name}</span>
        <span className="card-type">
          <span className="dot" style={{ background: siteSwatch(site) }} title={hybridTitle(site)} />
          <span className="site-peek-type">{SITE_TYPE_LABELS[site.category]}</span>
          {distance !== null && <span className="site-peek-away">{copy.site.away(formatDistance(distance))}</span>}
        </span>
      </button>
      <button className="site-peek-close" onClick={() => setSelected(null)} aria-label={copy.site.close}>
        ×
      </button>
      <Sliver site={nextSite} side="next" onStep={() => onStep(1)} />
    </div>
    <Foot prev={prevSite} next={nextSite} onStep={onStep} />
    </div>
  );
}

/** The rest of the site, under the peek. */
export function SiteSheetBody({ site }: { site: Site }) {
  const setSheet = useStore((s) => s.setSheet);
  return (
    <div className="row-body site-sheet-body">
      <SiteBody
        site={site}
        showHeader={false}
        collapseDescription={false}
        onShowOnMap={() => setSheet(showOnMap(false))}
      />
    </div>
  );
}
