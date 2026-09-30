import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useGeolocation } from '../state/useGeolocation';
import { MapView } from '../map/MapView';
import { NearMeList } from './NearMeList';
import { Filters } from './Filters';
import { SiteDetail } from './SiteDetail';
import { Outing } from './Outing';
import { Stats } from './Stats';
import { JourneyBar } from './JourneyBar';
import { SearchOverlay } from './SearchOverlay';
import { TitleCard } from './TitleCard';
import { DesktopShell } from './DesktopShell';
import { PhoneFinder } from './PhoneFinder';
import { PhoneStrip } from './PhoneStrip';
import { SitePeek, SiteSheetBody } from './SiteSheet';
import { useSidePanel, useWideScreen } from './useWideScreen';
import { useSheetDrag } from './useSheetDrag';
import { loadViewState, saveViewState, type SheetTab } from '../state/viewState';
import { KEY_RANK, onEscape } from '../state/keys';
import {
  coveredBottom,
  listInPlace,
  sameStops,
  sheetStops,
  stepSheet,
  tapTab,
  type SheetStops,
} from '../state/sheet';
import { rowShown } from '../state/phoneStrip';
import { NO_INSETS } from '../map/insets';
import { useKeyLayer } from './useKeyLayer';
import { copy } from '../copy';

const TABS: SheetTab[] = ['near', 'filters', 'outing', 'stats'];

