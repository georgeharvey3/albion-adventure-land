import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fenceBox, openCentre, NO_INSETS } from '../src/map/insets';

// Pixel boxes at one zoom: the plate spans x 0–2000, y 0–1500.
const plate = { min: { x: 0, y: 0 }, max: { x: 2000, y: 1500 } };

test('with nothing covered, the fence is the plate', () => {
  assert.deepEqual(fenceBox(plate, { x: 1440, y: 900 }, NO_INSETS), plate);
});

test('the plate edge can go under a covered edge, by exactly its width', () => {
  const box = fenceBox(plate, { x: 1440, y: 900 }, { top: 0, right: 600, bottom: 150, left: 0 });
  assert.deepEqual(box, { min: { x: 0, y: 0 }, max: { x: 2600, y: 1650 } });
});

test('an axis where the view is bigger than the plate is widened to exactly the view', () => {
  const small = { min: { x: 0, y: 0 }, max: { x: 1000, y: 600 } };
  const box = fenceBox(small, { x: 1440, y: 900 }, NO_INSETS);
  assert.deepEqual(box, { min: { x: -220, y: -150 }, max: { x: 1220, y: 750 } });
});

test('the covered part counts towards the view when the plate is widened', () => {
  // Plate + strip = 750 tall; the view is 900, so 75 more on each side.
  const small = { min: { x: 0, y: 0 }, max: { x: 3000, y: 600 } };
  const box = fenceBox(small, { x: 1440, y: 900 }, { top: 0, right: 0, bottom: 150, left: 0 });
  assert.deepEqual(box, { min: { x: 0, y: -75 }, max: { x: 3000, y: 825 } });
});

test('with nothing covered, the open centre is the centre of the view', () => {
  assert.deepEqual(openCentre({ x: 1440, y: 900 }, NO_INSETS), { x: 720, y: 450 });
});

test('the open centre is the centre of the part of the view that shows', () => {
  const at = openCentre({ x: 1440, y: 900 }, { top: 0, right: 835, bottom: 150, left: 0 });
  assert.deepEqual(at, { x: 302.5, y: 375 });
});
