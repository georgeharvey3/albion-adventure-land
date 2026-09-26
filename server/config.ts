// The server's configuration, all from the environment (issue #62). The
// defaults are the laptop: vLLM on port 8000 and this server on port 8787.
// Production (issue #64) sets the same variables to Azure OpenAI.

import { openAiCompatible, type ChatModel } from './model';

export interface Config {
  port: number;
  modelUrl: string;
  model: string;
  apiKey?: string;
  temperature: number;
  extraBody?: Record<string, unknown>;
  timeoutMs: number;
}

function jsonEnv(name: string): Record<string, unknown> | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`${name} is not valid JSON: ${raw}`);
  }
}

export function loadConfig(env = process.env): Config {
  return {
    port: Number(env.ETHELRED_PORT ?? 8787),
    modelUrl: env.ETHELRED_MODEL_URL ?? 'http://localhost:8000/v1',
    model: env.ETHELRED_MODEL ?? 'Qwen/Qwen3.5-4B',
    apiKey: env.ETHELRED_API_KEY || undefined,
    temperature: Number(env.ETHELRED_TEMPERATURE ?? 0.3),
    extraBody: jsonEnv('ETHELRED_MODEL_EXTRA'),
    timeoutMs: Number(env.ETHELRED_MODEL_TIMEOUT_MS ?? 120_000),
  };
}

export function modelFromConfig(config: Config): ChatModel {
  return openAiCompatible({
    baseUrl: config.modelUrl,
    model: config.model,
    apiKey: config.apiKey,
    temperature: config.temperature,
    extraBody: config.extraBody,
    timeoutMs: config.timeoutMs,
  });
}
