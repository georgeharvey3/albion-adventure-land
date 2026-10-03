// The guard for the copy module (issue #102).
//
// Every string the app shows a user lives in `src/copy.ts`. A component reads
// `copy.backup.save`, never "Save a backup". This script fails when a prose
// string sits anywhere else in `src/`, so a sentence added inside a component
// cannot hide in a code diff: it has to go through the copy module, and the
// copy module is where the review looks.
//
//   npm run copy:check    list each stray string with its file and line; exit 1
//
// `npm test` runs the same check (tests/ui-copy.test.ts).
//
// The extraction is a heuristic. It takes JSX text, the human-facing JSX
// attributes and object keys, string literals in a JSX child position, and
// string or template literals that read as prose (they hold a space and a
// word). It skips markup, SVG paths, CSS, class names, event names, imports
// and console calls.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

// Files whose strings are data, not copy (issue #102, "Out of scope"), or
// never reach a user. Each entry says why.
const EXEMPT: { path: RegExp; why: string }[] = [
  { path: /^src\/copy\.ts$/, why: 'the copy module itself' },
  { path: /^src\/data\/types\.ts$/, why: 'the category names are site data' },
  { path: /^src\/data\/(ingest\.ts|mappings\/)/, why: 'the build-time ingest log never reaches a user' },
  { path: /^src\/map\/mapLabels\.ts$/, why: 'sea and landmark names are map data' },
  { path: /^src\/map\/basemaps\.ts$/, why: 'tile attributions are data; the layer names are in copy' },
  { path: /^src\/geo\/osrm\.ts$/, why: 'the OSRM attribution is data' },
  { path: /^src\/search\/places\.ts$/, why: 'country names are gazetteer data' },
  { path: /^src\/links\//, why: 'developer errors for a bad call, never shown' },
  { path: /\.prototype\.tsx$/, why: 'PROTOTYPE: dev-only variant names, never shipped' },
];

// JSX attributes and object keys whose value a user reads or hears.
const TEXT_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label', 'aria-description']);

// Object keys whose value a user reads.
const TEXT_KEYS = new Set([...TEXT_ATTRS, 'message', 'detail']);

// JSX attributes and object keys whose value is never copy.
const SKIP_KEYS = new Set([
  'className', 'class', 'style', 'd', 'viewBox', 'transform', 'points', 'fill', 'stroke',
  'accept', 'rel', 'href', 'src', 'type', 'key', 'id', 'role', 'pane',
]);

export type Stray = { file: string; line: number; text: string };

export function isExempt(file: string): boolean {
  return EXEMPT.some((e) => e.path.test(file));
}

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

// A word a user reads, once run-time values are gone.
function hasWord(text: string): boolean {
  return /[A-Za-z]{2}/.test(text.replace(/\{…\}/g, ' '));
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

// True when a literal is what a user reads, even as a single word: a JSX
// child (`{open ? 'Map' : 'Browse'}`), a text attribute, or the value of a
// text key (`{ label: 'Nearby' }`). Conditionals and `??`, `||`, `&&` pass
// the value through; anything else — a call, a comparison — does not.
function inTextSlot(node: ts.Node): boolean {
  let child: ts.Node = node;
  for (let p: ts.Node | undefined = node.parent; p; child = p, p = p.parent) {
    if (ts.isParenthesizedExpression(p)) continue;
    if (ts.isConditionalExpression(p)) {
      if (child === p.condition) return false;
      continue;
    }
    if (ts.isBinaryExpression(p) && /^(\?\?|\|\||&&)$/.test(p.operatorToken.getText())) continue;
    if (ts.isJsxExpression(p)) {
      const host = p.parent;
      if (ts.isJsxElement(host) || ts.isJsxFragment(host)) return true;
      return ts.isJsxAttribute(host) && TEXT_ATTRS.has(host.name.getText());
    }
    if (ts.isPropertyAssignment(p)) return child === p.initializer && TEXT_KEYS.has(p.name.getText());
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return /\.(textContent|title|innerText)$/.test(p.left.getText());
    }
    return false;
  }
  return false;
}

/** Every string in one source file that a user could read. */
export function extractCopy(file: string, source: string = readFileSync(file, 'utf8')): Stray[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Stray[] = [];

  const visit = (node: ts.Node) => {
    let text: string | null = null;

    if (ts.isJsxText(node)) {
      text = squash(node.text);
    } else if (ts.isJsxAttribute(node) && TEXT_ATTRS.has(node.name.getText()) && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) text = node.initializer.text;
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (ts.isJsxAttribute(node.parent)) {
        // Handled above, as the attribute.
      } else if (inTextSlot(node) && hasWord(node.text)) {
        text = squash(node.text);
      } else if (readsAsProse(node.text) && !inSkippedContext(node)) {
        text = squash(node.text);
      }
    } else if (ts.isTemplateExpression(node)) {
      const joined = templateText(node);
      if ((inTextSlot(node) && hasWord(joined)) || (readsAsProse(joined) && !inSkippedContext(node))) {
        text = squash(joined);
      }
    }

    if (text) text = squash(text.replace(/<[^>]*>/g, ' '));
    if (text && /[A-Za-z]/.test(text)) {
      const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
      found.push({ file, line, text });
    }
    ts.forEachChild(node, visit);
  };

  visit(tree);
  return found;
}

/** Every prose string in `src/` that is outside the copy module. */
export function findStrays(): Stray[] {
  return walk(SRC)
    .sort()
    .map((path) => relative(ROOT, path))
    .filter((file) => !isExempt(file))
    .flatMap((file) => extractCopy(file, readFileSync(join(ROOT, file), 'utf8')));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const strays = findStrays();
  if (strays.length > 0) {
    for (const s of strays) console.error(`${s.file}:${s.line}  ${s.text}`);
    console.error(`\n${strays.length} UI string(s) outside src/copy.ts. Move each one into the copy module.`);
    process.exit(1);
  }
  console.log('Every UI string is in src/copy.ts.');
}
