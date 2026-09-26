import { describe, expect, it } from 'vitest';
import { finishAnswer } from './answer';
import { DATA, SHEFFIELD, WINCHESTER } from './tools/fixtures';
import { requestState } from './tools/context';
import type { AskRequest, ToolCallRecord } from './types';

function finish(text: string, calls: ToolCallRecord[] = [], request: Partial<AskRequest> = {}) {
  return finishAnswer(text, { data: DATA, request: requestState({ question: '', now: '2026-09-26T10:00', ...request }), calls });
}

const JOURNEY = { origin: { ...SHEFFIELD, label: 'Sheffield' }, destination: { ...WINCHESTER, label: 'Winchester' } };

const journeyCall: ToolCallRecord = {
  name: 'find_sites',
  args: { journey: JOURNEY },
  result: { context: { kind: 'journey', ...JOURNEY, route: 'road' }, total: 2, sites: [{ id: 'deep-lake', name: 'Deep Lake' }] },
  siteIds: ['deep-lake'],
};

describe('finishing an answer', () => {
  it('keeps a site link whose id resolves, and names the site', () => {
    const out = finish('Try [Deep Lake](site:deep-lake) for deep water.');
    expect(out.text).toBe('Try [Deep Lake](site:deep-lake) for deep water.');
    expect(out.siteIds).toEqual(['deep-lake']);
  });

  it('reads a link with no site: prefix as a site link', () => {
    const out = finish('Try [Deep Lake](deep-lake) or [Lake Nowhere](lake-nowhere).');
    expect(out.text).toBe('Try [Deep Lake](site:deep-lake) or Lake Nowhere.');
    expect(out.siteIds).toEqual(['deep-lake']);
  });

  it('leaves an ordinary web link alone', () => {
    const out = finish('See [CAMRA](https://camra.org.uk).');
    expect(out.text).toBe('See [CAMRA](https://camra.org.uk).');
  });

  it('removes a site whose id does not resolve, and leaves its name as plain text', () => {
    const out = finish('Try [Lake Nowhere](site:lake-nowhere) or [Deep Lake](site:deep-lake).');
    expect(out.text).toBe('Try Lake Nowhere or [Deep Lake](site:deep-lake).');
    expect(out.siteIds).toEqual(['deep-lake']);
  });

  it('repairs a mangled id when the link text is the name of a site the tools returned', () => {
    const out = finish('Try [Deep Lake](site:deep_lake_51.41).', [journeyCall]);
    expect(out.text).toBe('Try [Deep Lake](site:deep-lake).');
    expect(out.siteIds).toEqual(['deep-lake']);
  });

  it('links the plain-text name of a site the tools returned', () => {
    const out = finish('Deep Lake is the one: deep and clear.', [journeyCall]);
    expect(out.text).toBe('[Deep Lake](site:deep-lake) is the one: deep and clear.');
    expect(out.siteIds).toEqual(['deep-lake']);
  });

  it('does not link the plain-text name of a site the tools did not return', () => {
    const out = finish('Port Meadow is lovely.', [journeyCall]);
    expect(out.text).toBe('Port Meadow is lovely.');
    expect(out.siteIds).toEqual([]);
  });

  it('does not link a site that only resolve_place returned', () => {
    const placeCall: ToolCallRecord = { name: 'resolve_place', args: { text: 'Deep Lake' }, result: {}, siteIds: ['deep-lake'] };
    expect(finish('Near Deep Lake there is nothing.', [placeCall]).siteIds).toEqual([]);
  });

  it('links a plain-text name once, and not inside a word', () => {
    const out = finish('Deep Lakes are rare, but Deep Lake is one. Deep Lake again.', [journeyCall]);
    expect(out.text).toBe('Deep Lakes are rare, but [Deep Lake](site:deep-lake) is one. Deep Lake again.');
  });

  it('removes a hidden site even when its id resolves', () => {
    const out = finish('Try [Deep Lake](site:deep-lake).', [], { hidden: ['deep-lake'] });
    expect(out.text).toBe('Try Deep Lake.');
    expect(out.siteIds).toEqual([]);
  });

  it('removes a closed site', () => {
    const out = finish('Try [Closed Pub](site:closed-pub).');
    expect(out.siteIds).toEqual([]);
  });

  it('lists each named site once, in the order the answer names them', () => {
    const out = finish('[Port Meadow](site:port-meadow), then [Deep Lake](site:deep-lake), then [Port Meadow](site:port-meadow) again.');
    expect(out.siteIds).toEqual(['port-meadow', 'deep-lake']);
  });

  it('offers to show the named sites on the map and to add each to the trip', () => {
    const out = finish('[Port Meadow](site:port-meadow) and [Deep Lake](site:deep-lake).');
    expect(out.handOffs).toEqual([
      { kind: 'show_on_map', siteIds: ['port-meadow', 'deep-lake'] },
      { kind: 'add_to_trip', siteId: 'port-meadow' },
      { kind: 'add_to_trip', siteId: 'deep-lake' },
    ]);
  });

  it('offers no hand-off when no site survives', () => {
    expect(finish('Nothing matches.').handOffs).toEqual([]);
  });

  it('reports the context of the last search, and offers a new journey as a hand-off', () => {
    const out = finish('Try [Deep Lake](site:deep-lake).', [journeyCall]);
    expect(out.context).toEqual({ kind: 'journey', ...JOURNEY, route: 'road' });
    expect(out.handOffs).toContainEqual({ kind: 'use_as_journey', ...JOURNEY });
  });

  it('does not offer the journey that the app already has', () => {
    const out = finish('Try [Deep Lake](site:deep-lake).', [journeyCall], { journey: JOURNEY });
    expect(out.handOffs.some((h) => h.kind === 'use_as_journey')).toBe(false);
  });

  it('turns a plan-trip marker into a hand-off and removes it from the prose', () => {
    const nearCall: ToolCallRecord = {
      name: 'find_sites',
      args: {},
      result: { context: { kind: 'near', point: { ...WINCHESTER, label: 'Winchester' } }, total: 0, sites: [] },
      siteIds: [],
    };
    const out = finish('A ruin and a swim near Winchester.\n\n<<plan_trip: ruins, wild_swims>>', [nearCall]);
    expect(out.text).toBe('A ruin and a swim near Winchester.');
    expect(out.handOffs).toContainEqual({ kind: 'plan_trip', types: ['ruins', 'wild_swims'], near: { ...WINCHESTER, label: 'Winchester' } });
  });

  it('drops the unknown types from a plan-trip marker', () => {
    const out = finish('Go.\n<<plan_trip: ruins, castles>>');
    expect(out.handOffs).toContainEqual({ kind: 'plan_trip', types: ['ruins'] });
  });

  it('reports no context when no search ran', () => {
    expect(finish('Hello.').context).toEqual({ kind: 'none' });
  });
});
