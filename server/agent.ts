// The agent loop (issue #62). One question is one call: the model takes as
// many turns as it needs, the tools run here next to the data, and the phone
// waits on one connection (docs/adr/0002-ethelred-server.md).

import { finishAnswer } from './answer';
import type { SiteData } from './data';
import type { ChatModel, ModelMessage } from './model';
import type { Net } from './net';
import { contextBlock, SYSTEM_PROMPT } from './prompt';
import type { SemanticIndex } from './semantic';
import { requestState, type ToolContext } from './tools/context';
import { runTool, TOOL_SPECS } from './tools';
import type { Answer, AskRequest, ToolCallRecord } from './types';

export interface AgentDeps {
  model: ChatModel;
  data: SiteData;
  net: Net;
  semantic: SemanticIndex | null;
  /** The most model turns one question can take. */
  maxTurns?: number;
}

export type AgentEvent =
  | { type: 'tool'; name: string; args: Record<string, unknown> }
  | { type: 'answer'; answer: Answer };

export interface AgentRun {
  answer: Answer;
  calls: ToolCallRecord[];
}

const DEFAULT_MAX_TURNS = 8;

function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function ask(
  deps: AgentDeps,
  req: AskRequest,
  onEvent: (e: AgentEvent) => void = () => {},
): Promise<AgentRun> {
  const request = requestState(req);
  const ctx: ToolContext = { data: deps.data, net: deps.net, semantic: deps.semantic, request };

  const messages: ModelMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(req.conversation ?? []).map((t) => ({ role: t.role, content: t.content }) as ModelMessage),
    { role: 'user', content: `${req.question}\n\n${contextBlock(request, deps.data)}` },
  ];

  const calls: ToolCallRecord[] = [];
  let text: string | null = null;

  for (let turn = 0; turn < (deps.maxTurns ?? DEFAULT_MAX_TURNS); turn++) {
    // The first turn must call a tool. A small model left to choose will
    // sometimes answer from its own memory, and every site it names is then
    // invented. A question the tools cannot answer ("what's near me" with no
    // position) still gets a tool error back, and the model explains it.
    const reply = await deps.model.complete(messages, TOOL_SPECS, { requireTool: turn === 0 });
    if (!reply.toolCalls.length) {
      text = reply.content;
      break;
    }
    messages.push({ role: 'assistant', content: reply.content || null, toolCalls: reply.toolCalls });
    for (const call of reply.toolCalls) {
      const args = parseArgs(call.arguments);
      const outcome = args
        ? await runTool(ctx, call.name, args)
        : { result: { error: 'The arguments were not a JSON object.' }, siteIds: [] };
      onEvent({ type: 'tool', name: call.name, args: args ?? {} });
      calls.push({ name: call.name, args: args ?? {}, result: outcome.result, siteIds: outcome.siteIds });
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome.result) });
    }
  }

  // Out of turns: one last turn with no tools, so the user still gets an
  // answer from what the tools found.
  if (text === null) {
    messages.push({ role: 'user', content: 'Answer now from what the tools returned. Do not call more tools.' });
    text = (await deps.model.complete(messages, [])).content;
  }

  const answer = finishAnswer(text, { data: deps.data, request, calls });
  onEvent({ type: 'answer', answer });
  return { answer, calls };
}
