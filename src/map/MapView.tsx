import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { categoryColorsOf, SITE_TYPE_COLORS, type SiteCategory } from '../data/types';
import { useStore } from '../state/store';
import { useFilteredSites, type FilteredSiteView } from '../state/selectors';
import { shapeMarker, type MarkerShape, type ShapeMarkerOptions } from './shapeMarker';
import { corridorEllipse } from '../geo/corridor';
import { OSRM_ATTRIBUTION } from '../geo/osrm';
import { loadViewState, saveViewState } from '../state/viewState';
import { BASEMAP_IDS, basemapLabel, createBasemap, type BasemapId } from './basemaps';
import { iconMarkup } from '../ui/icons';
import { COMPASS_ROSE } from './compassRose';
import { GlowLayer, glowAmount } from './glowLayer';
import { pinScale, SPECK_BELOW } from './zoomScale';
import { fenceToPlate, PLATE_BOUNDS, PLATE_MIN_ZOOM } from './plate';
import { openCentre } from './insets';
import { KEY_RANK, onEscape } from '../state/keys';
import { PinPeek } from './pinPeek';
import { registerKeyLayer } from '../ui/useKeyLayer';
import { copy } from '../copy';
import { pinSheet } from '../state/sheet';
import { protoList, protoPinHeight, siteInSheet } from '../ui/SiteSheet.prototype';
import { useSidePanel } from '../ui/useWideScreen';

// Leaflet map (spec §6 F2): pins coloured by type, live location dot + accuracy
// ring, and a "drop pin" fallback when geolocation is unavailable. Uses Leaflet
// directly (no react-leaflet) to keep the dependency surface minimal.
//
// Performance: ~2,600 pins. All markers are canvas-drawn (preferCanvas + the
// shapeMarker subclass — no per-marker DOM), the marker set is rebuilt only
// when the filter or visited/wishlist state changes (never on a GPS tick), and
// selecting a pin restyles just the two markers involved.

const GB_CENTER: L.LatLngTuple = [53.0, -3.5];

/** Padding that also keeps clear of the covered insets, so a fitted journey
 *  or trip, or a pin brought into view, never lands under the chrome. */
function fitPadding(pad: number): L.FitBoundsOptions & L.PanInsideOptions {
  const { top, right, bottom, left } = useStore.getState().coveredInsets;
  return { paddingTopLeft: [pad + left, pad + top], paddingBottomRight: [pad + right, pad + bottom] };
}

// Leaflet's vector options take a colour string, not a CSS variable, so the
// accent has to be resolved out of the token layer once and cached. Reading it
// rather than repeating the hex is what stopped the route lines drifting a
// shade away from the rest of the app the last time the palette moved.
let accentCache: string | null = null;
function accent(): string {
  if (accentCache === null) {
    accentCache =
      getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() ||
      '#216448';
  }
  return accentCache;
}

// Shape encodes the top-level category: pubs are squares, wild swims are
// triangles, ruins are diamonds, scrambles are mountain chevrons, folklore
// sites stay as circles — distinguishable without colour.
function shapeFor(category: SiteCategory): MarkerShape {
  switch (category) {
    case 'historic_pubs':
      return 'square';
    case 'wild_swims':
      return 'triangle';
    case 'ruins':
      return 'diamond';
    case 'scrambles':
      return 'chevron';
    default:
      return 'circle';
  }
}

// One styling scheme for all shapes. Visited sites keep their category colour
// (they are not hidden or dimmed — visiting a place doesn't take it off the
// map), marked only by a dark ring. Wishlisted gets an orange ring; selected is
// larger.
//
// At national zoom (issue #74) the pins shrink toward specks over the glow, by
// `scale` from pinScale. Below SPECK_BELOW a pin loses its ring and stops
// taking taps: a pin with a ring is a pin you can tap. A speck is a few pixels
// across, far smaller than a finger, and they crowd, so a tap there opened
// whatever card it hit when the user meant to pan, and swallowed the tap that
// drops a location pin. The selected pin never shrinks — it is the one the
// open card is about.
//
// A cross-source merge (issue #37) gets a HYBRID pin: the shape is still the
// representative's, but the fill is striped across every category the place
// answers to, so Old Sarum reads as ruins *and* hillfort under either filter.
// `fillColor` stays set for the single-colour case and as the fallback if the
// map ever runs on the SVG renderer, where the stripes aren't drawn.
//
// A lifted pin (issue #88) — under the mouse, or the pin of the list row under
// the mouse or the keyboard cursor — grows a little and takes a heavier ring.
// A speck does not lift: it takes no tap, so it takes no hover either.
function markerStyle(
  view: FilteredSiteView,
  selected: boolean,
  scale: number,
  lifted = false,
): ShapeMarkerOptions {
  const { site, visited, wishlisted } = view;
  const shape = shapeFor(site.category);
  const base = shape === 'triangle' || shape === 'diamond' || shape === 'chevron' ? 7.5 : 6;
  const colors = categoryColorsOf(site);
  // A merged pin is a fraction wider: two colours inside 12px of shape need the
  // room, and there are 33 of them on a map of ~2,600, so nothing is crowded.
  const radius = colors.length > 1 ? base + 1 : base;
  const speck = !selected && scale < SPECK_BELOW;
  const lift = lifted && !speck ? 1 : 0;
  return {
    radius: selected ? radius + 3 : Math.max(1.5, radius * scale) + lift * 2.5,
    color: wishlisted ? '#f4a261' : visited ? '#2a2a2a' : '#fff',
    weight: speck ? 0 : (wishlisted ? 3 : visited ? 2 : 1.5) + lift,
    interactive: !speck,
    fillColor: SITE_TYPE_COLORS[site.category],
    fillColors: colors,
    fillOpacity: 0.95,
  };
}

