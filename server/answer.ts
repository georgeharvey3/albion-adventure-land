// The last step of every answer (issue #62): the model's prose becomes an
// `Answer` the app can trust.
//
// Ethelred names only sites from the data. The prompt asks for that, and this
// step makes it true whatever the model does. Each site the prose names is a
// Markdown link to `site:<id>`. A link whose id resolves to a site the user
// can see stays. A link whose id is mangled, but whose text is the exact name
// of a site the tools returned, is repaired. Every other link loses its site:
// the words stay as plain text, and the site is not in `siteIds`, so the map
// never shows a site that the data does not hold.
//
// The hand-offs are derived here too, from what survived. The model proposes
// only one of them, `plan_trip`, with a marker at the end of the prose,
// because only the model knows that "a ruin and a swim" is a trip.

import { canonical } from '../src/search/normalize';
import type { SiteData } from './data';
import type { RequestState } from './tools/context';
import { TYPE_NAMES } from './tools/findSites';
import type { Answer, AnswerContext, HandOff, NamedPoint, ToolCallRecord } from './types';

export interface FinishInput {
  data: SiteData;
  request: RequestState;
  calls: readonly ToolCallRecord[];
}

// A site link is `[Name](site:id)`. A small model often drops the `site:`,
// so a bare target with no scheme and no slash counts too. A web link does not.
const SITE_LINK = /\[([^\]]+)\]\((?:site:([^)\s]*)|([^):/\s]+))\)/g;
const PLAN_TRIP = /<<\s*plan_trip\s*:([^>]*)>>/gi;
const TRIP_TYPES = new Set<string>(TYPE_NAMES);

export function finishAnswer(raw: string, { data, request, calls }: FinishInput): Answer {
  const visible = (id: string) => data.byId.has(id) && !request.hidden.has(id);

  // The names of the sites the tools returned, for repairing a mangled id. A
  // name that two returned sites share repairs nothing.
  const byName = new Map<string, string | null>();
  for (const call of calls) {
    for (const id of call.siteIds) {
      const site = data.byId.get(id);
      if (!site) continue;
      const key = canonical(site.name);
      byName.set(key, byName.has(key) && byName.get(key) !== id ? null : id);
    }
  }

  const siteIds: string[] = [];
  let text = linkPlainNames(raw, calls, data, visible).replace(SITE_LINK, (_whole, label: string, prefixed?: string, bare?: string) => {
    const id = prefixed ?? bare ?? '';
    const resolved = visible(id) ? id : byName.get(canonical(label));
    if (!resolved || !visible(resolved)) return label;
    if (!siteIds.includes(resolved)) siteIds.push(resolved);
    return `[${label}](site:${resolved})`;
  });

  const tripTypes: string[][] = [];
  text = text.replace(PLAN_TRIP, (_whole, list: string) => {
    tripTypes.push(
      list
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => TRIP_TYPES.has(t)),
    );
    return '';
  });
  text = text.trim();

  const context = lastContext(calls);
  return { text, siteIds, context, handOffs: handOffs(siteIds, context, tripTypes, request) };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A small model often names a site in plain text and forgets the link. A site
 * that the tools returned in this answer, named exactly, is still a named
 * site, so its first plain mention becomes a link. A site the tools did not
 * return is never linked this way: plain text is not evidence that it exists.
 */
function linkPlainNames(
  raw: string,
  calls: readonly ToolCallRecord[],
  data: SiteData,
  visible: (id: string) => boolean,
): string {
  // The text between links, which is the only text a name can be found in.
  const parts = raw.split(/(\[[^\]]+\]\((?:site:[^)\s]*|[^):/\s]+)\))/);
  const linkedLabels = new Set(
    parts.filter((_, i) => i % 2 === 1).map((link) => canonical(link.slice(1, link.indexOf(']('))))
  );

  const seen = new Set<string>();
  for (const call of calls) {
    // Only the shortlist and the readings. A site that resolve_place found is
    // the place in the question, not a suggestion.
    if (call.name !== 'find_sites' && call.name !== 'read_sites') continue;
    for (const id of call.siteIds) {
      const site = data.byId.get(id);
      if (!site || seen.has(id) || !visible(id)) continue;
      seen.add(id);
      if (linkedLabels.has(canonical(site.name))) continue;
      const name = new RegExp(`(?<![\\p{L}\\p{N}'’])${escape(site.name)}(?![\\p{L}\\p{N}'’])`, 'u');
      for (let i = 0; i < parts.length; i += 2) {
        const m = name.exec(parts[i]);
        if (!m) continue;
        const link = `[${m[0]}](site:${id})`;
        parts.splice(i, 1, parts[i].slice(0, m.index), link, parts[i].slice(m.index + m[0].length));
        linkedLabels.add(canonical(site.name));
        break;
      }
    }
  }
  return parts.join('');
}

function lastContext(calls: readonly ToolCallRecord[]): AnswerContext {
  for (let i = calls.length - 1; i >= 0; i--) {
    const result = calls[i].result as { context?: AnswerContext } | null;
    if (calls[i].name === 'find_sites' && result?.context) return result.context;
  }
  return { kind: 'none' };
}

function samePoint(a: NamedPoint, b: NamedPoint): boolean {
  return Math.abs(a.lat - b.lat) < 1e-3 && Math.abs(a.lng - b.lng) < 1e-3;
}

function handOffs(
  siteIds: string[],
  context: AnswerContext,
  tripTypes: string[][],
  request: RequestState,
): HandOff[] {
  const out: HandOff[] = [];
  if (siteIds.length) out.push({ kind: 'show_on_map', siteIds });

  if (context.kind === 'journey') {
    const current = request.journey;
    const isCurrent =
      current && samePoint(current.origin, context.origin) && samePoint(current.destination, context.destination);
    if (!isCurrent) out.push({ kind: 'use_as_journey', origin: context.origin, destination: context.destination });
  }

  for (const id of siteIds) out.push({ kind: 'add_to_trip', siteId: id });

  const near = context.kind === 'near' ? context.point : undefined;
  for (const types of tripTypes) {
    if (types.length) out.push({ kind: 'plan_trip', types, ...(near ? { near } : {}) });
  }
  return out;
}
