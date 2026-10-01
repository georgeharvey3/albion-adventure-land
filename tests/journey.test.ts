import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journeyActive, journeyBarMode } from '../src/state/journey';

const idle = { overriddenOrigin: false, hasDestination: false, picking: false };

test('a phone with no journey shows no bar until the route button opens it', () => {
  assert.equal(journeyActive(idle), false);
  assert.equal(journeyBarMode(idle, true, false), 'none');
  assert.equal(journeyBarMode(idle, true, true), 'full');
});

test('a destination shows one line, and the line opens the bar', () => {
  const s = { ...idle, hasDestination: true };
  assert.equal(journeyBarMode(s, true, false), 'compact');
  assert.equal(journeyBarMode(s, true, true), 'full');
});

test('an origin that is not live GPS never hides', () => {
  const s = { ...idle, overriddenOrigin: true };
  assert.equal(journeyBarMode(s, true, false), 'compact');
});

test('an armed map tap shows the full bar, its own cancel', () => {
  assert.equal(journeyBarMode({ ...idle, picking: true }, true, false), 'full');
});

test('the side panel and the desktop always show the full bar', () => {
  assert.equal(journeyBarMode(idle, false, false), 'full');
});
