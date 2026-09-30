import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCopy, findStrays, isExempt } from '../scripts/ui-copy';

const texts = (source: string) => extractCopy('x.tsx', source).map((s) => s.text);

test('a sentence written into a component is caught', () => {
  assert.deepEqual(texts('const A = () => <p>Nothing found near you.</p>;'), ['Nothing found near you.']);
});

test('a string read from the copy module is not', () => {
  assert.deepEqual(texts('const A = () => <p>{copy.near.none}</p>;'), []);
});

test('a single word in a JSX child is caught, through a conditional', () => {
  assert.deepEqual(texts("const A = ({ on }) => <b>{on ? 'Map' : 'Browse'}</b>;"), ['Map', 'Browse']);
});

test('a text attribute and a text key are caught', () => {
  assert.deepEqual(texts('const A = () => <button aria-label="Close" />;'), ['Close']);
  assert.deepEqual(texts("const TABS = [{ id: 'near', label: 'Nearby' }];"), ['Nearby']);
});

test('a status message set on a DOM node is caught', () => {
  assert.deepEqual(texts("hint.textContent = 'Zoom';"), ['Zoom']);
});

test('ids, class names, comparisons and conditions are not copy', () => {
  assert.deepEqual(
    texts(`
      const A = ({ tab }) => (
        <div className={tab === 'near' ? 'tab active' : 'tab'}>{tab === 'outing' && 'x'}</div>
      );
      const B = { id: 'near', kind: 'ok' };
    `),
    [],
  );
});

test('the line of each stray is reported', () => {
  assert.deepEqual(extractCopy('x.tsx', 'const a = 1;\nconst A = () => <p>Hello there</p>;')[0].line, 2);
});

test('site data is exempt, components are not', () => {
  assert.ok(isExempt('src/data/types.ts'));
  assert.ok(isExempt('src/map/mapLabels.ts'));
  assert.ok(isExempt('src/copy.ts'));
  assert.ok(!isExempt('src/ui/Backup.tsx'));
  assert.ok(!isExempt('src/map/MapView.tsx'));
});

test('every UI string in src/ comes from the copy module', () => {
  const strays = findStrays().map((s) => `${s.file}:${s.line}  ${s.text}`);
  assert.deepEqual(strays, []);
});
