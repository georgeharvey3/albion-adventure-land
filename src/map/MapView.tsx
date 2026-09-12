import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SITE_TYPE_COLORS, type SiteCategory } from '../data/types';
import { useStore } from '../state/store';
import { useFilteredSites, type FilteredSiteView } from '../state/selectors';
import { shapeMarker, type MarkerShape } from './shapeMarker';
import { corridorEllipse } from '../geo/corridor';
import { loadViewState, saveViewState } from '../state/viewState';
import { iconMarkup } from '../ui/icons';

// Leaflet map (spec §6 F2): pins coloured by type, live location dot + accuracy
// ring, and a "drop pin" fallback when geolocation is unavailable. Uses Leaflet
// directly (no react-leaflet) to keep the dependency surface minimal.
//
// Performance: ~2,600 pins. All markers are canvas-drawn (preferCanvas + the
// shapeMarker subclass — no per-marker DOM), the marker set is rebuilt only
// when the filter or visited/wishlist state changes (never on a GPS tick), and
// selecting a pin restyles just the two markers involved.

const GB_CENTER: L.LatLngTuple = [53.0, -3.5];

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
function markerStyle(view: FilteredSiteView, selected: boolean): L.CircleMarkerOptions {
  const { site, visited, wishlisted } = view;
  const shape = shapeFor(site.category);
  const base = shape === 'triangle' || shape === 'diamond' || shape === 'chevron' ? 7.5 : 6;
  return {
    radius: selected ? base + 3 : base,
    color: wishlisted ? '#f4a261' : visited ? '#2a2a2a' : '#fff',
    weight: wishlisted ? 3 : visited ? 2 : 1.5,
    fillColor: SITE_TYPE_COLORS[site.category],
    fillOpacity: 0.95,
  };
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

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const siteLayerRef = useRef<L.LayerGroup | null>(null);
  const meLayerRef = useRef<L.LayerGroup | null>(null);
  const outingLayerRef = useRef<L.LayerGroup | null>(null);
  const corridorLayerRef = useRef<L.LayerGroup | null>(null);
  const droppingRef = useRef(false);
  const dropBtnRef = useRef<HTMLButtonElement | null>(null);
  const locateBtnRef = useRef<HTMLButtonElement | null>(null);
  const didFitRef = useRef(false);
  const outingFitKeyRef = useRef<string | null>(null);
  const journeyFitKeyRef = useRef<string | null>(null);
  const markersRef = useRef(new Map<string, { marker: L.CircleMarker; view: FilteredSiteView }>());
  const prevSelectedRef = useRef<string | null>(null);

  const views = useFilteredSites();
  const position = useStore((s) => s.position);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const setSelected = useStore((s) => s.setSelected);
  const setPosition = useStore((s) => s.setPosition);
  const sites = useStore((s) => s.sites);
  const outing = useStore((s) => s.outing);
  const destination = useStore((s) => s.destination);
  const detourBudget = useStore((s) => s.detourBudget);
  const pickingDestination = useStore((s) => s.pickingDestination);
  const setDestination = useStore((s) => s.setDestination);

  // One-time map init.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    // Restore where the user last was. Without this, reopening the installed
    // PWA (iOS cold-starts it after a few minutes in the background) always
    // came back at the whole-of-Britain view.
    const saved = loadViewState().map;
    const map = L.map(containerRef.current, { zoomControl: true, preferCanvas: true }).setView(
      saved ? [saved.lat, saved.lng] : GB_CENTER,
      saved ? saved.zoom : 6,
    );
    // A restored view is the user's view — don't let the fit-to-all-pins pass
    // below throw it away once the site data lands.
    if (saved) didFitRef.current = true;
    mapRef.current = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    // Dedicated panes for the "you are here" marker. The accuracy ring sits
    // *below* the site pins (it's a translucent wash — it must not tint them),
    // and the marker itself sits above every other overlay, including the
    // numbered outing stops in the default marker pane (z-index 600). It stays
    // under the tooltip pane (650) so its own label still reads on top.
    map.createPane('meAccuracyPane').style.zIndex = '350';
    const mePane = map.createPane('mePane');
    mePane.style.zIndex = '645';
    // The pulse halo is decorative and much wider than the dot: let taps on
    // pins underneath through (the dot itself re-enables pointer events).
    mePane.style.pointerEvents = 'none';

    // Corridor first so its shaded ellipse sits under the pins, not over them.
    corridorLayerRef.current = L.layerGroup().addTo(map);
    siteLayerRef.current = L.layerGroup().addTo(map);
    outingLayerRef.current = L.layerGroup().addTo(map);
    meLayerRef.current = L.layerGroup().addTo(map);

    // "Drop my location" control — fallback when GPS is denied/unavailable.
    const Ctl = L.Control.extend({
      options: { position: 'topleft' as L.ControlPosition },
      onAdd() {
        const btn = L.DomUtil.create('button', 'drop-pin-btn');
        btn.type = 'button';
        btn.title = 'Drop a manual "I am here" pin';
        btn.innerHTML = iconMarkup('mapPin', 20);
        dropBtnRef.current = btn;
        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.on(btn, 'click', () => {
          // With a manual pin active, the button clears it and hands control
          // back to live GPS (the watcher repopulates position on its next
          // fix). Otherwise it toggles "drop a pin" mode.
          if (useStore.getState().position?.manual) {
            setPosition(null);
            droppingRef.current = false;
            btn.classList.remove('active');
            map.getContainer().style.cursor = '';
            return;
          }
          droppingRef.current = !droppingRef.current;
          // Only one thing can claim the next tap.
          if (droppingRef.current) useStore.getState().setPickingDestination(false);
          btn.classList.toggle('active', droppingRef.current);
          map.getContainer().style.cursor = droppingRef.current ? 'crosshair' : '';
        });
        return btn;
      },
    });
    map.addControl(new Ctl());

    // "Zoom to me" control — bottom right, in thumb reach on a phone. It only
    // recentres; it never asks for a fix, so it is hidden until a location
    // exists (a live GPS fix or a manual pin) — see the effect below.
    const LocateCtl = L.Control.extend({
      options: { position: 'bottomright' as L.ControlPosition },
      onAdd() {
        const btn = L.DomUtil.create('button', 'drop-pin-btn locate-btn');
        btn.type = 'button';
        btn.title = 'Zoom to my location';
        btn.textContent = '\u{1F3AF}';
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
    map.addControl(new LocateCtl());

    map.on('click', (e: L.LeafletMouseEvent) => {
      // Dropping an "I am here" pin wins if both modes are somehow armed; the
      // journey picker below is disarmed whenever this one is turned on.
      if (droppingRef.current) {
        setPosition({ lat: e.latlng.lat, lng: e.latlng.lng, accuracy: 0, manual: true });
        droppingRef.current = false;
        dropBtnRef.current?.classList.remove('active');
        map.getContainer().style.cursor = '';
        return;
      }
      // Journey destination (issue #14). No reverse geocoding is available
      // offline, so an arbitrary map point is labelled by its coordinates.
      if (useStore.getState().pickingDestination) {
        const { lat, lng } = e.latlng;
        setDestination({
          lat,
          lng,
          label: `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
        });
        map.getContainer().style.cursor = '';
      }
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

    // The map's height changes when the bottom sheet expands/collapses;
    // Leaflet only watches window resize, so track the container directly.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      window.removeEventListener('pagehide', persist);
      map.off('moveend', persist);
      map.remove();
      mapRef.current = null;
    };
  }, [setPosition, setDestination]);

  // Render site pins whenever the filtered set or visited/wishlist state
  // changes. Deliberately NOT keyed on position or selection: GPS ticks must
  // never rebuild ~2,600 markers, and selection is handled incrementally below.
  useEffect(() => {
    const layer = siteLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    markersRef.current.clear();

    const selectedId = useStore.getState().selectedSiteId;
    for (const view of views) {
      const { site } = view;
      const marker = shapeMarker([site.lat, site.lng], {
        shape: shapeFor(site.category),
        ...markerStyle(view, site.id === selectedId),
      });
      marker.on('click', () => setSelected(site.id));
      marker.addTo(layer);
      markersRef.current.set(site.id, { marker, view });
    }

    // Fit to all pins on first data render.
    if (!didFitRef.current && views.length) {
      didFitRef.current = true;
      const bounds = L.latLngBounds(views.map((v) => [v.site.lat, v.site.lng]));
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [views, setSelected]);

  // Selection highlight: restyle only the previously- and newly-selected
  // markers instead of rebuilding the whole layer on every tap.
  useEffect(() => {
    const markers = markersRef.current;
    const restyle = (id: string | null, selected: boolean) => {
      const entry = id ? markers.get(id) : undefined;
      if (entry) entry.marker.setStyle(markerStyle(entry.view, selected));
    };
    restyle(prevSelectedRef.current, false);
    restyle(selectedSiteId, true);
    prevSelectedRef.current = selectedSiteId;
  }, [selectedSiteId]);

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
        .on('click', () => setSelected(site.id))
        .addTo(layer);
    });

    // Fit only when the outing itself changes — the effect also refires on
    // every live-GPS tick, and refitting then would hijack the map.
    const fitKey = outing.stopIds.join(',');
    if (outingFitKeyRef.current !== fitKey) {
      outingFitKeyRef.current = fitKey;
      map.fitBounds(L.latLngBounds(points), { padding: [50, 50] });
    }
  }, [outing, sites, position, setSelected]);

  // Journey corridor overlay (issue #14): the straight from→to line plus the
  // shaded detour ellipse, so "on my way" is something you can see rather than
  // infer from a number. Redraws when the budget changes — that IS the feedback
  // for widening it.
  useEffect(() => {
    const layer = corridorLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    if (!position || !destination) {
      journeyFitKeyRef.current = null;
      return;
    }

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

    // Fit once per journey, keyed on the two ends only: refitting on every
    // budget change or GPS tick would fight the user for the viewport.
    const fitKey = `${destination.lat},${destination.lng}`;
    if (journeyFitKeyRef.current !== fitKey) {
      journeyFitKeyRef.current = fitKey;
      map.fitBounds(
        L.latLngBounds([
          [position.lat, position.lng],
          [destination.lat, destination.lng],
        ]),
        { padding: [60, 60] },
      );
    }
  }, [position, destination, detourBudget]);

  // Crosshair while the journey picker is armed. Arming it also cancels the
  // "I am here" drop mode so a single tap can only mean one thing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!pickingDestination) {
      if (!droppingRef.current) map.getContainer().style.cursor = '';
      return;
    }
    droppingRef.current = false;
    dropBtnRef.current?.classList.remove('active');
    map.getContainer().style.cursor = 'crosshair';
  }, [pickingDestination]);

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
      .bindTooltip(position.manual ? 'Manual location' : 'You are here', {
        direction: 'top',
        offset: position.manual ? [0, -34] : [0, -20],
      })
      .addTo(layer);
  }, [position]);

  // Reflect the manual-pin state on the drop-pin button: lit + a "clear" title
  // so the button doubles as the way to resume live location.
  useEffect(() => {
    const btn = dropBtnRef.current;
    if (!btn) return;
    const manual = !!position?.manual;
    btn.classList.toggle('active', manual);
    btn.title = manual
      ? 'Clear manual pin (resume live location)'
      : 'Drop a manual "I am here" pin';
  }, [position?.manual]);

  // The zoom-to-me control is only useful once there is a location to zoom to.
  useEffect(() => {
    const btn = locateBtnRef.current;
    if (btn) btn.hidden = !position;
  }, [position]);

  // Pan to a site selected from the list.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedSiteId) return;
    const v = views.find((x) => x.site.id === selectedSiteId);
    if (v) map.panTo([v.site.lat, v.site.lng]);
    // views intentionally omitted from deps: only react to selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteId]);

  return <div ref={containerRef} className="map" />;
}
