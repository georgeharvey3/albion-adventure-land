// `npm run eval` (issue #62): run the golden set against the configured model
// and print a pass rate for each case.
//
//   npm run eval                      every case, 3 runs each
//   npm run eval -- --runs 5          5 runs each
//   npm run eval -- --case postcode   only the cases whose id holds "postcode"
//   npm run eval -- --record          call the live services, save what they say
//   npm run eval -- --concurrency 4   run 4 questions at once
//   npm run eval -- --verbose         print every answer
//
// The network answers from recordings.json, so a run depends only on the
// model and works offline. The model is the one `npm run ethelred` uses: set
// ETHELRED_MODEL_URL and ETHELRED_MODEL to change it. The full report, with
// every answer and trace, goes to server/.cache/eval-report.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ask, type AgentDeps } from '../agent';
import { INDEX_PATH, loadSemantic } from '../boot';
import { loadSiteData } from '../data';
import { loadConfig, modelFromConfig } from '../config';
import type { AskRequest } from '../types';
import { CASES } from './cases';
import { checkRun, passed, type CheckResult, type EvalCase } from './checks';
import { recordedNet } from './recorded';

const RECORDINGS = resolve(import.meta.dirname, 'recordings.json');
const REPORT = resolve(dirname(INDEX_PATH), 'eval-report.json');

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

interface RunReport {
  ok: boolean;
  checks?: CheckResult;
  error?: string;
  text?: string;
  siteIds?: string[];
  calls?: { name: string; args: unknown }[];
}

async function runCase(deps: AgentDeps, c: EvalCase): Promise<RunReport> {
  const req: AskRequest = { question: c.question, now: '2026-09-26T10:00', ...c.request };
  const selected = req.selection ? deps.data.byId.get(req.selection) : undefined;
  try {
    const run = await ask(deps, req);
    const checks = checkRun(c, req, run, selected ? { lat: selected.lat, lng: selected.lng } : null);
    return {
      ok: passed(checks),
      checks,
      text: run.answer.text,
      siteIds: run.answer.siteIds,
      calls: run.calls.map((call) => ({ name: call.name, args: call.args })),
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Run `tasks` with at most `limit` at once, keeping their order. */
async function runLimited<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function reasons(runs: RunReport[]): string[] {
  const counts = new Map<string, number>();
  for (const r of runs) {
    if (r.ok) continue;
    const lines = r.error
      ? [`error: ${r.error}`]
      : [
          ...r.checks!.trace.map((t) => `trace: ${t}`),
          ...r.checks!.bounds.map((b) => `bounds: ${b}`),
          ...r.checks!.relevance.map((x) => `relevance: ${x}`),
        ];
    for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return [...counts].map(([line, n]) => `${n}× ${line}`);
}

async function main(): Promise<void> {
  const record = flag('record');
  const runs = Math.max(1, Number(option('runs') ?? (record ? 1 : 3)));
  const concurrency = Math.max(1, Number(option('concurrency') ?? 2));
  const filter = option('case');
  const cases = CASES.filter((c) => !filter || c.id.includes(filter));

  const config = loadConfig();
  const data = loadSiteData();
  const net = recordedNet(RECORDINGS, record ? 'record' : 'replay');
  const semantic = await loadSemantic(data);
  const model = modelFromConfig(config);
  const deps: AgentDeps = { model, data, net, semantic };

  console.log(`Running ${cases.length} cases × ${runs} runs against ${config.model} at ${config.modelUrl}\n`);

  const tasks = cases.flatMap((c) => Array.from({ length: runs }, () => () => runCase(deps, c)));
  const started = Date.now();
  const flat = await runLimited(tasks, concurrency);

  const report: Record<string, RunReport[]> = {};
  let passedRuns = 0;
  cases.forEach((c, i) => {
    const caseRuns = flat.slice(i * runs, (i + 1) * runs);
    report[c.id] = caseRuns;
    const ok = caseRuns.filter((r) => r.ok).length;
    passedRuns += ok;
    const rate = `${Math.round((ok / runs) * 100)}%`.padStart(4);
    console.log(`${rate}  ${ok}/${runs}  ${c.id}`);
    for (const line of reasons(caseRuns)) console.log(`             ${line}`);
    if (flag('verbose')) for (const r of caseRuns) console.log(`\n${r.text ?? r.error}\n`);
  });

  const total = cases.length * runs;
  console.log(`\nOverall: ${passedRuns}/${total} runs passed (${Math.round((passedRuns / total) * 100)}%) in ${Math.round((Date.now() - started) / 1000)} s`);

  if (record) {
    net.save();
    console.log(`Saved the recordings to ${RECORDINGS}`);
  } else if (net.misses.size) {
    console.log(`\n⚠ ${net.misses.size} network calls had no recording and answered as offline:`);
    for (const k of net.misses) console.log(`  ${k}`);
    console.log('Add them with: npm run eval -- --record');
  }

  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 1));
  console.log(`Full report: ${REPORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
