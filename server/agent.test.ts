import { describe, expect, it } from 'vitest';
import { ask, type AgentEvent } from './agent';
import type { ChatModel, ModelMessage, ModelTurn } from './model';
import { DATA, fakeNet, ROUTE, SHEFFIELD, WINCHESTER } from './tools/fixtures';

/** A model that plays back a fixed script of turns, and keeps what it saw. */
function scripted(turns: ModelTurn[]): ChatModel & { seen: ModelMessage[][]; required: boolean[] } {
  const seen: ModelMessage[][] = [];
  const required: boolean[] = [];
  let i = 0;
  return {
    seen,
    required,
    async complete(messages, _tools, options) {
      seen.push([...messages]);
      required.push(!!options?.requireTool);
      return turns[Math.min(i++, turns.length - 1)];
    },
  };
}

const call = (name: string, args: unknown, id = name) => ({ id, name, arguments: JSON.stringify(args) });

describe('the agent loop', () => {
  it('runs the tools the model asks for and returns a checked answer', async () => {
    const model = scripted([
      { content: '', toolCalls: [call('resolve_place', { text: 'Winchester' })] },
      {
        content: '',
        toolCalls: [
          call('find_sites', {
            journey: { origin: { ...SHEFFIELD, label: 'Sheffield' }, destination: { ...WINCHESTER, label: 'Winchester' } },
            types: ['wild_swims'],
          }),
        ],
      },
      { content: 'Along your route: [Deep Lake](site:deep-lake) and [Made Up Mere](site:made-up-mere).', toolCalls: [] },
    ]);
    const events: AgentEvent[] = [];
    const run = await ask(
      { model, data: DATA, net: fakeNet({ route: ROUTE }), semantic: null },
      { question: 'Swims on the way to Winchester?', now: '2026-09-26T10:00', position: SHEFFIELD },
      (e) => events.push(e),
    );

    expect(run.calls.map((c) => c.name)).toEqual(['resolve_place', 'find_sites']);
    expect(run.answer.siteIds).toEqual(['deep-lake']);
    expect(run.answer.text).toBe('Along your route: [Deep Lake](site:deep-lake) and Made Up Mere.');
    expect(run.answer.context).toMatchObject({ kind: 'journey', route: 'road' });
    expect(events.map((e) => e.type)).toEqual(['tool', 'tool', 'answer']);
  });

  it('makes the model call a tool on the first turn, and only on the first turn', async () => {
    const model = scripted([
      { content: '', toolCalls: [call('resolve_place', { text: 'Oxford' })] },
      { content: 'Done.', toolCalls: [] },
    ]);
    await ask({ model, data: DATA, net: fakeNet(), semantic: null }, { question: 'q', now: '2026-09-26T10:00' });
    expect(model.required).toEqual([true, false]);
  });

  it('sends the conversation, the question and the context to the model', async () => {
    const model = scripted([{ content: 'Hello.', toolCalls: [] }]);
    await ask(
      { model, data: DATA, net: fakeNet(), semantic: null },
      {
        question: 'And the second one?',
        now: '2026-09-26T10:00',
        conversation: [
          { role: 'user', content: 'Swims near Oxford?' },
          { role: 'assistant', content: '[Port Meadow](site:port-meadow) and [Deep Lake](site:deep-lake).' },
        ],
        selection: 'port-meadow',
      },
    );
    const [messages] = model.seen;
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    const last = messages[3].content as string;
    expect(last).toContain('And the second one?');
    expect(last).toContain('Saturday 26 September 2026, 10:00');
    expect(last).toContain('Site shown in the app: [Port Meadow](site:port-meadow)');
  });

  it('gives the model an error result for arguments that are not JSON', async () => {
    const model = scripted([
      { content: '', toolCalls: [{ id: 'x', name: 'find_sites', arguments: '{near:' }] },
      { content: 'Sorry.', toolCalls: [] },
    ]);
    const run = await ask({ model, data: DATA, net: fakeNet(), semantic: null }, { question: 'q', now: '2026-09-26T10:00' });
    expect(run.calls[0].result).toHaveProperty('error');
  });

  it('asks for a final answer with no tools when the turns run out', async () => {
    const model = scripted([{ content: '', toolCalls: [call('resolve_place', { text: 'Oxford' })] }]);
    const last: ModelTurn = { content: 'Out of turns.', toolCalls: [] };
    const original = model.complete;
    let n = 0;
    model.complete = async (messages, tools) => (++n > 2 ? last : original(messages, tools));
    const run = await ask(
      { model, data: DATA, net: fakeNet(), semantic: null, maxTurns: 2 },
      { question: 'q', now: '2026-09-26T10:00' },
    );
    expect(run.answer.text).toBe('Out of turns.');
    expect(run.calls).toHaveLength(2);
  });
});
