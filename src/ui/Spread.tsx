import { forwardRef, useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { stripNeighbours } from '../state/strip';
import { KEY_RANK } from '../state/keys';
import { useKeyLayer } from './useKeyLayer';
import { SiteBody } from './SiteDetail';
import { useStrip } from './Strip';
import { copy } from '../copy';

// The spread (issue #90): the desktop shell's site page, on the right of the
// map, in place of the phone's floating card. It wraps the same `SiteBody` as
// the card and the browse row, in its spread layout (siteBodyLayout.ts), so
// the three always show the same content for a site.
//
// Prev and Next step through the order of the strip, and name the site they
// go to. The map holds the strip's order while the spread is open (MapView.tsx),
// so a step never re-sorts the strip under the user.
//
// The shell measures the spread as the covered inset on the right, so the map
// pans the site into the part of the view that shows, and the plate fence
// lets the edge of the plate go under the spread.

export const Spread = forwardRef<HTMLElement>(function Spread(_props, ref) {
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const sites = useStore((s) => s.sites);
  const setSelected = useStore((s) => s.setSelected);
  const site = sites.find((x) => x.id === selectedSiteId);

  const strip = useStrip();
  const ids = strip.kind === 'sites' ? strip.views.map((v) => v.site.id) : [];
  const { prev, next } = site ? stripNeighbours(ids, site.id) : { prev: null, next: null };
  const nameOf = (id: string | null) => (id ? sites.find((x) => x.id === id)?.name : undefined);
  const prevName = nameOf(prev);
  const nextName = nameOf(next);

  // A new site starts at the top of the page.
  const pageRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    pageRef.current?.scrollTo({ top: 0 });
  }, [selectedSiteId]);

  // In the spread the arrow keys and `j` and `k` step through the strip
  // (issue #87, Q15). Esc is the card's layer in App.tsx.
  useKeyLayer(!!site, KEY_RANK.card, ({ key }) => {
    const to =
      key === 'ArrowLeft' || key === 'k' ? prev : key === 'ArrowRight' || key === 'j' ? next : undefined;
    if (to === undefined) return false;
    if (to) setSelected(to);
    return true;
  });

  if (!site) return null;

  return (
    <article
      ref={(el) => {
        pageRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      className="spread"
      aria-label={site.name}
    >
      <nav className="spread-top">
        {prev && (
          <button
            className="spread-step"
            onClick={() => setSelected(prev)}
            aria-label={copy.near.previousSite(prevName ?? '')}
          >
            <b>{copy.near.previous}</b> {prevName}
          </button>
        )}
        {next && (
          <button
            className="spread-step"
            onClick={() => setSelected(next)}
            aria-label={copy.near.nextSite(nextName ?? '')}
          >
            <b>{copy.near.next}</b> {nextName}
          </button>
        )}
        <button className="spread-close" onClick={() => setSelected(null)} aria-label={copy.site.close}>
          ×
        </button>
      </nav>
      <SiteBody key={site.id} site={site} variant="spread" collapseDescription={false} />
    </article>
  );
});
