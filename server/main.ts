// The Ethelred server (issue #62). `POST /ask` takes one question and streams
// the answer back as server-sent events:
//
//   event: tool     one per tool call, so the app can say what Ethelred is doing
//   event: answer   the finished Answer (see ./types)
//   event: error    the question could not be answered
//
// Plain node:http, no framework: the server has one route that matters, and
// the dependency story is part of the product. It keeps no state between
// questions (docs/adr/0002-ethelred-server.md). Caps and the daily budget come
// with the public deployment in issue #64.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ask, type AgentDeps } from './agent';
import { loadSemantic } from './boot';
import { loadSiteData } from './data';
import { loadConfig, modelFromConfig } from './config';
import { liveNet } from './net';
import type { AskRequest } from './types';

const MAX_BODY = 512 * 1024;
const MAX_QUESTION = 2000;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) reject(new Error('The request is too large.'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const isStrings = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));

/** The request, or the reason it is not one. */
export function parseAskRequest(raw: string): AskRequest | string {
  let body: Partial<AskRequest>;
  try {
    body = JSON.parse(raw) as Partial<AskRequest>;
  } catch {
    return 'The body is not JSON.';
  }
  if (typeof body.question !== 'string' || !body.question.trim()) return 'question is required.';
  if (body.question.length > MAX_QUESTION) return `question is longer than ${MAX_QUESTION} characters.`;
  if (typeof body.now !== 'string') return 'now is required: the local date and time, e.g. "2026-09-26T14:30".';
  if (!isStrings(body.visited) || !isStrings(body.wishlist) || !isStrings(body.hidden)) {
    return 'visited, wishlist and hidden must be arrays of site ids.';
  }
  return body as AskRequest;
}

function cors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
}

function send(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function handler(deps: AgentDeps) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    cors(res);
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    if (req.method === 'GET' && req.url === '/health') {
      return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
    }
    if (req.method !== 'POST' || req.url !== '/ask') return void res.writeHead(404).end();

    let parsed: AskRequest | string;
    try {
      parsed = parseAskRequest(await readBody(req));
    } catch (err) {
      parsed = (err as Error).message;
    }
    if (typeof parsed === 'string') {
      return void res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: parsed }));
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    try {
      await ask(deps, parsed, (e) => (e.type === 'tool' ? send(res, 'tool', { name: e.name, args: e.args }) : send(res, 'answer', e.answer)));
    } catch (err) {
      console.error(err);
      send(res, 'error', { message: 'Ethelred could not answer that question.' });
    }
    res.end();
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const data = loadSiteData();
  console.log(`Loaded ${data.sites.length} sites and ${data.gazetteer.places.length} places.`);
  const semantic = await loadSemantic(data);
  const model = modelFromConfig(config);
  createServer(handler({ model, data, net: liveNet, semantic })).listen(config.port, () => {
    console.log(`Ethelred is listening on http://localhost:${config.port} (model ${config.model} at ${config.modelUrl}).`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
