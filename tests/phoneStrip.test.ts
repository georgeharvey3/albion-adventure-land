import { test } from 'node:test';
import assert from 'node:assert/strict';
import { middleFrame, pinInSight, pinTap, rowShown } from '../src/state/phoneStrip';

// Three 270 px frames with an 8 px gap, in a 375 px row whose padding puts the
// first frame in the middle at scroll 0.
const frames = [
  { id: 'a', left: 52, width: 270 },
  { id: 'b', left: 330, width: 270 },
  { id: 'c', left: 608, width: 270 },
];

test('the middle frame is the one nearest the middle of the row', () => {
  assert.equal(middleFrame(frames, 0, 375), 'a');
  assert.equal(middleFrame(frames, 278, 375), 'b');
  assert.equal(middleFrame(frames, 556, 375), 'c');
});

test('a swipe half way lifts the frame that has most of the middle', () => {
  assert.equal(middleFrame(frames, 130, 375), 'a');
  assert.equal(middleFrame(frames, 150, 375), 'b');
});

test('an empty row has no middle frame', () => {
  assert.equal(middleFrame([], 0, 375), null);
});

const low = { sheet: 'low' as const, siteOpen: false, inRow: true, lifted: null };

test('at the low height a pin tap lifts its frame', () => {
  assert.equal(pinTap({ ...low, id: 'a' }), 'lift');
  assert.equal(pinTap({ ...low, lifted: 'b', id: 'a' }), 'lift');
});

test('a second tap on the lifted pin opens the site', () => {
  assert.equal(pinTap({ ...low, lifted: 'a', id: 'a' }), 'open');
});

test('a pin with no frame, or a tap with the row away, opens the site', () => {
  assert.equal(pinTap({ ...low, inRow: false, id: 'a' }), 'open');
  assert.equal(pinTap({ ...low, sheet: 'mid', id: 'a' }), 'open');
  assert.equal(pinTap({ ...low, siteOpen: true, id: 'a' }), 'open');
});

test('the row shows on a phone at the low height, with no site open', () => {
  const base = { phone: true, sheet: 'low' as const, siteOpen: false };
  assert.equal(rowShown(base), true);
  assert.equal(rowShown({ ...base, phone: false }), false);
  assert.equal(rowShown({ ...base, sheet: 'mid' }), false);
  assert.equal(rowShown({ ...base, siteOpen: true }), false);
});

// A 375 × 560 map: the floating row takes the top 50 px, the picture row the
// bottom 180 px.
const view = { x: 375, y: 560 };
const clear = { top: 50, bottom: 180 };

test('a pin between the floating row and the picture row is in sight', () => {
  assert.equal(pinInSight({ x: 180, y: 200 }, view, clear), true);
});

test('a pin under the picture row, the floating row or off the side is out of sight', () => {
  assert.equal(pinInSight({ x: 180, y: 450 }, view, clear), false);
  assert.equal(pinInSight({ x: 180, y: 40 }, view, clear), false);
  assert.equal(pinInSight({ x: -10, y: 200 }, view, clear), false);
  assert.equal(pinInSight({ x: 370, y: 200 }, view, clear), false);
});
