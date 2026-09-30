import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import {
  PARENT_CATEGORY_LABELS,
  SITE_TYPE_COLORS,
  SITE_TYPE_LABELS,
  SITE_TYPE_SINGULAR,
  hybridTitle,
  parentOf,
  siteSwatch,
  type Site,
  type SiteEntry,
  type SiteImage,
} from '../data/types';
import { formatDistance, haversine } from '../geo/haversine';
import { directionsToSite, placeLink } from '../links/googleMaps';
import { Lightbox } from './Lightbox';
import { BanIcon, CheckIcon, ClockIcon, FlagIcon, StarIcon } from './icons';
import { OpeningTimes } from './OpeningTimes';
import { PubGradeMark } from './PubGradeMark';
import { SITE_BODY_LAYOUT, type SiteBodyPart } from './siteBodyLayout';
import { copy } from '../copy';

// Selected-site card (map pin / list tap). MVP shows metadata, visited/wishlist
// toggles, and the single-site Google Maps directions handoff (spec F5, F7).
// A fuller per-site page with note + photo arrives in Phase 2 (F11).
//
// The write-up itself lives in `SiteBody`, which is deliberately chrome-free:
// the floating card wraps it, and so does an expanded row in the near-me list's
// browse mode. One site is described in exactly one place.

// Attribution label for the description's source link, keyed off the URL's host
// so new scraped sources don't need a Site schema change.
function sourceLinkLabel(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host.includes('ukclimbing')) return copy.site.viaUkc;
    if (host.includes('camra') || host.includes('heritagepubs') || host.includes('pubheritage'))
      return copy.site.viaCamra;
    return host.replace(/^www\./, '');
  } catch {
    return copy.site.viaUnknown;
  }
}

// A write-up only gets the collapse treatment past this length: anything shorter
// already fits the teaser, so clamping it would hide text with no way to open it.
const DESC_CLAMP_CHARS = 160;
function isCollapsible(description?: string): boolean {
  return !!description && description.length > DESC_CLAMP_CHARS;
}

