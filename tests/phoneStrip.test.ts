import { test } from 'node:test';
import assert from 'node:assert/strict';
import { middleFrame, pinInSight, rowShown, swipeOpens } from '../src/state/phoneStrip';

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

test('with a site open, a swipe that rests opens the middle frame', () => {
  assert.equal(swipeOpens({ middle: 'b', selected: 'a', byUser: true }), 'b');
});

test('a swipe opens nothing with no site open, or on the open site', () => {
  assert.equal(swipeOpens({ middle: 'b', selected: null, byUser: true }), null);
  assert.equal(swipeOpens({ middle: 'a', selected: 'a', byUser: true }), null);
  assert.equal(swipeOpens({ middle: null, selected: 'a', byUser: true }), null);
});

test('a scroll that the row made itself opens nothing', () => {
  assert.equal(swipeOpens({ middle: 'b', selected: 'a', byUser: false }), null);
});

test('the row shows on a phone at the low height, with a site open or not', () => {
  assert.equal(rowShown({ phone: true, sheet: 'low' }), true);
  assert.equal(rowShown({ phone: false, sheet: 'low' }), false);
  assert.equal(rowShown({ phone: true, sheet: 'mid' }), false);
  assert.equal(rowShown({ phone: true, sheet: 'full' }), false);
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
