import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SITE_TYPE_COLORS, type SiteCategory } from '../data/types';
import { useStore } from '../state/store';
import { useFilteredSites, type FilteredSiteView } from '../state/selectors';
import { shapeMarker, type MarkerShape } from './shapeMarker';

// Leaflet map (spec §6 F2): pins coloured by type, live location dot + accuracy
// ring, and a "drop pin" fallback when geolocation is unavailable. Uses Leaflet
// directly (no react-leaflet) to keep the dependency surface minimal.
//
// Performance: ~2,600 pins. All markers are canvas-drawn (preferCanvas + the
// shapeMarker subclass — no per-marker DOM), the marker set is rebuilt only
// when the filter or visited/wishlist state changes (never on a GPS tick), and
// selecting a pin restyles just the two markers involved.

const GB_CENTER: L.LatLngTuple = [53.0, -3.5];

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

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const siteLayerRef = useRef<L.LayerGroup | null>(null);
  const meLayerRef = useRef<L.LayerGroup | null>(null);
  const outingLayerRef = useRef<L.LayerGroup | null>(null);
  const droppingRef = useRef(false);
  const dropBtnRef = useRef<HTMLButtonElement | null>(null);
  const didFitRef = useRef(false);
  const outingFitKeyRef = useRef<string | null>(null);
  const markersRef = useRef(new Map<string, { marker: L.CircleMarker; view: FilteredSiteView }>());
  const prevSelectedRef = useRef<string | null>(null);

  const views = useFilteredSites();
  const position = useStore((s) => s.position);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const setSelected = useStore((s) => s.setSelected);
  const setPosition = useStore((s) => s.setPosition);
  const sites = useStore((s) => s.sites);
  const outing = useStore((s) => s.outing);

  // One-time map init.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, preferCanvas: true }).setView(
      GB_CENTER,
      6,
    );
    mapRef.current = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

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
        btn.textContent = '📍';
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
          btn.classList.toggle('active', droppingRef.current);
          map.getContainer().style.cursor = droppingRef.current ? 'crosshair' : '';
        });
        return btn;
      },
    });
    map.addControl(new Ctl());

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!droppingRef.current) return;
      setPosition({ lat: e.latlng.lat, lng: e.latlng.lng, accuracy: 0, manual: true });
      droppingRef.current = false;
      dropBtnRef.current?.classList.remove('active');
      map.getContainer().style.cursor = '';
    });

    // The map's height changes when the bottom sheet expands/collapses;
    // Leaflet only watches window resize, so track the container directly.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [setPosition]);

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
      color: '#1f6b4f',
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

  // Live / manual location dot + accuracy ring.
  useEffect(() => {
    const layer = meLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!position) return;

    if (position.accuracy > 0) {
      L.circle([position.lat, position.lng], {
        radius: position.accuracy,
        color: '#1f6b4f',
        weight: 1,
        fillColor: '#1f6b4f',
        fillOpacity: 0.12,
      }).addTo(layer);
    }
    L.circleMarker([position.lat, position.lng], {
      radius: 7,
      color: '#fff',
      weight: 2,
      fillColor: position.manual ? '#e76f51' : '#1f6b4f',
      fillOpacity: 1,
    })
      .bindTooltip(position.manual ? 'Manual location' : 'You are here')
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
