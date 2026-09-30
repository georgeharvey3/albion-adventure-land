import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripNeighbours,
  stripSites,
  windowToShow,
  STRIP_WINDOW,
  type SiteView,
  type Viewport,
} from '../src/state/strip';
import type { Site } from '../src/data/types';

const site = (id: string, lat: number, lng: number): Site =>
  ({ id, name: id, lat, lng, category: 'holy_wells', source: 'test' }) as unknown as Site;
const view = (s: Site) => ({ site: s, visited: false, wishlisted: false });

// Lake District, roughly.
const box = { south: 54.3, west: -3.3, north: 54.6, east: -2.8 };
const at = (zoom: number, centre = { lat: 54.45, lng: -3.05 }): Viewport => ({ box, centre, zoom });

const grasmere = site('grasmere', 54.46, -3.02);
const keswick = site('keswick', 54.6, -3.13);
const coniston = site('coniston', 54.37, -3.07);
const london = site('london', 51.5, -0.12);
const filtered = [grasmere, keswick, coniston, london].map(view);

const ids = (strip: ReturnType<typeof stripSites>) =>
  strip.kind === 'sites' ? strip.views.map((v) => v.site.id) : strip.kind;

test('shows the sites in view, nearest the anchor first', () => {
  const strip = stripSites({ filtered, journey: null, anchor: { lat: 54.62, lng: -3.14 }, viewport: at(10) });
  assert.equal(strip.kind, 'sites');
  assert.deepEqual(ids(strip), ['keswick', 'grasmere', 'coniston']);
  assert.equal(strip.kind === 'sites' && strip.from, 'anchor');
});

test('carries the distance from the anchor', () => {
  const strip = stripSites({ filtered, journey: null, anchor: { lat: 54.6, lng: -3.13 }, viewport: at(10) });
  assert.ok(strip.kind === 'sites');
  assert.equal(strip.views[0].distance, 0);
});

test('with no anchor, sorts from the map centre and shows no distance', () => {
  const strip = stripSites({ filtered, journey: null, anchor: null, viewport: at(10, { lat: 54.37, lng: -3.07 }) });
  assert.deepEqual(ids(strip), ['coniston', 'grasmere', 'keswick']);
  assert.ok(strip.kind === 'sites');
  assert.equal(strip.from, 'centre');
  assert.equal(strip.views[0].distance, null);
});

test('below the speck zoom it asks the user to zoom in', () => {
  const strip = stripSites({ filtered, journey: null, anchor: { lat: 54.6, lng: -3.13 }, viewport: at(7) });
  assert.equal(strip.kind, 'zoomIn');
  assert.equal(stripSites({ filtered, journey: null, anchor: null, viewport: at(7.5) }).kind, 'sites');
});

test('with a destination, shows the journey list in its own order at every zoom', () => {
  const journey: SiteView[] = [london, coniston].map((s, i) => ({
    ...view(s),
    distance: 1000,
    detour: 500,
    progress: i / 2,
  }));
  const strip = stripSites({ filtered, journey, anchor: { lat: 54.6, lng: -3.13 }, viewport: at(6) });
  assert.deepEqual(ids(strip), ['london', 'coniston']);
  assert.ok(strip.kind === 'sites');
  assert.equal(strip.from, 'journey');
});

test('before the map has reported a view, the strip is empty', () => {
  assert.deepEqual(ids(stripSites({ filtered, journey: null, anchor: null, viewport: null })), []);
});

test('the window grows in whole steps to reach a frame', () => {
  assert.equal(windowToShow(0), STRIP_WINDOW);
  assert.equal(windowToShow(STRIP_WINDOW - 1), STRIP_WINDOW);
  assert.equal(windowToShow(STRIP_WINDOW), 2 * STRIP_WINDOW);
});

test('the spread steps to the frames either side of the open site', () => {
  const order = ['a', 'b', 'c'];
  assert.deepEqual(stripNeighbours(order, 'b'), { prev: 'a', next: 'c' });
});

test('the spread stops at both ends of the strip', () => {
  const order = ['a', 'b', 'c'];
  assert.deepEqual(stripNeighbours(order, 'a'), { prev: null, next: 'b' });
  assert.deepEqual(stripNeighbours(order, 'c'), { prev: 'b', next: null });
});

test('a site that is not in the strip steps into it at the first frame', () => {
  assert.deepEqual(stripNeighbours(['a', 'b'], 'x'), { prev: null, next: 'a' });
  assert.deepEqual(stripNeighbours([], 'x'), { prev: null, next: null });
});
