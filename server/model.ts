// The model adapter (issue #62). One OpenAI-compatible adapter behind a thin
// interface: development points it at vLLM on a laptop, production at Azure
// OpenAI (docs/adr/0002-ethelred-server.md). A change of model is a change of
// configuration, and the eval measures the result.
//
// No SDK: the chat-completions call is one POST, and the dependency story is
// part of the product.

export interface ToolCall {
  id: string;
  name: string;
  /** The arguments as the model wrote them: a JSON string, not yet trusted. */
  arguments: string;
}

export type ModelMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelTurn {
  content: string;
  toolCalls: ToolCall[];
}

export interface CompleteOptions {
  /** The model must call a tool on this turn. */
  requireTool?: boolean;
}

export interface ChatModel {
  complete(messages: ModelMessage[], tools: ToolSpec[], options?: CompleteOptions): Promise<ModelTurn>;
}

export interface OpenAiConfig {
  /** The base URL, up to and including `/v1`. */
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  /** Extra fields merged into each request body, for server-specific options
   *  such as `chat_template_kwargs`. */
  extraBody?: Record<string, unknown>;
  timeoutMs?: number;
}

interface WireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface WireResponse {
  choices?: { message?: { content?: string | null; tool_calls?: WireToolCall[] } }[];
  error?: { message?: string };
}

function toWire(m: ModelMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
    };
  }
  return { role: m.role, content: m.content ?? '' };
}

export function openAiCompatible(config: OpenAiConfig): ChatModel {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    async complete(messages, tools, options = {}) {
      const body = {
        model: config.model,
        messages: messages.map(toWire),
        ...(tools.length
          ? { tools: tools.map((t) => ({ type: 'function', function: t })), tool_choice: options.requireTool ? 'required' : 'auto' }
          : {}),
        temperature: config.temperature ?? 0.3,
        ...config.extraBody,
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}`, 'api-key': config.apiKey } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs ?? 120_000),
      });
      const json = (await res.json().catch(() => ({}))) as WireResponse;
      if (!res.ok) throw new Error(`Model endpoint answered ${res.status}: ${json.error?.message ?? res.statusText}`);

      const message = json.choices?.[0]?.message;
      return {
        content: message?.content ?? '',
        toolCalls: (message?.tool_calls ?? []).map((c, i) => ({
          id: c.id ?? `call_${i}`,
          name: c.function?.name ?? '',
          arguments: c.function?.arguments ?? '{}',
        })),
      };
    },
  };
}