// A hover effect needs a mouse. On a touch screen a tap can send a synthetic
// mouseover, and a peek left behind by a tap is noise (issue #87, Q9).
function canHover(): boolean {
  return window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
}

// "You are here" iconography. Blue is reserved for the user across the app —
// no site category uses this hue at this size — and the pulse is the only
// animated thing on the map, so the marker is identifiable at a glance.
const ME_BLUE = '#1a73e8';

const LIVE_ICON = L.divIcon({
  className: 'me-marker me-marker--live',
  html: '<span class="me-pulse"></span><span class="me-dot"></span>',
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});

// A dropped pin is a different claim from a GPS fix ("I said I'm here"), so it
// gets the classic teardrop, anchored at its tip rather than its centre.
const MANUAL_ICON = L.divIcon({
  className: 'me-marker me-marker--manual',
  html:
    '<svg viewBox="0 0 24 34" width="26" height="36" aria-hidden="true">' +
    '<path d="M12 1.5C6.2 1.5 1.5 6.2 1.5 12c0 7.6 8.4 17.6 10.5 20.1C14.1 29.6 22.5 19.6 22.5 12 22.5 6.2 17.8 1.5 12 1.5Z" fill="#e76f51" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>' +
    '<circle cx="12" cy="11.8" r="3.8" fill="#fff"/>' +
    '</svg>',
  iconSize: [26, 36],
  iconAnchor: [13, 35],
});

// Where the controls sit. Zoom and basemap stack at the top right in both
// shells: the desktop card has the top left, and on a phone the floating
// finder spans the top, so the CSS moves the corner down under it (issue
// #109). Locate is at the bottom right on a phone, in thumb reach, and joins
// the column on a desktop. A top corner stacks down in the order the controls
// are placed.
type ControlSet = { zoom: L.Control; basemap: L.Control; locate: L.Control };
function placeControls({ zoom, basemap, locate }: ControlSet, desktop: boolean) {
  zoom.setPosition('topright');
  basemap.setPosition('topright');
  locate.setPosition(desktop ? 'topright' : 'bottomright');
}

