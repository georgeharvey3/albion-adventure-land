import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyHub, KEY_RANK, stepCursor, type KeyPress } from '../src/state/keys';

const press = (key: string, target: KeyPress['target'] = 'none'): KeyPress => ({
  key,
  target,
  modified: false,
});

test('Esc closes the top layer only, in the order lightbox, card, search, sheet', () => {
  const hub = createKeyHub();
  const closed: string[] = [];
  const escLayer = (name: string) => (p: KeyPress) => {
    if (p.key !== 'Escape') return false;
    closed.push(name);
    return true;
  };
  hub.register({ rank: KEY_RANK.sheet, onKey: escLayer('sheet') });
  hub.register({ rank: KEY_RANK.lightbox, onKey: escLayer('lightbox') });
  hub.register({ rank: KEY_RANK.search, onKey: escLayer('search') });
  hub.register({ rank: KEY_RANK.card, onKey: escLayer('card') });

  assert.equal(hub.handle(press('Escape')), true);
  assert.deepEqual(closed, ['lightbox']);
});

test('a layer that declines a key passes it to the layer below', () => {
  const hub = createKeyHub();
  const seen: string[] = [];
  hub.register({ rank: KEY_RANK.list, onKey: (p) => (seen.push(`list:${p.key}`), true) });
  hub.register({ rank: KEY_RANK.card, onKey: (p) => p.key === 'Escape' });

  assert.equal(hub.handle(press('j')), true);
  assert.deepEqual(seen, ['list:j']);
});

test('in a text field only Esc reaches the layers', () => {
  const hub = createKeyHub();
  const seen: string[] = [];
  hub.register({ rank: KEY_RANK.list, onKey: (p) => (seen.push(p.key), true) });

  assert.equal(hub.handle(press('j', 'text')), false);
  assert.equal(hub.handle(press('/', 'text')), false);
  assert.equal(hub.handle(press('Escape', 'text')), true);
  assert.deepEqual(seen, ['Escape']);
});

test('Enter on a button is the button\'s, but j is still the list\'s', () => {
  const hub = createKeyHub();
  const seen: string[] = [];
  hub.register({ rank: KEY_RANK.list, onKey: (p) => (seen.push(p.key), true) });

  assert.equal(hub.handle(press('Enter', 'control')), false);
  assert.equal(hub.handle(press(' ', 'control')), false);
  assert.equal(hub.handle(press('j', 'control')), true);
  assert.deepEqual(seen, ['j']);
});

test('a key with Ctrl, Alt or Meta held stays with the browser', () => {
  const hub = createKeyHub();
  hub.register({ rank: KEY_RANK.list, onKey: () => true });
  assert.equal(hub.handle({ key: 'k', target: 'none', modified: true }), false);
});

test('a modal layer keeps every key from the layers below', () => {
  const hub = createKeyHub();
  const seen: string[] = [];
  hub.register({ rank: KEY_RANK.list, onKey: (p) => (seen.push(p.key), true) });
  hub.register({ rank: KEY_RANK.lightbox, modal: true, onKey: (p) => p.key === 'ArrowRight' });

  assert.equal(hub.handle(press('j')), false);
  assert.equal(hub.handle(press('ArrowRight')), true);
  assert.deepEqual(seen, []);
});

test('a passive layer sees every key and stops none', () => {
  const hub = createKeyHub();
  const passive: string[] = [];
  const list: string[] = [];
  hub.register({ rank: 100, passive: true, onKey: (p) => (passive.push(p.key), true) });
  hub.register({ rank: KEY_RANK.list, onKey: (p) => (list.push(p.key), true) });

  hub.handle(press('j'));
  hub.handle(press('x', 'text'));
  assert.deepEqual(passive, ['j', 'x']);
  assert.deepEqual(list, ['j']);
});

test('a removed layer no longer gets keys', () => {
  const hub = createKeyHub();
  let calls = 0;
  const off = hub.register({ rank: KEY_RANK.card, onKey: () => (calls++, true) });
  off();
  assert.equal(hub.handle(press('Escape')), false);
  assert.equal(calls, 0);
});

test('at an equal rank the layer registered last is on top', () => {
  const hub = createKeyHub();
  const closed: string[] = [];
  hub.register({ rank: KEY_RANK.search, onKey: () => (closed.push('journey'), true) });
  hub.register({ rank: KEY_RANK.search, onKey: () => (closed.push('finder'), true) });
  hub.handle(press('Escape'));
  assert.deepEqual(closed, ['finder']);
});

test('j and k step through the list and stop at both ends', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(stepCursor(ids, 'a', 1), 'b');
  assert.equal(stepCursor(ids, 'b', -1), 'a');
  assert.equal(stepCursor(ids, 'c', 1), 'c');
  assert.equal(stepCursor(ids, 'a', -1), 'a');
});

test('with no current row, either key starts at the top of the list', () => {
  assert.equal(stepCursor(['a', 'b'], null, 1), 'a');
  assert.equal(stepCursor(['a', 'b'], null, -1), 'a');
});

test('a current row the filter has hidden starts the cursor again at the top', () => {
  assert.equal(stepCursor(['a', 'b'], 'gone', 1), 'a');
});

test('an empty list has no row to step to', () => {
  assert.equal(stepCursor([], 'a', 1), null);
});