// Merged write-ups for a place two guidebooks both describe (issue #37). Each
// source keeps its own text under a heading naming the layer it came from —
// "Folklore entry", "Ruins entry" — because the sources say different things
// about the same stone: one carries the legend, the other the fabric and the
// access. Picking a winner would throw half the visit away.
//
// The heading is DERIVED from the entry's category (its parent's label), never
// stored, and its dot is the same colour the layer wears on the map. Collapsed,
// each entry clamps to its own teaser, so the card still says at a glance which
// guidebooks cover this place.
function SiteEntries({ entries, collapsed }: { entries: SiteEntry[]; collapsed: boolean }) {
  return (
    <div className="card-entries">
      {entries.map((entry, i) => (
        <section className="card-entry" key={`${entry.source}-${i}`}>
          <span className="card-entry-label">
            <span className="dot" style={{ background: SITE_TYPE_COLORS[entry.category] }} />
            {copy.site.entry(PARENT_CATEGORY_LABELS[parentOf(entry.category)])}
          </span>
          {entry.description && (
            <p className={collapsed ? 'card-desc collapsed' : 'card-desc'}>{entry.description}</p>
          )}
          {entry.sourceUrl && (
            <p className="card-source">
              {copy.site.via}{' '}
              <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
                {sourceLinkLabel(entry.sourceUrl)} ↗
              </a>
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

// Guidebook pictures for the listing, shown above the write-up. Several pictures
// become a horizontal snap strip rather than a stack, so the card stays short and
// the map stays visible (the same reason the description collapses).
//
// A picture that fails to load is removed instead of leaving a broken-image box:
// the files are shipped as static assets, so a missing one is a deployment gap,
// not something the reader should have to look at.
function SiteGallery({ images }: { images: SiteImage[] }) {
  const [broken, setBroken] = useState<Set<string>>(new Set());
  // Which picture the full-screen viewer is showing, or null when it is closed.
  const [opened, setOpened] = useState<number | null>(null);
  const shown = images.filter((img) => !broken.has(img.url));
  if (!shown.length) return null;

  return (
    <>
      <div className={shown.length > 1 ? 'card-gallery multi' : 'card-gallery'}>
        {shown.map((img, i) => (
          <figure className="card-shot" key={img.url}>
            <button
              className="shot-open"
              onClick={() => setOpened(i)}
              aria-label={img.caption ? copy.site.enlarge(img.caption) : copy.site.enlargePicture}
            >
              <img
                src={`${import.meta.env.BASE_URL}${img.url}`}
                alt={img.caption ?? ''}
                width={img.width}
                height={img.height}
                loading="lazy"
                decoding="async"
                onError={() => setBroken((b) => new Set(b).add(img.url))}
              />
            </button>
            {img.caption && <figcaption>{img.caption}</figcaption>}
          </figure>
        ))}
      </div>
      {opened !== null && (
        <Lightbox images={shown} startIndex={opened} onClose={() => setOpened(null)} />
      )}
    </>
  );
}

/** The spread's lead: the first picture, the width of the page. A picture too
 *  small to fill it sits whole on a dark ground rather than blown up. With no
 *  picture, or one that fails to load, a wash in the site's colour names the
 *  kind of site, as in the strip. A click opens the viewer on every picture. */
function LeadPicture({ site }: { site: Site }) {
  const [broken, setBroken] = useState(false);
  const [opened, setOpened] = useState(false);
  useEffect(() => setBroken(false), [site.id]);
  const images = site.images ?? [];
  const image = images[0];
  if (!image || broken) {
    return (
      <div
        className="spread-lead painted"
        style={{ '--tint': SITE_TYPE_COLORS[site.category] } as React.CSSProperties}
      >
        <i>{SITE_TYPE_SINGULAR[site.category]}</i>
      </div>
    );
  }
  const small = !!image.width && image.width < 600;
  return (
    <div className="spread-lead">
      <button
        className="shot-open"
        onClick={() => setOpened(true)}
        aria-label={image.caption ? copy.site.enlarge(image.caption) : copy.site.enlargePicture}
      >
        <img
          key={image.url}
          className={small ? 'small' : undefined}
          src={`${import.meta.env.BASE_URL}${image.url}`}
          alt={image.caption ?? ''}
          decoding="async"
          onError={() => setBroken(true)}
        />
      </button>
      {image.caption && <p className="spread-caption">{image.caption}</p>}
      {opened && <Lightbox images={images} startIndex={0} onClose={() => setOpened(false)} />}
    </div>
  );
}

interface SiteBodyProps {
  site: Site;
  /** Browse mode only: hands the reader back to the map at this site. Omitted by
   *  the floating card, which is already on the map. */
  onShowOnMap?: () => void;
  /** Type, distance and title. The floating card needs them; an expanded list
   *  row already carries all three in its own header, so it turns them off
   *  rather than saying everything twice. */
  showHeader?: boolean;
  /** Whether the write-up starts as the two-line teaser. The floating card
   *  collapses so the map stays visible; a browse-list row has no map to
   *  protect and opening the row was already the request to read, so it
   *  starts expanded. */
  collapseDescription?: boolean;
  /** The desktop spread (issue #90) lifts the first picture out as the lead,
   *  and lays the parts out in two columns. See siteBodyLayout.ts. */
  variant?: 'card' | 'spread';
}

/** Everything there is to say about one site: pictures, write-up, listing links
 *  and the full action set. No positioning or dismiss chrome of its own — the
 *  caller supplies that. */
export function SiteBody({
  site,
  onShowOnMap,
  showHeader = true,
  collapseDescription = true,
  variant = 'card',
}: SiteBodyProps) {
  const sites = useStore((s) => s.sites);
  const position = useStore((s) => s.position);
  const visited = useStore((s) => s.visited[site.id]);
  const wishlisted = useStore((s) => s.wishlist.has(site.id));
  const hidden = useStore((s) => s.hidden.has(site.id));
  const setSelected = useStore((s) => s.setSelected);
  const revealSite = useStore((s) => s.revealSite);
  const markVisited = useStore((s) => s.markVisited);
  const unmarkVisited = useStore((s) => s.unmarkVisited);
  const toggleWishlist = useStore((s) => s.toggleWishlist);
  const toggleHidden = useStore((s) => s.toggleHidden);
  const inTrip = useStore((s) => !!s.outing?.stopIds.includes(site.id));
  const addToTrip = useStore((s) => s.addToTrip);
  const removeFromTrip = useStore((s) => s.removeFromTrip);
  const destination = useStore((s) => s.destination);
  const setDestination = useStore((s) => s.setDestination);
  const setDestinationFromSite = useStore((s) => s.setDestinationFromSite);
  const isDestination = destination?.siteId === site.id;

  // On the map the write-up starts as the teaser so the card stays short and the
  // map stays visible; the reader opens it when they want it. A short
  // description has no toggle, so it is never clamped. Fresh selection returns
  // to the caller's default.
  // A merged site (issue #37) is described by every source that lists it, and
  // the whole stack shares one toggle — so the length that decides whether it
  // collapses is the length of all of it.
  const writeUp = site.entries
    ? site.entries.map((e) => e.description ?? '').join(' ')
    : site.description;
  const collapsible = isCollapsible(writeUp);
  const startCollapsed = collapseDescription && collapsible;
  const [descCollapsed, setDescCollapsed] = useState(startCollapsed);
  useEffect(() => {
    setDescCollapsed(collapseDescription && isCollapsible(writeUp));
  }, [site.id, writeUp, collapseDescription]);

  const distance = position ? haversine(position, site) : null;
  // The spread shows the first picture as its lead, so its gallery is the rest.
  const images = site.images ?? [];
  const gallery = variant === 'spread' ? images.slice(1) : images;

  // Listing links (derived data). A sub-feature points back to its listing's main
  // write-up; a main point lists the features grouped under it.
  const parent = site.parentId ? sites.find((x) => x.id === site.parentId) : undefined;
  const children = site.parentId ? [] : sites.filter((x) => x.parentId === site.id);
  // Revealed first, like a site the finder found: a listing member on a layer
  // that is switched off has no pin and no row, so it would open to nothing.
  const openRelated = (id: string) => {
    revealSite(id);
    setSelected(id);
  };

  const parts: Record<SiteBodyPart, ReactNode> = {
    header: showHeader && (
      <>
        <div className="card-type">
          <span
            className="dot"
            style={{ background: siteSwatch(site) }}
            title={hybridTitle(site)}
          />
          {SITE_TYPE_LABELS[site.category]}
          {distance !== null ? copy.site.away(formatDistance(distance)) : ''}
        </div>
        <h2 className="card-title">{site.name}</h2>
      </>
    ),
    // Outside the header on purpose: the grade is a fact about the pub, not a
    // repeat of the type/distance line, so a browse row — which draws its own
    // header and turns this one off — still shows it.
    grade: <PubGradeMark site={site} />,
    badges: (
      <>
        {visited && (
          <div className="badge visited">
            <CheckIcon /> {copy.site.visitedOn(visited.visitedAt.slice(0, 10))}
          </div>
        )}
        {wishlisted && !visited && (
          <div className="badge wish">
            <StarIcon filled /> {copy.site.wishlist}
          </div>
        )}
        {hidden && (
          <div className="badge">
            <BanIcon /> {copy.site.hidden}
          </div>
        )}
      </>
    ),
    partOf: parent && (
      <p className="card-listing">
        {copy.site.partOf}{' '}
        <button className="link" onClick={() => openRelated(parent.id)}>
          {parent.listingTitle ?? parent.name}
        </button>
      </p>
    ),
    walkTime: site.walkTime && (
      <p className="card-meta">
        <ClockIcon /> {copy.site.walkIn(site.walkTime)}
      </p>
    ),
    access: site.access && <p className="card-meta">{copy.site.access(site.access)}</p>,
    hours: <OpeningTimes site={site} />,
    gallery: gallery.length > 0 && <SiteGallery images={gallery} />,
    writeUp: (
      <>
        {site.entries ? (
          <SiteEntries entries={site.entries} collapsed={descCollapsed} />
        ) : (
          site.description && (
            <p className={descCollapsed ? 'card-desc collapsed' : 'card-desc'}>
              {site.description}
            </p>
          )
        )}
        {/* The spread has the room for the whole write-up, and never clamps. */}
        {collapsible && variant === 'card' && (
          <button
            className="desc-toggle"
            onClick={() => setDescCollapsed((c) => !c)}
            aria-expanded={!descCollapsed}
          >
            {descCollapsed ? copy.site.showMore : copy.site.showLess}
          </button>
        )}
      </>
    ),
    // A merged site carries its attribution inside each entry, next to the
    // text that came from it.
    source: !site.entries && site.sourceUrl && (
      <p className="card-source">
        {copy.site.via}{' '}
        <a href={site.sourceUrl} target="_blank" rel="noreferrer">
          {sourceLinkLabel(site.sourceUrl)} ↗
        </a>
      </p>
    ),
    listing: children.length > 0 && (
      <div className="card-listing">
        <span className="card-listing-label">{copy.site.nearbyInListing}</span>
        <ul className="listing-children">
          {children.map((c) => (
            <li key={c.id}>
              <button className="link" onClick={() => openRelated(c.id)}>
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    ),
    actions: (
      <div className="card-actions">
        <a
          className="btn primary"
          href={directionsToSite(site, position?.manual ? position : undefined)}
          target="_blank"
          rel="noreferrer"
        >
          {copy.site.directions}
        </a>
        {/* Browse mode hides the map, so the way back to it is an explicit
            action rather than a mode the reader has to remember to leave. */}
        {onShowOnMap && (
          <button className="btn" onClick={onShowOnMap}>
            {copy.site.showOnMap}
          </button>
        )}
        {site.postcode && (
          <a
            className="btn"
            href={placeLink({ ...site, postcode: site.postcode })}
            target="_blank"
            rel="noreferrer"
          >
            {copy.site.viewOnGoogle}
          </a>
        )}
        {visited ? (
          <button className="btn" onClick={() => unmarkVisited(site.id)}>
            {copy.site.unmarkVisited}
          </button>
        ) : (
          <button className="btn" onClick={() => markVisited(site.id)}>
            {copy.site.markVisited}
          </button>
        )}
        <button className="btn" onClick={() => toggleWishlist(site.id)}>
          {wishlisted ? <StarIcon filled /> : <StarIcon />}{' '}
          {wishlisted ? copy.site.onWishlist : copy.site.wishlist}
        </button>
        <button className="btn" onClick={() => toggleHidden(site.id)}>
          <BanIcon /> {hidden ? copy.site.unhide : copy.site.hide}
        </button>
        {/* The common road-trip entry point (issue #14): "I'm driving to this
            castle — what's on the way?" Needs no position of its own; the
            journey's From end is whatever anchor the app already has. */}
        {isDestination ? (
          <button className="btn dest on" onClick={() => setDestination(null)}>
            <FlagIcon /> {copy.site.destination}
          </button>
        ) : (
          <button className="btn dest" onClick={() => setDestinationFromSite(site.id)}>
            <FlagIcon /> {copy.site.setDestination}
          </button>
        )}
        {/* Trip = today's ordered subset. Adding needs a position to order the
            route from (spec: require a position); without one the button is
            disabled rather than silently doing nothing. The button state itself
            is the "added" confirmation — the Outing tab carries the count. */}
        {isDestination ? (
          // Already the route's fixed final stop (issue #15) — adding it as a
          // via as well would just visit it twice.
          <button className="btn trip" disabled title={copy.site.alreadyEnd}>
            {copy.site.addToTrip}
          </button>
        ) : inTrip ? (
          <button className="btn trip on" onClick={() => removeFromTrip(site.id)}>
            <CheckIcon /> {copy.site.inTrip}
          </button>
        ) : (
          <button
            className="btn trip"
            onClick={() => addToTrip(site.id)}
            disabled={!position}
            title={position ? undefined : copy.site.needsLocation}
          >
            {copy.site.addToTrip}
          </button>
        )}
      </div>
    ),
  };
  const place = (names: readonly SiteBodyPart[]) =>
    names.map((name) => <Fragment key={name}>{parts[name]}</Fragment>);

  if (variant === 'card') return <>{place(SITE_BODY_LAYOUT.card)}</>;
  const { main, side } = SITE_BODY_LAYOUT.spread;
  return (
    <>
      <LeadPicture site={site} />
      <div className="spread-body">
        <div className="spread-main">{place(main)}</div>
        <div className="spread-side">{place(side)}</div>
      </div>
    </>
  );
}

export function SiteDetail() {
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const sites = useStore((s) => s.sites);
  const site = sites.find((x) => x.id === selectedSiteId);
  const setSelected = useStore((s) => s.setSelected);

  if (!site) return null;

  return (
    <div className="card" role="dialog" aria-label={site.name}>
      <button className="card-close" onClick={() => setSelected(null)} aria-label={copy.site.close}>
        ×
      </button>
      <SiteBody site={site} />
    </div>
  );
}
