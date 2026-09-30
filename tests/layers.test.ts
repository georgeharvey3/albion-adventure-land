import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerState, siteLayers } from '../src/state/layers';
import type { Site, SiteCategory } from '../src/data/types';

const site = (id: string, category: SiteCategory, alsoCategories?: SiteCategory[]): Site =>
  ({ id, name: id, lat: 54, lng: -3, category, alsoCategories, source: 'test' }) as unknown as Site;

test('groups the leaves under their layer, in the filter order', () => {
  const layers = siteLayers([site('a', 'stone_circles'), site('b', 'historic_pubs'), site('c', 'wells')]);
  assert.deepEqual(
    layers.map((l) => [l.parent, l.leaves]),
    [
      ['historic_pubs', ['historic_pubs']],
      ['folklore', ['wells', 'stone_circles']],
    ],
  );
});

test('leaves out a layer with no sites', () => {
  const layers = siteLayers([site('a', 'ruins')]);
  assert.deepEqual(layers.map((l) => l.parent), ['ruins']);
});

test('counts the sites in each layer', () => {
  const layers = siteLayers([site('a', 'wells'), site('b', 'caves'), site('c', 'ruins')]);
  assert.deepEqual(
    layers.map((l) => [l.parent, l.count]),
    [
      ['ruins', 1],
      ['folklore', 2],
    ],
  );
});

test('counts a merged place under each of its layers', () => {
  const sarum = site('old-sarum', 'ruins', ['hillforts']);
  const layers = siteLayers([sarum]);
  assert.deepEqual(
    layers.map((l) => [l.parent, l.leaves, l.count]),
    [
      ['ruins', ['ruins'], 1],
      ['folklore', ['hillforts'], 1],
    ],
  );
});

test('counts a place once in a layer it enters by two leaves', () => {
  const layers = siteLayers([site('x', 'wells', ['caves'])]);
  assert.equal(layers[0].count, 1);
  assert.deepEqual(layers[0].leaves, ['wells', 'caves']);
});

test('a layer is on, off or mixed by its leaves', () => {
  const leaves: SiteCategory[] = ['wells', 'caves'];
  assert.equal(layerState(leaves, new Set(['wells', 'caves'])), 'on');
  assert.equal(layerState(leaves, new Set(['wells'])), 'mixed');
  assert.equal(layerState(leaves, new Set(['ruins'])), 'off');
});
