import { useStore } from '../state/store';
import { showOnMap, stepSheet } from '../state/sheet';
import { SITE_TYPE_LABELS, hybridTitle, siteSwatch, type Site } from '../data/types';
import { formatDistance, haversine } from '../geo/haversine';
import { RowThumb } from './RowThumb';
import { SiteBody } from './SiteDetail';
import { copy } from '../copy';

// The site in the phone sheet (issue #112). The owner chose this design from a
// prototype (variant C, the branch `prototype/110-site-sheet`).
//
// The peek heads an open site at the middle and full heights. It sits in the
// sheet head under the journey bar, in place of the tabs, so a drag on it
// moves the sheet as a drag on the tabs does. It holds one row: a thumbnail,
// the name, the type and distance, and ×. Directions is in the body. It shows
// no number but the distance. The body under it is the card's order without
// its header: the hero picture shows at the middle height, and the full
// height is the page.
//
// At the low height there is no peek. The picture row's middle card is the
// selected site (issue #111), so one site never shows twice.

/** The peek row. A tap on the name raises the sheet one height, as the handle
 *  does. */
export function SitePeek({ site }: { site: Site }) {
  const position = useStore((s) => s.position);
  const sheet = useStore((s) => s.sheet);
  const setSheet = useStore((s) => s.setSheet);
  const closeSite = useStore((s) => s.closeSite);
  const distance = position ? haversine(position, site) : null;

  return (
    <div className="site-peek">
      <RowThumb key={site.id} site={site} />
      <button className="site-peek-main" onClick={() => setSheet(stepSheet(sheet, 1))}>
        <span className="site-peek-name">{site.name}</span>
        <span className="card-type">
          <span className="dot" style={{ background: siteSwatch(site) }} title={hybridTitle(site)} />
          <span className="site-peek-type">{SITE_TYPE_LABELS[site.category]}</span>
          {distance !== null && <span className="site-peek-away">{copy.site.away(formatDistance(distance))}</span>}
        </span>
      </button>
      <button className="site-peek-close" onClick={closeSite} aria-label={copy.site.close}>
        ×
      </button>
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
