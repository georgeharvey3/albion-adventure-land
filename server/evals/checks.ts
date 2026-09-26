// The checks an eval case runs on one answer (issue #62). Three layers here;
// the fourth, repeat runs, is the runner's.
//
//   1. Trace: Ethelred called the right tools with the right slots.
//   2. Bounds: every site the answer names is one the tools returned, or one
//      the request itself named (the selection, a site in the conversation).
//      Code computes this set, so it needs no labels.
//   3. Relevance: at least one site from the case's "must name" list, and no
//      site from its "must not name" list. Plus the rules every answer keeps:
//      no hidden site, and visited sites after unvisited ones.

import { haversine, type LatLng } from '../../src/geo/haversine';
import { canonical } from '../../src/search/normalize';
import type { AgentRun } from '../agent';
import type { AnswerContext, AskRequest, HandOff, ToolCallRecord } from '../types';

/** A point slot: the live position, the selection, or a point within `km`. */
export type PointExpectation = 'position' | 'selection' | { lat: number; lng: number; km?: number };

export interface CallExpectation {
  tool: 'resolve_place' | 'find_sites' | 'read_sites';
  /** resolve_place: the text holds this, ignoring case. */
  text?: string;
  near?: PointExpectation;
  /** 'any' is any journey; 'current' is the journey the app sent. */
  journey?: 'any' | 'current' | { origin: PointExpectation; destination: PointExpectation };
  county?: string;
  /** find_sites: each of these is among the types. */
  types?: string[];
  includeVisited?: boolean;
  /** read_sites: each of these is among the ids. */
  ids?: string[];
}

export interface CaseExpectation {
  calls?: CallExpectation[];
  /** No call may match any of these. */
  forbidCalls?: CallExpectation[];
  mustName?: string[];
  mustNotName?: string[];
  /** The answer names no site at all. */
  noSites?: boolean;
  handOffs?: HandOff['kind'][];
  /** The question asks about visited sites, so they may come first. */
  visitedFirstOk?: boolean;
}

export interface EvalCase {
  id: string;
  question: string;
  request?: Omit<Partial<AskRequest>, 'question'>;
  expect: CaseExpectation;
}

export interface CheckResult {
  trace: string[];
  bounds: string[];
  relevance: string[];
}

const DEFAULT_KM = 10;

function pointOf(v: unknown): LatLng | null {
  const p = v as LatLng | null;
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p : null;
}

/** `actual` is the slot as the model wrote it; `resolved` is the point the
 *  tool made of it, which is the only form a place name can be checked in. */
function pointMatches(
  actual: unknown,
  resolved: unknown,
  want: PointExpectation,
  req: AskRequest,
  selection: LatLng | null,
): boolean {
  const p = pointOf(resolved) ?? pointOf(actual);
  if (want === 'position') {
    return actual === 'position' || !!(p && req.position && haversine(p, req.position) <= 2000);
  }
  if (want === 'selection') {
    return actual === 'selection' || !!(p && selection && haversine(p, selection) <= 2000);
  }
  return !!p && haversine(p, want) <= (want.km ?? DEFAULT_KM) * 1000;
}

function hasAll(actual: unknown, want: string[]): boolean {
  const list = Array.isArray(actual) ? actual.map((a) => String(a).toLowerCase()) : [];
  return want.every((w) => list.includes(w.toLowerCase()));
}

