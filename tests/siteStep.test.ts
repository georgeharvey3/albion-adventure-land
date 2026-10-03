import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SWIPE_MAX_MS, SWIPE_MIN, siteStep, swipeStep } from '../src/state/siteStep';

test('a swipe to the left goes to the next site, to the right the previous', () => {
  assert.equal(swipeStep({ dx: -80, dy: 5, ms: 200 }), 1);
  assert.equal(swipeStep({ dx: 80, dy: -5, ms: 200 }), -1);
});

test('a short move, a scroll that drifts, or a slow drag is not a swipe', () => {
  assert.equal(swipeStep({ dx: -(SWIPE_MIN - 1), dy: 0, ms: 200 }), null);
  assert.equal(swipeStep({ dx: -80, dy: 60, ms: 200 }), null);
  assert.equal(swipeStep({ dx: -80, dy: 0, ms: SWIPE_MAX_MS + 1 }), null);
});

const order = ['a', 'b', 'c', 'd'];
const all = new Set(order);

test('a step follows the frozen order and stops at both ends', () => {
  assert.equal(siteStep(order, all, 'b', 1), 'c');
  assert.equal(siteStep(order, all, 'b', -1), 'a');
  assert.equal(siteStep(order, all, 'a', -1), null);
  assert.equal(siteStep(order, all, 'd', 1), null);
});

test('a step skips a site the filter no longer shows', () => {
  const shown = new Set(['a', 'b', 'd']);
  assert.equal(siteStep(order, shown, 'b', 1), 'd');
  assert.equal(siteStep(order, shown, 'd', -1), 'b');
});

test('the open site keeps its place after the filter hides it', () => {
  const shown = new Set(['a', 'd']);
  assert.equal(siteStep(order, shown, 'c', 1), 'd');
  assert.equal(siteStep(order, shown, 'c', -1), 'a');
});

test('a site outside the order steps into it at the first site', () => {
  assert.equal(siteStep(order, all, 'x', 1), 'a');
  assert.equal(siteStep(order, all, 'x', -1), null);
  assert.equal(siteStep([], new Set(), 'x', 1), null);
});
