// Every string the app can show a user, in one committed file.
//
// UI copy hides inside JSX, status messages and DOM builders, so a pull
// request that adds a paragraph of text reads as a code change. This script
// pulls the copy out of `src/` and writes it to `docs/ui-copy.txt`, grouped by
// file. A change to the copy is then a change to that file, and the diff shows
// the words alone.
//
//   npm run copy          rewrite docs/ui-copy.txt
//   npm run copy:check    exit 1 if docs/ui-copy.txt is out of date
//
// The extraction is a heuristic. It takes JSX text, the human-facing JSX
// attributes, and string or template literals that read as prose (they hold a
// space and a word). It skips markup, SVG paths, CSS, class names, event
// names, imports and console calls. Build-time code under `src/data/` is not
// UI and is skipped whole.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'docs/ui-copy.txt');

// Build-time ingest: its strings go to the ingest log, never to a user.
const SKIP_PATHS = [/^src\/data\/ingest\.ts$/, /^src\/data\/mappings\//];

// JSX attributes whose value a user reads or hears.
const TEXT_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label', 'aria-description']);

// JSX attributes and object keys whose value is never copy.
const SKIP_KEYS = new Set([
  'className', 'class', 'style', 'd', 'viewBox', 'transform', 'points', 'fill', 'stroke',
  'accept', 'rel', 'href', 'src', 'type', 'key', 'id', 'role', 'pane',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(name) && !/\.(test|d)\.tsx?$/.test(name) ? [path] : [];
  });
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Prose holds a space and a real word once tags, attributes and run-time
// values are gone. SVG path data, CSS functions and attribute fragments fail.
function readsAsProse(text: string): boolean {
  const bare = text.replace(/<[^>]*>/g, ' ').replace(/\{…\}/g, ' ').trim();
  if (/="/.test(bare) || /^[\w-]+\(/.test(bare)) return false;
  return /[A-Za-z]{2}/.test(bare) && /\s/.test(text.trim());
}

// A template literal with its substitutions shown as `{…}`.
function templateText(node: ts.TemplateExpression): string {
  return node.head.text + node.templateSpans.map((s) => '{…}' + s.literal.text).join('');
}

// True when a node sits somewhere copy never lives.
function inSkippedContext(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
    if (ts.isJsxAttribute(p)) return SKIP_KEYS.has(p.name.getText()) && !TEXT_ATTRS.has(p.name.getText());
    if (ts.isPropertyAssignment(p) && SKIP_KEYS.has(p.name.getText())) return true;
    if (ts.isCallExpression(p)) {
      const callee = p.expression.getText();
      if (
        /^console\./.test(callee) ||
        /(^|\.)(on|off|once|addEventListener|removeEventListener|querySelector(All)?|classList\.\w+|setAttribute|matchMedia)$/.test(callee) ||
        /DomUtil\.create$/.test(callee)
      ) {
        return true;
      }
    }
    if (ts.isBinaryExpression(p) && /\.className$/.test(p.left.getText())) return true;
    if (ts.isBinaryExpression(p) && /^[=!]==?$/.test(p.operatorToken.getText())) return true;
    if (ts.isTaggedTemplateExpression(p)) return true;
  }
  return false;
}

export function extractCopy(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];

  const visit = (node: ts.Node) => {
    let text: string | null = null;

    if (ts.isJsxText(node)) {
      text = squash(node.text);
    } else if (ts.isJsxAttribute(node) && TEXT_ATTRS.has(node.name.getText()) && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) text = node.initializer.text;
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!ts.isJsxAttribute(node.parent) && readsAsProse(node.text) && !inSkippedContext(node)) text = squash(node.text);
    } else if (ts.isTemplateExpression(node)) {
      const joined = templateText(node);
      if (readsAsProse(joined) && !inSkippedContext(node)) text = squash(joined);
    }

    if (text) text = squash(text.replace(/<[^>]*>/g, ' '));
    if (text && /[A-Za-z]/.test(text) && !found.includes(text)) found.push(text);
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

export function renderCopy(): string {
  const sections = walk(SRC)
    .sort()
    .map((file) => relative(ROOT, file))
    .filter((file) => !SKIP_PATHS.some((re) => re.test(file)))
    .map((file) => ({ file, copy: extractCopy(join(ROOT, file)) }))
    .filter((s) => s.copy.length > 0)
    .map((s) => `## ${s.file}\n\n${s.copy.map((c) => `- ${c}`).join('\n')}\n`);

  return [
    '# UI copy',
    '',
    'Generated by `npm run copy`. Do not edit by hand.',
    'Each entry is a string the app can show a user. `{…}` marks a value filled in at run time.',
    '',
    ...sections,
  ].join('\n');
}

const text = renderCopy();
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    // A missing file is out of date.
  }
  if (current !== text) {
    console.error('docs/ui-copy.txt is out of date. Run `npm run copy` and commit the result.');
    process.exit(1);
  }
} else {
  writeFileSync(OUT, text);
  console.log(`Wrote ${relative(ROOT, OUT)}`);
}