export function callMatches(
  call: Pick<ToolCallRecord, 'name' | 'args' | 'result'>,
  want: CallExpectation,
  req: AskRequest,
  selection: LatLng | null,
): boolean {
  const { name, args } = call;
  if (name !== want.tool) return false;
  const context = (call.result as { context?: AnswerContext } | null)?.context;
  if (want.text && !String(args.text ?? '').toLowerCase().includes(want.text.toLowerCase())) return false;
  if (want.near) {
    const resolved = context?.kind === 'near' ? context.point : undefined;
    if (!pointMatches(args.near, resolved, want.near, req, selection)) return false;
  }
  if (want.journey) {
    const j = args.journey as { origin?: unknown; destination?: unknown } | 'current' | undefined;
    if (!j) return false;
    const ends = context?.kind === 'journey' ? context : undefined;
    const raw = typeof j === 'object' ? j : {};
    if (want.journey === 'current') {
      const app = req.journey;
      if (j !== 'current') {
        if (!app) return false;
        if (!pointMatches(raw.origin, ends?.origin, { ...app.origin, km: 5 }, req, selection)) return false;
        if (!pointMatches(raw.destination, ends?.destination, { ...app.destination, km: 5 }, req, selection)) return false;
      }
    } else if (want.journey !== 'any') {
      if (!pointMatches(raw.origin, ends?.origin, want.journey.origin, req, selection)) return false;
      if (!pointMatches(raw.destination, ends?.destination, want.journey.destination, req, selection)) return false;
    }
  }
  if (want.county && !canonical(String(args.county ?? '')).includes(canonical(want.county))) return false;
  if (want.types && !hasAll(args.types, want.types)) return false;
  if (want.includeVisited !== undefined && Boolean(args.includeVisited) !== want.includeVisited) return false;
  if (want.ids && !hasAll(args.ids, want.ids)) return false;
  return true;
}

function describe(want: CallExpectation): string {
  const { tool, ...slots } = want;
  return `${tool} ${JSON.stringify(slots)}`;
}

const LINKED = /\(site:([^)\s]+)\)/g;

export function checkRun(c: EvalCase, req: AskRequest, run: AgentRun, selection: LatLng | null): CheckResult {
  const { answer, calls } = run;
  const e = c.expect;
  const out: CheckResult = { trace: [], bounds: [], relevance: [] };

  // 1. Trace
  for (const want of e.calls ?? []) {
    if (!calls.some((call) => callMatches(call, want, req, selection))) {
      out.trace.push(`no call matched ${describe(want)}`);
    }
  }
  for (const banned of e.forbidCalls ?? []) {
    if (calls.some((call) => callMatches(call, banned, req, selection))) {
      out.trace.push(`a call matched the forbidden ${describe(banned)}`);
    }
  }

  // 2. Bounds
  const reachable = new Set(calls.flatMap((call) => call.siteIds));
  if (req.selection) reachable.add(req.selection);
  for (const turn of req.conversation ?? []) for (const m of turn.content.matchAll(LINKED)) reachable.add(m[1]);
  for (const id of answer.siteIds) {
    if (!reachable.has(id)) out.bounds.push(`named ${id}, which no tool returned`);
  }

  // 3. Relevance
  const named = new Set(answer.siteIds);
  if (e.mustName?.length && !e.mustName.some((id) => named.has(id))) {
    out.relevance.push(`named none of the must-name sites`);
  }
  for (const id of e.mustNotName ?? []) if (named.has(id)) out.relevance.push(`named ${id}, which it must not`);
  if (e.noSites && answer.siteIds.length) out.relevance.push(`named ${answer.siteIds.length} sites, expected none`);
  for (const kind of e.handOffs ?? []) {
    if (!answer.handOffs.some((h) => h.kind === kind)) out.relevance.push(`offered no ${kind} hand-off`);
  }
  const hidden = new Set(req.hidden ?? []);
  for (const id of answer.siteIds) if (hidden.has(id)) out.relevance.push(`named the hidden site ${id}`);
  if (!e.visitedFirstOk) {
    const visited = new Set(req.visited ?? []);
    const firstVisited = answer.siteIds.findIndex((id) => visited.has(id));
    if (firstVisited >= 0 && answer.siteIds.slice(firstVisited).some((id) => !visited.has(id))) {
      out.relevance.push('named a visited site before an unvisited one');
    }
  }

  return out;
}

export function passed(r: CheckResult): boolean {
  return !r.trace.length && !r.bounds.length && !r.relevance.length;
}