export function MapView({ desktop }: { desktop: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const siteLayerRef = useRef<L.LayerGroup | null>(null);
  const meLayerRef = useRef<L.LayerGroup | null>(null);
  const outingLayerRef = useRef<L.LayerGroup | null>(null);
  const corridorLayerRef = useRef<L.LayerGroup | null>(null);
  const locateBtnRef = useRef<HTMLButtonElement | null>(null);
  const didFitRef = useRef(false);
  const basemapRef = useRef<L.LayerGroup | null>(null);
  const outingFitKeyRef = useRef<string | null>(null);
  const journeyFitKeyRef = useRef<string | null>(null);
  const markersRef = useRef(new Map<string, { marker: L.CircleMarker; view: FilteredSiteView }>());
  const prevSelectedRef = useRef<string | null>(null);
  const glowRef = useRef<GlowLayer | null>(null);
  // The pin scale the markers were last styled at. Styling ~2,600 markers is
  // only worth doing when a zoom has actually changed it.
  const pinScaleRef = useRef(1);
  const peekRef = useRef<PinPeek | null>(null);
  const prevLiftedRef = useRef<string | null>(null);
  const controlsRef = useRef<ControlSet | null>(null);
  // Set the fence again, and report the view again, after the covered insets
  // change. Both are set up with the map.
  const refenceRef = useRef<(() => void) | null>(null);
  const reportViewRef = useRef<(() => void) | null>(null);
  // While the spread is open, the strip keeps the view it had when the site
  // opened (issue #90), so Prev and Next walk one fixed order. The spread's own
  // pan and its covered inset report nothing. A drag, a zoom or a search move
  // by the user ends the hold, and the strip follows the map again.
  const holdViewRef = useRef(false);

  const views = useFilteredSites();
  const position = useStore((s) => s.position);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const setSelected = useStore((s) => s.setSelected);
  // A pin tap on a phone (issue #110) also lowers the sheet off the middle
  // height, so the site opens in the floating card over the map
  // (state/sheet.ts). The height is set first: both updates land in one
  // render, so the card is there when the pan below looks for it. The pins
  // are built in effects, so they call it through a ref.
  const sidePanel = useSidePanel();
  const pickPin = useRef((_id: string) => {});
  pickPin.current = (id: string) => {
    if (!desktop) {
      const { sheet, setSheet, selectedSiteId } = useStore.getState();
      if (siteInSheet && !sidePanel) {
        // PROTOTYPE: the site opens in the sheet.
        if (!selectedSiteId) protoList.height = sheet;
        setSheet(protoPinHeight());
      } else setSheet(pinSheet(sheet, sidePanel));
    }
    setSelected(id);
  };
  const setPosition = useStore((s) => s.setPosition);
  const sites = useStore((s) => s.sites);
  const outing = useStore((s) => s.outing);
  const destination = useStore((s) => s.destination);
  const route = useStore((s) => s.route);
  const detourBudget = useStore((s) => s.detourBudget);
  const picking = useStore((s) => s.picking);
  const focus = useStore((s) => s.focus);
  const setDestination = useStore((s) => s.setDestination);
  const lifted = useStore((s) => s.lifted);
  const setLifted = useStore((s) => s.setLifted);
  const dropLifted = useStore((s) => s.dropLifted);
  const coveredInsets = useStore((s) => s.coveredInsets);
  const setViewport = useStore((s) => s.setViewport);

  /** Restyle one pin for the store's selection and lift, at the current pin
   *  scale. A loop over every pin passes the store state in, read once. */
  const restylePin = (id: string | null, state = useStore.getState()) => {
    const entry = id ? markersRef.current.get(id) : undefined;
    if (!entry) return;
    const { selectedSiteId: selectedId, lifted: lift } = state;
    entry.marker.setStyle(
      markerStyle(entry.view, id === selectedId, pinScaleRef.current, id === lift?.id),
    );
  };

  // One-time map init.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    // Restore where the user last was. Without this, reopening the installed
    // PWA (iOS cold-starts it after a few minutes in the background) always
    // came back at the whole-of-Britain view.
    const saved = loadViewState().map;
    // The map's own zoom floor. Without one Leaflet takes it from the tile
    // layers, and the topo sheet starts at z11 (it hands the overview to the
    // watercolor), so the first view snapped to z11 as the basemap was added.
    // The floor is refined below, once the map knows its size.
    //
    // The map ends at the plate (fenceToPlate, plate.ts). A drag stops dead
    // at its edge instead of springing back.
    const map = L.map(containerRef.current, {
      zoomControl: true,
      preferCanvas: true,
      minZoom: PLATE_MIN_ZOOM,
      maxBoundsViscosity: 1,
    }).setView(
      saved ? [saved.lat, saved.lng] : GB_CENTER,
      saved ? saved.zoom : 6,
    );
    // Zoomed all the way out, the whole plate fits the screen and fills it one
    // way. Never further out, where Britain would shrink to a stamp.
    const fitFloor = () => {
      const size = map.getSize();
      if (!size.x || !size.y) return;
      map.setMinZoom(Math.max(PLATE_MIN_ZOOM, map.getBoundsZoom(PLATE_BOUNDS)));
    };
    fitFloor();
    map.on('resize', fitFloor);
    // The fence knows the covered insets (issue #87, Q19): the edge of the
    // plate can go under the strip or the drawer, never into the part of the
    // map that shows.
    refenceRef.current = fenceToPlate(map, () => useStore.getState().coveredInsets);
    // A restored view is the user's view — don't let the fit-to-all-pins pass
    // below throw it away once the site data lands.
    if (saved) didFitRef.current = true;
    mapRef.current = map;
    // Atlas is the map drawn for the app, so a first visit opens on it.
    let basemapId: BasemapId = loadViewState().basemap ?? 'atlas';
    basemapRef.current = createBasemap(basemapId).addTo(map);
    // The CSS reads it: the desktop shell keeps the paper finish for Atlas.
    map.getContainer().dataset.basemap = basemapId;

    // Dedicated panes for the "you are here" marker. The accuracy ring sits
    // *below* the site pins (it's a translucent wash — it must not tint them),
    // and the marker itself sits above every other overlay, including the
    // numbered outing stops in the default marker pane (z-index 600). It stays
    // under the tooltip pane (650) so its own label still reads on top.
    map.createPane('meAccuracyPane').style.zIndex = '350';

    // The national-zoom glow (issue #74), under every overlay and the pins.
    // Its opacity follows the zoom, and it starts fading with the zoom
    // animation (`zoomanim` carries the target zoom), so the pins and the glow
    // change together instead of one after the other.
    const glowPane = map.createPane('glowPane');
    glowPane.style.zIndex = '390';
    glowPane.style.pointerEvents = 'none';
    glowRef.current = new GlowLayer({ pane: 'glowPane' }).addTo(map);
    const fadeGlow = (zoom: number) => {
      glowPane.style.opacity = String(glowAmount(zoom));
    };
    map.on('zoomanim', (e: L.ZoomAnimEvent) => fadeGlow(e.zoom));
    map.on('zoom', () => fadeGlow(map.getZoom()));
    fadeGlow(map.getZoom());
    const mePane = map.createPane('mePane');
    mePane.style.zIndex = '645';
    // The pulse halo is decorative and much wider than the dot: let taps on
    // pins underneath through (the dot itself re-enables pointer events).
    mePane.style.pointerEvents = 'none';

    // The old-map finish (issue #73): paper grain and a soft vignette. They sit
    // in their own pane between the tiles (200) and everything drawn on the
    // map, so they age the paper without dulling a single pin. A pane scrolls
    // with the map, so the finish is pinned back to the viewport on every move.
    const finishPane = map.createPane('finishPane');
    finishPane.style.zIndex = '250';
    finishPane.style.pointerEvents = 'none';
    const finish = L.DomUtil.create('div', 'map-finish', finishPane);
    L.DomUtil.create('div', 'map-grain', finish);
    L.DomUtil.create('div', 'map-vignette', finish);
    const pinFinish = () => {
      const size = map.getSize();
      finish.style.width = `${size.x}px`;
      finish.style.height = `${size.y}px`;
      L.DomUtil.setPosition(finish, map.containerPointToLayerPoint([0, 0]));
    };
    map.on('move zoom viewreset resize', pinFinish);
    pinFinish();

    // Scale bar and compass rose, stacked in the bottom-left corner like the
    // key of a printed sheet. Metric, because every distance in the app is.
    // Bottom corners stack upward, so the rose, added second, sits on top.
    L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 96 }).addTo(map);
    const CompassCtl = L.Control.extend({
      options: { position: 'bottomleft' as L.ControlPosition },
      onAdd() {
        const rose = L.DomUtil.create('div', 'compass-rose');
        rose.setAttribute('aria-hidden', 'true');
        rose.innerHTML = COMPASS_ROSE;
        return rose;
      },
    });
    map.addControl(new CompassCtl());

    // Corridor first so its shaded ellipse sits under the pins, not over them.
    corridorLayerRef.current = L.layerGroup().addTo(map);
    siteLayerRef.current = L.layerGroup().addTo(map);
    outingLayerRef.current = L.layerGroup().addTo(map);
    meLayerRef.current = L.layerGroup().addTo(map);

    // Basemap switcher. Street is the plain map everyone knows; Atlas is the
    // map drawn for the app — a painted plate at country scale that turns into
    // a topo sheet as you zoom in; satellite imagery answers what the place
    // looks like when you arrive — how big that pool really is, where a track
    // pulls in, how much tree cover sits over a fall. Three is one too many for
    // a toggle, so the button opens a short menu. The choice is remembered
    // across launches, and the service worker caches every provider, so a
    // region browsed on any layer stays available with no signal.
    // Released on unmount too, or an open menu's layer would outlive the map
    // and take every Esc from then on.
    let dropMenuKeys: (() => void) | null = null;
    const BasemapCtl = L.Control.extend({
      options: { position: 'topright' as L.ControlPosition },
      onAdd() {
        const root = L.DomUtil.create('div', 'basemap-ctl');
        const btn = L.DomUtil.create('button', 'drop-pin-btn basemap-btn', root);
        btn.type = 'button';
        btn.innerHTML = iconMarkup('layers', 20);
        btn.title = copy.map.layers;
        btn.setAttribute('aria-label', copy.map.layers);
        btn.setAttribute('aria-haspopup', 'menu');
        const menu = L.DomUtil.create('div', 'basemap-menu', root);
        menu.setAttribute('role', 'menu');
        menu.hidden = true;
        const items = BASEMAP_IDS.map((id) => {
          const item = L.DomUtil.create('button', 'basemap-item', menu);
          item.type = 'button';
          item.setAttribute('role', 'menuitemradio');
          item.innerHTML = `<span>${basemapLabel(id)}</span>${iconMarkup('check', 16)}`;
          L.DomEvent.on(item, 'click', () => {
            pick(id);
            setOpen(false);
            btn.focus();
          });
          return { id, item };
        });
        const paint = () => {
          for (const { id, item } of items) item.setAttribute('aria-checked', String(id === basemapId));
        };
        const onOutside = (e: PointerEvent) => {
          if (!root.contains(e.target as Node)) setOpen(false);
        };
        // The open menu is the top key layer: Esc shuts it before anything else.
        const setOpen = (open: boolean) => {
          menu.hidden = !open;
          btn.setAttribute('aria-expanded', String(open));
          btn.classList.toggle('active', open);
          dropMenuKeys?.();
          dropMenuKeys = null;
          if (open) {
            document.addEventListener('pointerdown', onOutside, true);
            dropMenuKeys = registerKeyLayer({
              rank: KEY_RANK.menu,
              onKey: onEscape(() => {
                setOpen(false);
                btn.focus();
              }),
            });
            items.find((i) => i.id === basemapId)?.item.focus();
          } else {
            document.removeEventListener('pointerdown', onOutside, true);
          }
        };
        const pick = (id: BasemapId) => {
          if (id === basemapId) return;
          basemapId = id;
          // Add the replacement before removing the old one: dropping the only
          // tile layer first flashes the bare container between the two.
          const prev = basemapRef.current;
          basemapRef.current = createBasemap(basemapId).addTo(map);
          if (prev) map.removeLayer(prev);
          map.getContainer().dataset.basemap = basemapId;
          saveViewState({ basemap: basemapId });
          paint();
        };
        paint();
        setOpen(false);
        L.DomEvent.disableClickPropagation(root);
        L.DomEvent.disableScrollPropagation(root);
        L.DomEvent.on(btn, 'click', () => setOpen(menu.hidden));
        return root;
      },
    });
    const basemapCtl = new BasemapCtl();
    map.addControl(basemapCtl);

    // "Zoom to me" control — bottom right, in thumb reach on a phone. It only
    // recentres; it never asks for a fix, so it is hidden until a location
    // exists (a live GPS fix or a manual pin) — see the effect below.
    const LocateCtl = L.Control.extend({
      options: { position: 'bottomright' as L.ControlPosition },
      onAdd() {
        const btn = L.DomUtil.create('button', 'drop-pin-btn locate-btn');
        btn.type = 'button';
        btn.title = copy.map.zoomToMe;
        // Icon-only control, so it carries its own label (see ui/icons.tsx).
        btn.setAttribute('aria-label', copy.map.zoomToMe);
        btn.innerHTML = iconMarkup('locateFixed', 20);
        btn.hidden = !useStore.getState().position;
        locateBtnRef.current = btn;
        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.on(btn, 'click', () => {
          const pos = useStore.getState().position;
          if (!pos) return;
          // Zoom in to a street-level view, but never zoom the user back out
          // if they are already closer in.
          map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 14));
        });
        return btn;
      },
    });
    const locateCtl = new LocateCtl();
    map.addControl(locateCtl);
    controlsRef.current = { zoom: map.zoomControl, basemap: basemapCtl, locate: locateCtl };

    // Specks take no tap (issue #74), so a tap on one would do nothing and look
    // broken. Say why instead. Only a tap near a speck counts: a tap on the
    // open sea is not an attempt to open a pin, and a hint there is noise.
    peekRef.current = new PinPeek(map.getContainer());

    const hint = L.DomUtil.create('div', 'map-hint', map.getContainer());
    hint.setAttribute('role', 'status');
    hint.hidden = true;
    let hintTimer: number | undefined;
    const hideHint = () => {
      window.clearTimeout(hintTimer);
      hint.hidden = true;
    };
    const showHint = () => {
      hint.textContent = copy.map.zoomToTap;
      hint.hidden = false;
      window.clearTimeout(hintTimer);
      hintTimer = window.setTimeout(hideHint, 2500);
    };
    map.on('zoomend', () => {
      if (pinScale(map.getZoom()) >= SPECK_BELOW) hideHint();
    });
    const nearSpeck = (at: L.Point) => {
      for (const { marker } of markersRef.current.values()) {
        if (marker.options.interactive) continue;
        if (map.latLngToContainerPoint(marker.getLatLng()).distanceTo(at) <= 20) return true;
      }
      return false;
    };

    map.on('click', (e: L.LeafletMouseEvent) => {
      const { picking: armed } = useStore.getState();
      if (!armed) {
        if (pinScale(map.getZoom()) < SPECK_BELOW && nearSpeck(e.containerPoint)) showHint();
        return;
      }
      const { lat, lng } = e.latlng;
      // Origin: a dropped "I am here" pin, which carries no label — the bar
      // calls it "Dropped pin" and the marker is the teardrop, both of which
      // say more than a pair of coordinates would.
      if (armed === 'origin') {
        setPosition({ lat, lng, accuracy: 0, manual: true });
        return;
      }
      // Destination (issue #14). No reverse geocoding is available offline, so
      // an arbitrary map point is labelled by its coordinates.
      setDestination({ lat, lng, label: `${lat.toFixed(3)}, ${lng.toFixed(3)}` });
    });

    // Remember the viewport. `moveend` covers zooms too and only fires once a
    // gesture (or a programmatic fitBounds) has settled, so this is cheap; the
    // pagehide save is belt-and-braces for an iOS kill with no final moveend.
    const persist = () => {
      const c = map.getCenter();
      saveViewState({ map: { lat: c.lat, lng: c.lng, zoom: map.getZoom() } });
    };
    map.on('moveend', persist);
    window.addEventListener('pagehide', persist);

    const releaseView = () => {
      holdViewRef.current = false;
    };
    // Tell the strip what the user can see (issue #89): the view less the
    // covered insets. On `moveend` only, so a pan stays free of work.
    const reportView = () => {
      if (holdViewRef.current) return;
      const size = map.getSize();
      if (!size.x || !size.y) return;
      const { top, right, bottom, left } = useStore.getState().coveredInsets;
      const nw = map.containerPointToLatLng([left, top]);
      const se = map.containerPointToLatLng([size.x - right, size.y - bottom]);
      const centre = map.containerPointToLatLng([
        (left + size.x - right) / 2,
        (top + size.y - bottom) / 2,
      ]);
      setViewport({
        box: { south: se.lat, west: nw.lng, north: nw.lat, east: se.lng },
        centre: { lat: centre.lat, lng: centre.lng },
        zoom: map.getZoom(),
      });
    };
    reportViewRef.current = reportView;
    map.on('dragstart zoomstart', releaseView);
    // Leaflet's own arrow-key pan fires neither of those.
    map.getContainer().addEventListener('keydown', releaseView);
    map.on('moveend', reportView);
    reportView();

    // The map's height changes when the bottom sheet expands/collapses;
    // Leaflet only watches window resize, so track the container directly.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    // On a phone the full credits run to three lines of the map. They rest as
    // one line that ends in an ellipsis, and a tap opens them (index.css). The
    // height still changes — open or shut, and with the routing credit — so it
    // is measured, and index.css lifts the bottom-left corner by it.
    const credits = map.attributionControl.getContainer();
    const creditsRo = new ResizeObserver(() =>
      map.getContainer().style.setProperty('--credits-h', `${credits?.offsetHeight ?? 0}px`),
    );
    if (credits) {
      creditsRo.observe(credits);
      credits.setAttribute('role', 'button');
      credits.tabIndex = 0;
      credits.setAttribute('aria-expanded', 'false');
      const toggle = (e: Event) => {
        // A link inside the credits goes where it says; only the text toggles.
        if ((e.target as HTMLElement).closest('a')) return;
        const open = credits.classList.toggle('is-open');
        credits.setAttribute('aria-expanded', String(open));
      };
      L.DomEvent.on(credits, 'click', toggle);
      L.DomEvent.on(credits, 'keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
          e.preventDefault();
          toggle(e);
        }
      });
    }

    return () => {
      ro.disconnect();
      creditsRo.disconnect();
      window.removeEventListener('pagehide', persist);
      map.off('moveend', persist);
      map.off('moveend', reportView);
      map.off('dragstart zoomstart', releaseView);
      map.getContainer().removeEventListener('keydown', releaseView);
      // The hint lives in the container, which outlives the map.
      window.clearTimeout(hintTimer);
      hint.remove();
      dropMenuKeys?.();
      peekRef.current?.remove();
      peekRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [setPosition, setDestination, setViewport]);

  useEffect(() => {
    if (controlsRef.current) placeControls(controlsRef.current, desktop);
  }, [desktop]);

  // Hold the strip's view from the moment a site opens in the spread, before
  // the spread's inset or its pan can report a new one. Declared before the
  // inset effect below, so it runs first.
  useEffect(() => {
    const open = desktop && !!selectedSiteId;
    const wasHeld = holdViewRef.current;
    holdViewRef.current = open;
    if (wasHeld && !open) reportViewRef.current?.();
  }, [desktop, selectedSiteId]);

  // The chrome moved, so the fence and the part of the map that shows moved
  // with it. Setting the fence pans the map back inside it if needed.
  useEffect(() => {
    refenceRef.current?.();
    reportViewRef.current?.();
  }, [coveredInsets]);

  // Render site pins whenever the filtered set or visited/wishlist state
  // changes. Deliberately NOT keyed on position or selection: GPS ticks must
  // never rebuild ~2,600 markers, and selection is handled incrementally below.
  useEffect(() => {
    const layer = siteLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    markersRef.current.clear();

    const { selectedSiteId: selectedId, lifted: lift } = useStore.getState();
    const scale = pinScale(map.getZoom());
    pinScaleRef.current = scale;
    for (const view of views) {
      const { site } = view;
      const marker = shapeMarker([site.lat, site.lng], {
        shape: shapeFor(site.category),
        ...markerStyle(view, site.id === selectedId, scale, site.id === lift?.id),
      });
      marker.on('click', () => pickPin.current(site.id));
      // Only an interactive pin gets these, so a speck never lifts.
      marker.on('mouseover', () => {
        if (canHover()) setLifted({ id: site.id, by: 'pin' });
      });
      marker.on('mouseout', () => dropLifted(site.id));
      marker.addTo(layer);
      markersRef.current.set(site.id, { marker, view });
    }

    glowRef.current?.setViews(views);

    // Fit to all pins on first data render.
    if (!didFitRef.current && views.length) {
      didFitRef.current = true;
      const bounds = L.latLngBounds(views.map((v) => [v.site.lat, v.site.lng]));
      map.fitBounds(bounds, fitPadding(40));
    }
  }, [views, setSelected, setLifted, dropLifted]);

  // Selection highlight: restyle only the previously- and newly-selected
  // markers instead of rebuilding the whole layer on every tap.
  useEffect(() => {
    restylePin(prevSelectedRef.current);
    restylePin(selectedSiteId);
    prevSelectedRef.current = selectedSiteId;
  }, [selectedSiteId]);

  // The lift (issue #88), restyled the same way: only the two pins involved.
  // A lifted pin comes to the front, so a neighbour never covers it.
  useEffect(() => {
    const id = lifted?.id ?? null;
    if (id === prevLiftedRef.current) return;
    restylePin(prevLiftedRef.current);
    restylePin(id);
    if (id) markersRef.current.get(id)?.marker.bringToFront();
    prevLiftedRef.current = id;
  }, [lifted]);

  // The peek over a pin lifted by the mouse or by the keyboard. A row lift
  // shows none: the row already names the site. Nor does the open site's pin:
  // its card says more. The peek follows the pin as the map moves, and hides
  // below the speck zoom, where no pin takes a hover.
  //
  // Keyed on the views too, so a filter change that hides the lifted site
  // takes its peek away with it. The markers are rebuilt first (the effect
  // above), so the lookup here always sees the current set.
  useEffect(() => {
    const map = mapRef.current;
    const peek = peekRef.current;
    if (!map || !peek) return;
    const entry =
      lifted && lifted.by !== 'row' && lifted.id !== selectedSiteId
        ? markersRef.current.get(lifted.id)
        : undefined;
    if (!entry) {
      peek.hide();
      return;
    }
    const latlng = entry.marker.getLatLng();
    const place = () => {
      if (pinScale(map.getZoom()) < SPECK_BELOW) return peek.hide();
      const at = map.latLngToContainerPoint(latlng);
      const size = map.getSize();
      // A pin under the desktop chrome is out of sight, like one off the map.
      const { top, right, bottom, left } = useStore.getState().coveredInsets;
      if (at.x < left || at.y < top || at.x > size.x - right || at.y > size.y - bottom) {
        return peek.hide();
      }
      peek.show(entry.view.site, at);
    };
    const hide = () => peek.hide();
    place();
    map.on('move zoomend', place);
    map.on('zoomstart', hide);
    return () => {
      map.off('move zoomend', place);
      map.off('zoomstart', hide);
      peek.hide();
    };
  }, [lifted, selectedSiteId, views, coveredInsets]);

  // The keyboard cursor can land on a pin off the screen. Bring it in, so the
  // keyboard previews a site as the mouse does. Keyed on the lift alone: a
  // filter change or a tick must not pull the map back to the cursor after the
  // user has panned away.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || lifted?.by !== 'key') return;
    const entry = markersRef.current.get(lifted.id);
    if (entry && pinScale(map.getZoom()) >= SPECK_BELOW) {
      // Clear of the covered insets too, or the pin lands under the strip.
      map.panInside(entry.marker.getLatLng(), fitPadding(80));
    }
  }, [lifted]);

  // Resize the pins once a zoom settles (issue #74). Not on every frame of a
  // pinch: the canvas scales the pins with the map through the gesture anyway.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const restyle = () => {
      const scale = pinScale(map.getZoom());
      if (scale === pinScaleRef.current) return;
      pinScaleRef.current = scale;
      const state = useStore.getState();
      for (const id of markersRef.current.keys()) restylePin(id, state);
    };
    map.on('zoomend', restyle);
    return () => {
      map.off('zoomend', restyle);
    };
  }, []);

  // Outing route overlay (spec §6 F12/F14): dashed polyline from the anchor
  // through the route-ordered stops, with numbered markers on top of the
  // regular pins. Cleared when the outing is cleared.
  useEffect(() => {
    const layer = outingLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    if (!outing) {
      outingFitKeyRef.current = null;
      return;
    }

    const byId = new Map(sites.map((s) => [s.id, s]));
    const stops = outing.stopIds.map((id) => byId.get(id)).filter((s) => !!s);
    if (!stops.length) return;

    const points: L.LatLngTuple[] = stops.map((s) => [s.lat, s.lng]);
    if (position) points.unshift([position.lat, position.lng]);
    L.polyline(points, {
      color: accent(),
      weight: 3,
      opacity: 0.75,
      dashArray: '6 6',
    }).addTo(layer);

    stops.forEach((site, i) => {
      L.marker([site.lat, site.lng], {
        icon: L.divIcon({
          className: 'outing-stop-marker',
          html: `<span>${i + 1}</span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      })
        .on('click', () => pickPin.current(site.id))
        .addTo(layer);
    });

    // Fit only when the outing itself changes — the effect also refires on
    // every live-GPS tick, and refitting then would hijack the map.
    const fitKey = outing.stopIds.join(',');
    if (outingFitKeyRef.current !== fitKey) {
      outingFitKeyRef.current = fitKey;
      map.fitBounds(L.latLngBounds(points), fitPadding(50));
    }
  }, [outing, sites, position, setSelected]);

  // Journey corridor overlay (issue #14, revised by #29).
  //
  // WITH A ROAD ROUTE, the map draws the road and nothing else. No shaded band:
  // the corridor is a fixed distance either side of the line, which reads as
  // "near this road" without being drawn, and a band wide enough to see at
  // national zoom swamps the road it describes.
  //
  // WITHOUT ONE, it is the original straight line plus the shaded detour
  // ellipse. The ellipse is worth drawing precisely because a straight line is
  // NOT self-explanatory as a corridor — the shading is what says the corridor
  // is fat in the middle and pinched at the ends. Redrawing on a budget change
  // is the feedback for widening it.
  //
  // The two are never drawn together. Shading an ellipse while the list is
  // filtered by the road would put sites in the list that sit outside the
  // shape.
  useEffect(() => {
    const layer = corridorLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    if (!position || !destination) {
      journeyFitKeyRef.current = null;
      return;
    }

    if (route) {
      L.polyline(
        route.route.points.map((p) => [p.lat, p.lng] as L.LatLngTuple),
        { color: accent(), weight: 4, opacity: 0.7, interactive: false },
      ).addTo(layer);
    } else {
      const ring = corridorEllipse(position, destination, detourBudget);
      if (ring.length) {
        L.polygon(
          ring.map((p) => [p.lat, p.lng] as L.LatLngTuple),
          {
            color: accent(),
            weight: 1.5,
            opacity: 0.5,
            dashArray: '4 5',
            fillColor: accent(),
            fillOpacity: 0.07,
            interactive: false,
          },
        ).addTo(layer);
      }

      L.polyline(
        [
          [position.lat, position.lng],
          [destination.lat, destination.lng],
        ],
        { color: accent(), weight: 2, opacity: 0.6, interactive: false },
      ).addTo(layer);
    }

    L.marker([destination.lat, destination.lng], {
      icon: L.divIcon({
        className: 'destination-marker',
        html: `<span>${iconMarkup('flag', 20)}</span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    })
      .bindTooltip(destination.label)
      .addTo(layer);

    // Fit once per journey, keyed on the destination and on whether a road
    // route has arrived: refitting on every budget change or GPS tick would
    // fight the user for the viewport. The route counts because it can swing
    // well outside the two ends — a Highland journey bulges east to Perth — so
    // the fit that framed the straight line cuts the road in half.
    const fitKey = `${destination.lat},${destination.lng}/${route ? 'road' : 'direct'}`;
    if (journeyFitKeyRef.current !== fitKey) {
      journeyFitKeyRef.current = fitKey;
      const bounds = L.latLngBounds([
        [position.lat, position.lng],
        [destination.lat, destination.lng],
      ]);
      if (route) for (const p of route.route.points) bounds.extend([p.lat, p.lng]);
      map.fitBounds(bounds, fitPadding(60));
    }
  }, [position, destination, detourBudget, route]);

  // Routing attribution (issue #29), required by the terms of the OSRM demo
  // server. It appears only while a road route is on the map: the basemap's own
  // credit already covers the OpenStreetMap data underneath.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;
    map.attributionControl.addAttribution(OSRM_ATTRIBUTION);
    return () => {
      map.attributionControl.removeAttribution(OSRM_ATTRIBUTION);
    };
  }, [route]);

  // Crosshair while either end is armed. One flag, one cursor: the state that
  // says a tap is spoken for is the same state that draws it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().style.cursor = picking ? 'crosshair' : '';
  }, [picking]);

  // Live / manual location marker + accuracy ring. Deliberately NOT a
  // circleMarker: as a coloured dot it was indistinguishable from a folklore
  // pin. It is now a DOM marker in its own top pane — a pulsing blue puck for
  // live GPS, a teardrop pin for a manually dropped location — so "where I am"
  // never reads as "a place to visit".
  useEffect(() => {
    const layer = meLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!position) return;

    if (position.accuracy > 0) {
      L.circle([position.lat, position.lng], {
        radius: position.accuracy,
        pane: 'meAccuracyPane',
        color: ME_BLUE,
        weight: 1,
        fillColor: ME_BLUE,
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(layer);
    }
    L.marker([position.lat, position.lng], {
      pane: 'mePane',
      icon: position.manual ? MANUAL_ICON : LIVE_ICON,
      keyboard: false,
      // Belt and braces: also wins inside the pane if anything else lands there.
      zIndexOffset: 1000,
    })
      .bindTooltip(position.manual ? copy.map.manualLocation : copy.map.youAreHere, {
        direction: 'top',
        offset: position.manual ? [0, -34] : [0, -20],
      })
      .addTo(layer);
  }, [position]);

  // The zoom-to-me control is only useful once there is a location to zoom to.
  useEffect(() => {
    const btn = locateBtnRef.current;
    if (btn) btn.hidden = !position;
  }, [position]);

  // Move the map where a search result asked (issue #28). Keyed on the nonce,
  // not the coordinates, so picking the same place twice still recentres — and
  // so this never competes with the user's own panning in between.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    // A move the user asked for: the strip follows it.
    holdViewRef.current = false;
    map.setView([focus.lat, focus.lng], focus.zoom ?? map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  // Pan to a selected site. The site card floats over the map, so centring on
  // the whole map hides the pin under the card on a phone. Centre it in the
  // largest strip of map the card leaves uncovered instead. The card grows as
  // its picture loads (and on "show more"), so follow its size until the user
  // moves the map themselves.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedSiteId || desktop) return;
    const v = views.find((x) => x.site.id === selectedSiteId);
    if (!v) return;
    const latlng = L.latLng(v.site.lat, v.site.lng);
    const container = map.getContainer();
    // PROTOTYPE: the site sheet stands in for the card.
    const card = container.parentElement?.querySelector<HTMLElement>('.card') ??
      document.querySelector<HTMLElement>('.sheet.site-mode');
    // The floating finder (issue #109) spans the top of the map, so the free
    // strip above the card starts under it.
    const float = container.parentElement?.querySelector<HTMLElement>('.float-finder');

    const pan = () => {
      const size = map.getSize();
      let target = L.point(size.x / 2, size.y / 2);
      if (card) {
        const m = container.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        const top = c.top - m.top;
        const left = c.left - m.left;
        const right = c.right - m.left;
        const floatBottom = float ? Math.max(0, Math.min(top, float.getBoundingClientRect().bottom - m.top)) : 0;
        // The free strips above, left of and right of the card; take the biggest.
        const strips = [
          { area: (top - floatBottom) * size.x, at: L.point(size.x / 2, (floatBottom + top) / 2) },
          { area: left * size.y, at: L.point(left / 2, size.y / 2) },
          { area: (size.x - right) * size.y, at: L.point((size.x + right) / 2, size.y / 2) },
        ];
        const best = strips.reduce((a, b) => (b.area > a.area ? b : a));
        if (best.area > 0) target = best.at;
      }
      // panTo, not panBy: panTo goes through setView, which holds the new
      // centre inside the plate fence first. A panBy ran past the edge of the
      // plate for a site near the coast, then sprang back on `moveend`.
      const offset = map.latLngToContainerPoint(latlng).subtract(target);
      map.panTo(map.containerPointToLatLng(size.divideBy(2).add(offset)));
    };

    pan();
    if (!card) return;
    const ro = new ResizeObserver(() => pan());
    ro.observe(card);
    const stop = () => ro.disconnect();
    map.once('dragstart zoomstart', stop);
    return () => {
      stop();
      map.off('dragstart zoomstart', stop);
    };
    // views intentionally omitted from deps: only react to selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteId, desktop]);

  // On a desktop the site opens in the spread (issue #90). The map pans it to
  // the centre of the part of the view that shows, and keeps the zoom. It
  // waits for the spread's inset: the fence reads the insets, and before the
  // spread is measured it pulls a site near the edge of the plate back under
  // the spread. A step in the spread keeps the inset and pans at once.
  //
  // Only a new site, or the spread's first measure, pans. A resize changes
  // the inset too, and must not pull the map back after the user has moved it.
  const spreadInset = desktop ? coveredInsets.right : 0;
  const pannedRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!selectedSiteId || !spreadInset) pannedRef.current = null;
    if (!map || !selectedSiteId || !spreadInset) return;
    if (pannedRef.current === selectedSiteId) return;
    pannedRef.current = selectedSiteId;
    const site = useStore.getState().sites.find((x) => x.id === selectedSiteId);
    if (!site) return;
    const size = map.getSize();
    const centre = openCentre(size, useStore.getState().coveredInsets);
    const target = L.point(centre.x, centre.y);
    const offset = map.latLngToContainerPoint([site.lat, site.lng]).subtract(target);
    // panTo, not panBy, for the same reason as above: setView holds the new
    // centre inside the fence first.
    map.panTo(map.containerPointToLatLng(size.divideBy(2).add(offset)));
  }, [selectedSiteId, spreadInset]);

  return <div ref={containerRef} className="map" />;
}