export function App() {
  const init = useStore((s) => s.init);
  const dataLoaded = useStore((s) => s.dataLoaded);
  const dataError = useStore((s) => s.dataError);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const sites = useStore((s) => s.sites);
  const tripCount = useStore((s) => s.outing?.stopIds.length ?? 0);
  const destination = useStore((s) => s.destination);
  const sheet = useStore((s) => s.sheet);
  const setSheet = useStore((s) => s.setSheet);
  const setSelected = useStore((s) => s.setSelected);
  const requestFinder = useStore((s) => s.requestFinder);
  const openSearch = useStore((s) => s.openSearch);
  const insets = useStore((s) => s.coveredInsets);
  const setCoveredInsets = useStore((s) => s.setCoveredInsets);
  // The shell (issue #89): the desktop shell from 1024 px, the sheet below.
  // Both share the store, the map and SiteBody: the phone opens a site in
  // the sheet, the side panel in the card, the desktop in the spread.
  const desktop = useWideScreen();
  // From 760 px the sheet is a side panel on the right of the map. Its middle
  // height is the panel with the floating card, as before issue #110.
  const sidePanel = useSidePanel();
  // On a phone the open site takes the list's place in the sheet (issue #112).
  // At the low height the picture row's middle card is the selected site
  // (issue #111), and the sheet shows the site only once it is opened.
  const phone = !desktop && !sidePanel;
  const siteInSheet = useStore((s) => s.siteInSheet);
  const closeSite = useStore((s) => s.closeSite);
  const openSite =
    phone && siteInSheet && selectedSiteId ? sites.find((x) => x.id === selectedSiteId) : undefined;
  // Reopen on the tab that was open when the app was last closed.
  // A first visit opens on Nearby: "what is close to me now" is the question
  // the app exists to answer.
  const [tab, setTab] = useState<SheetTab>(() => loadViewState().tab ?? 'near');
  // Only until the first dismissal: after that, the reader knows the app.
  const [titleOpen, setTitleOpen] = useState(() => !loadViewState().titleSeen);

  // A tab opens the sheet at the middle height, and the open tab lowers it to
  // free the map (state/sheet.ts).
  const selectTab = (next: SheetTab) => {
    const to = tapTab({ tab, height: sheet }, next);
    setTab(to.tab);
    setSheet(to.height);
  };

  // The three heights in px (issue #110). The low height is the sheet head —
  // the handle, the journey bar and the tabs — so it is measured, not set:
  // the journey bar grows when a journey is set.
  const appRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // The head and the list take the drag (useSheetDrag.ts), so they are held
  // as state: the list mounts and unmounts with the height.
  const [sheetHead, setSheetHead] = useState<HTMLDivElement | null>(null);
  const [sheetBody, setSheetBody] = useState<HTMLDivElement | null>(null);
  const [stops, setStops] = useState<SheetStops | null>(null);
  useLayoutEffect(() => {
    const app = appRef.current;
    const el = sheetRef.current;
    if (!app || !sheetHead || !el) return;
    const measure = () => {
      const border = parseFloat(getComputedStyle(el).borderTopWidth) || 0;
      const low = Math.ceil(sheetHead.getBoundingClientRect().height + border);
      const next = sheetStops(app.clientHeight, low);
      setStops((prev) => (sameStops(prev, next) ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(app);
    observer.observe(sheetHead);
    return () => observer.disconnect();
  }, [sheetHead]);

  const { dragPx, handleProps } = useSheetDrag({
    enabled: !sidePanel,
    sheet,
    setSheet,
    stops,
    head: sheetHead,
    body: sheetBody,
  });
  const dragging = dragPx !== null;
  const sheetPx = dragPx ?? stops?.[sheet] ?? null;
  const inPlace = listInPlace({ height: sheet, dragging, sidePanel });

  // Closing the site on a phone (× or Esc) brings the list back at the height
  // it was at when the site opened (`closeSite` in the store), and at the
  // place it was scrolled to. The list unmounts while the site is open, so
  // its scroll is kept here.
  const listScroll = useRef(0);
  const restoreScroll = useRef(false);
  const hadSite = useRef(false);
  useEffect(() => {
    if (!phone) {
      hadSite.current = false;
      return;
    }
    if (openSite && !hadSite.current) restoreScroll.current = true;
    hadSite.current = !!openSite;
  }, [phone, openSite]);
  // Stable, so React calls it only when the list mounts and unmounts.
  const listBodyRef = useCallback((el: HTMLDivElement | null) => {
    setSheetBody(el);
    if (!el) return;
    if (restoreScroll.current) el.scrollTop = listScroll.current;
    else listScroll.current = 0;
    restoreScroll.current = false;
  }, []);

  // The middle sheet covers the lower half of the map, so a fitted journey or
  // a pin brought into view keeps clear of it, as on the desktop (map/insets.ts).
  // Set when the sheet rests, never during a drag. The desktop shell sets its
  // own insets, and the side panel keeps none, as before.
  //
  // At the low height the phone's picture row (issue #111) is the band at the
  // bottom of the map, so the view box, a fitted journey and a pin brought
  // into view keep clear of it.
  const stripShown = rowShown({ phone, sheet });
  const [stripPx, setStripPx] = useState(0);
  const covered = !desktop && !sidePanel && stops ? coveredBottom(stops, sheet) + stripPx : 0;
  useEffect(() => {
    if (desktop) return;
    setCoveredInsets({ ...NO_INSETS, bottom: covered });
  }, [desktop, covered, setCoveredInsets]);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    saveViewState({ tab });
  }, [tab]);

  // Setting a destination is a question ("what's on the way?"); the near-me
  // list is where it gets answered, so show it rather than leaving the answer
  // behind whichever tab happened to be open. Clearing it changes nothing —
  // the user goes back to what they were doing.
  useEffect(() => {
    if (!destination || desktop) return;
    setTab('near');
    if (sheet === 'low') setSheet('mid');
    // Only a new destination moves the sheet, not a change of shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination]);

  useGeolocation();

  // Keys (issue #88). Esc closes one layer per press, top first — see
  // KEY_RANK. The open site is the selection: on a phone it is in the sheet,
  // on the side panel it floats over the map or is the row open in place, and
  // on a desktop it is the spread.
  useKeyLayer(
    !!selectedSiteId,
    KEY_RANK.card,
    onEscape(() => (phone ? closeSite() : setSelected(null))),
  );
  // Last, the sheet: one height down per press, full to middle to low.
  useKeyLayer(
    !desktop && sheet !== 'low',
    KEY_RANK.sheet,
    onEscape(() => setSheet(stepSheet(sheet, -1))),
  );
  // `/` searches. On a desktop it puts the cursor in the site finder in the
  // card. On a phone it opens the search overlay for the map (issue #109), as
  // the magnifier does.
  useKeyLayer(true, KEY_RANK.list, ({ key }) => {
    if (key !== '/') return false;
    if (desktop) requestFinder();
    else openSearch('map');
    return true;
  });

  return (
    <div
      ref={appRef}
      className={desktop ? 'app desk' : 'app'}
      style={{
        ['--covered-left' as string]: `${insets.left}px`,
        ['--covered-right' as string]: `${insets.right}px`,
        ['--covered-bottom' as string]: `${insets.bottom}px`,
        ['--sheet-low' as string]: stops ? `${stops.low}px` : undefined,
      }}
    >
      {/* The card is positioned inside .map-area so it hugs the bottom of the
          map — i.e. it sits just above the low sheet, and never depends on
          viewport-height math.

          On a phone the map area stops at the low sheet at every height, and
          the raised sheet lies over the map. So the map never resizes during
          a drag, and it stays mounted under the full list: tearing Leaflet
          down would throw away the view the reader is coming back to. */}
      <div className={stripPx ? 'map-area strip-up' : 'map-area'}>
        <MapView desktop={desktop} />
        {/* On a desktop the finder and the chips are in the card. */}
        {!desktop && <PhoneFinder />}
        {phone && <PhoneStrip shown={stripShown} onHeight={setStripPx} />}
        {/* A phone opens the site in the sheet, and a desktop in the spread
            (DesktopShell.tsx). The side panel keeps the floating card. */}
        {selectedSiteId && sidePanel && !desktop && !inPlace && <SiteDetail />}
        {titleOpen && <TitleCard onClosed={() => setTitleOpen(false)} />}
      </div>

      {/* The title card says it for itself while it is up. */}
      {!dataLoaded && !titleOpen && <div className="overlay">{copy.app.loading}</div>}
      {dataError && (
        <div className="overlay error">
          {copy.app.loadFailed.before(dataError)} <code>{copy.app.loadFailed.command}</code>
          {copy.app.loadFailed.after}
        </div>
      )}

      {desktop ? (
        <DesktopShell />
      ) : (
        <>
        <div
          ref={sheetRef}
          className={`sheet at-${sheet}${inPlace ? ' in-place' : ''}${dragging ? ' dragging' : ''}${openSite ? ' site-open' : ''}`}
          style={{ ['--sheet-h' as string]: sheetPx !== null ? `${sheetPx}px` : undefined }}
        >
          {/* The head is the low height, so it shows at every height. The
              journey anchor governs every tab, so it stays with the tabs. An
              open site's peek takes the place of the tabs; the low height
              has none, because the picture row's card is the site. */}
          <div className="sheet-head" ref={setSheetHead}>
            <button
              className="sheet-handle"
              {...handleProps}
              aria-label={sheet === 'full' ? copy.app.collapse : copy.app.expand}
              title={sheet === 'full' ? copy.app.collapse : copy.app.expand}
            >
              <span className="sheet-grip" aria-hidden="true" />
            </button>
            <JourneyBar />
            {openSite ? (
              <SitePeek site={openSite} />
            ) : (
            <nav className="tabs">
              {TABS.map((id) => (
                <button
                  key={id}
                  className={sheet !== 'low' && tab === id ? 'tab active' : 'tab'}
                  onClick={() => selectTab(id)}
                >
                  {copy.app.tabs[id]}
                  {id === 'outing' && tripCount > 0 && (
                    <span className="tab-badge">{tripCount}</span>
                  )}
                </button>
              ))}
            </nav>
            )}
          </div>
          {/* Mounted while a drag lifts the sheet off the low height, so the
              list rises with the finger. */}
          {(sheet !== 'low' || dragging) &&
            (openSite ? (
              // A new site starts at its top.
              <div className="sheet-body" ref={setSheetBody} key={openSite.id}>
                <SiteSheetBody site={openSite} />
              </div>
            ) : (
              <div
                className="sheet-body"
                ref={listBodyRef}
                onScroll={(e) => (listScroll.current = e.currentTarget.scrollTop)}
              >
                {tab === 'near' && <NearMeList inPlace={inPlace} />}
                {tab === 'filters' && <Filters />}
                {tab === 'outing' && <Outing />}
                {tab === 'stats' && <Stats />}
              </div>
            ))}
        </div>

        {/* A panel over the sheet's own footprint, not a full screen: you are
            naming one end of a journey you can still see. */}
        <SearchOverlay />
        </>
      )}
    </div>
  );
}
