import { describe, expect, it } from 'vitest';
import { callMatches, checkRun, passed, type EvalCase } from './checks';
import type { AgentRun } from '../agent';
import type { AskRequest, ToolCallRecord } from '../types';

const OXFORD = { lat: 51.752, lng: -1.2577 };
const BATH = { lat: 51.3751, lng: -2.3617 };
const req: AskRequest = { question: 'q', now: '2026-09-26T10:00', position: OXFORD };

function findCall(args: Record<string, unknown>, context?: unknown, siteIds: string[] = []): ToolCallRecord {
  return { name: 'find_sites', args, result: context ? { context, sites: [] } : { error: 'x' }, siteIds };
}

function run(siteIds: string[], calls: ToolCallRecord[]): AgentRun {
  return { answer: { text: '', siteIds, handOffs: [], context: { kind: 'none' } }, calls };
}

describe('matching a call against the expected slots', () => {
  it('matches near "position" by the literal, or by coordinates at the position', () => {
    expect(callMatches(findCall({ near: 'position' }), { tool: 'find_sites', near: 'position' }, req, null)).toBe(true);
    expect(callMatches(findCall({ near: OXFORD }), { tool: 'find_sites', near: 'position' }, req, null)).toBe(true);
    expect(callMatches(findCall({ near: BATH }), { tool: 'find_sites', near: 'position' }, req, null)).toBe(false);
  });

  it('matches a place name by the point the tool resolved it to', () => {
    const call = findCall({ near: 'Bath' }, { kind: 'near', point: { ...BATH, label: 'Bath' } });
    expect(callMatches(call, { tool: 'find_sites', near: BATH }, req, null)).toBe(true);
    expect(callMatches(call, { tool: 'find_sites', near: OXFORD }, req, null)).toBe(false);
  });

  it('matches journey "current" by the literal, or by the app journey ends', () => {
    const app = { ...req, journey: { origin: OXFORD, destination: BATH } };
    const want = { tool: 'find_sites' as const, journey: 'current' as const };
    expect(callMatches(findCall({ journey: 'current' }), want, app, null)).toBe(true);
    expect(callMatches(findCall({ journey: { origin: OXFORD, destination: BATH } }), want, app, null)).toBe(true);
    expect(callMatches(findCall({ journey: { origin: BATH, destination: OXFORD } }), want, app, null)).toBe(false);
  });

  it('needs every expected type among the types', () => {
    const call = findCall({ near: 'position', types: ['ruins', 'wild_swims'] });
    expect(callMatches(call, { tool: 'find_sites', types: ['wild_swims'] }, req, null)).toBe(true);
    expect(callMatches(call, { tool: 'find_sites', types: ['wells'] }, req, null)).toBe(false);
  });
});

describe('checking a run', () => {
  const c: EvalCase = { id: 'x', question: 'q', expect: { mustName: ['a', 'b'], mustNotName: ['z'] } };

  it('passes a run that names a must-name site the tools returned', () => {
    expect(passed(checkRun(c, req, run(['a'], [findCall({}, undefined, ['a'])]), null))).toBe(true);
  });

  it('fails the bounds check for a site no tool returned', () => {
    const out = checkRun(c, req, run(['a'], []), null);
    expect(out.bounds).toHaveLength(1);
  });

  it('counts a site from the conversation as in bounds', () => {
    const withTalk = { ...req, conversation: [{ role: 'assistant' as const, content: '[A](site:a)' }] };
    expect(checkRun(c, withTalk, run(['a'], []), null).bounds).toEqual([]);
  });

  it('fails relevance for a must-not-name site, a hidden site, and a visited site first', () => {
    const state = { ...req, hidden: ['h'], visited: ['v'] };
    const out = checkRun(c, state, run(['v', 'a', 'z', 'h'], [findCall({}, undefined, ['v', 'a', 'z', 'h'])]), null);
    expect(out.relevance).toEqual([
      'named z, which it must not',
      'named the hidden site h',
      'named a visited site before an unvisited one',
    ]);
  });
});
