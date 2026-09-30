import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_BODY_PARTS, SITE_BODY_LAYOUT } from '../src/ui/siteBodyLayout';

// The card, the browse row and the spread show the same content for a site
// (issue #90). A part that one layout leaves out is a field the others show.

const sorted = (parts: readonly string[]) => [...parts].sort();

test('the card shows every part once', () => {
  assert.deepEqual(sorted(SITE_BODY_LAYOUT.card), sorted(SITE_BODY_PARTS));
});

test('the spread shows every part once, across its two columns', () => {
  const { main, side } = SITE_BODY_LAYOUT.spread;
  assert.deepEqual(sorted([...main, ...side]), sorted(SITE_BODY_PARTS));
});

test('the spread reads the write-up in the main column and acts from the side', () => {
  assert.ok(SITE_BODY_LAYOUT.spread.main.includes('writeUp'));
  assert.ok(SITE_BODY_LAYOUT.spread.side.includes('actions'));
});
