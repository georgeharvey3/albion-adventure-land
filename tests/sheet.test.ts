import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dragIntent,
  sheetStops,
  snapSheet,
  stepSheet,
  tapHandle,
  tapTab,
} from '../src/state/sheet';

// A 375 px phone: 667 px of app, 96 px of journey bar, handle and tabs.
const stops = sheetStops(667, 96);

test('the three heights: the tabs, half the screen, the whole screen', () => {
  assert.deepEqual(stops, { low: 96, mid: 334, full: 667 });
});

test('the middle height never drops under the low one', () => {
  assert.equal(sheetStops(150, 96).mid, 96);
});

test('a slow release settles on the nearest height', () => {
  assert.equal(snapSheet(stops, 120, 0), 'low');
  assert.equal(snapSheet(stops, 300, 0), 'mid');
  assert.equal(snapSheet(stops, 560, 0), 'full');
});

test('a flick goes on to the next height in its direction', () => {
  // Just over low, flicked up: the middle, not back to low.
  assert.equal(snapSheet(stops, 110, 1), 'mid');
  // Just under full, flicked down: the middle.
  assert.equal(snapSheet(stops, 650, -1), 'mid');
  // Past the middle, flicked up: full.
  assert.equal(snapSheet(stops, 340, 1), 'full');
  // A flick past the last height stays at it.
  assert.equal(snapSheet(stops, 667, 1), 'full');
  assert.equal(snapSheet(stops, 96, -1), 'low');
});

test('a drag down moves the sheet only when the list is at its top', () => {
  assert.equal(dragIntent({ dy: 12, scrollTop: 0, height: 'full' }), 'sheet');
  assert.equal(dragIntent({ dy: 12, scrollTop: 40, height: 'full' }), 'scroll');
  assert.equal(dragIntent({ dy: 12, scrollTop: 0, height: 'mid' }), 'sheet');
});

test('a drag up raises the sheet until it is full, then scrolls', () => {
  assert.equal(dragIntent({ dy: -12, scrollTop: 0, height: 'mid' }), 'sheet');
  assert.equal(dragIntent({ dy: -12, scrollTop: 0, height: 'full' }), 'scroll');
});

test('a drag up from the middle moves the sheet even mid-list', () => {
  assert.equal(dragIntent({ dy: -12, scrollTop: 200, height: 'mid' }), 'sheet');
});

test('Esc lowers the sheet one height per press', () => {
  assert.equal(stepSheet('full', -1), 'mid');
  assert.equal(stepSheet('mid', -1), 'low');
  assert.equal(stepSheet('low', -1), 'low');
  assert.equal(stepSheet('mid', 1), 'full');
  assert.equal(stepSheet('full', 1), 'full');
});

test('a tab opens the sheet at the middle height', () => {
  assert.deepEqual(tapTab({ tab: 'near', height: 'low' }, 'filters'), { tab: 'filters', height: 'mid' });
  assert.deepEqual(tapTab({ tab: 'near', height: 'low' }, 'near'), { tab: 'near', height: 'mid' });
});

test('another tab keeps the height, and the open tab lowers the sheet', () => {
  assert.deepEqual(tapTab({ tab: 'near', height: 'full' }, 'filters'), { tab: 'filters', height: 'full' });
  assert.deepEqual(tapTab({ tab: 'near', height: 'mid' }, 'near'), { tab: 'near', height: 'low' });
  assert.deepEqual(tapTab({ tab: 'near', height: 'full' }, 'near'), { tab: 'near', height: 'low' });
});

test('a tap on the handle raises the sheet, and from full lowers it', () => {
  assert.equal(tapHandle('low'), 'mid');
  assert.equal(tapHandle('mid'), 'full');
  assert.equal(tapHandle('full'), 'mid');
});
