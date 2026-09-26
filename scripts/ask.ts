// Ask the local Ethelred server one question from the terminal (issue #62).
//
//   npm run ask "Any swims on the way from Sheffield to Winchester?"
//   npm run ask -- --position 51.75,-1.26 "What's near me?"
//
// Options:
//   --position LAT,LNG   the live position to send
//   --now ISO            the local date and time (default: now)
//   --url URL            the server (default: http://localhost:8787, or ETHELRED_URL)
//
// Start the server first with `npm run ethelred`.

import type { Answer, AskRequest } from '../server/types';

function parseArgs(argv: string[]) {
  const out: { position?: { lat: number; lng: number }; now?: string; url?: string; question: string[] } = { question: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--position') {
      const [lat, lng] = argv[++i].split(',').map(Number);
      out.position = { lat, lng };
    } else if (a === '--now') out.now = argv[++i];
    else if (a === '--url') out.url = argv[++i];
    else out.question.push(a);
  }
  return out;
}

function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const question = args.question.join(' ').trim();
  if (!question) {
    console.error('Usage: npm run ask "your question"');
    process.exit(2);
  }
  const url = args.url ?? process.env.ETHELRED_URL ?? 'http://localhost:8787';
  const body: AskRequest = { question, now: args.now ?? localNow(), position: args.position ?? null };

  let res: Response;
  try {
    res = await fetch(`${url}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    console.error(`No Ethelred server at ${url}. Start it with: npm run ethelred`);
    process.exit(1);
  }
  if (!res.ok || !res.body) {
    console.error(`The server answered ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  let buffer = '';
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      const data = JSON.parse(/^data: (.*)$/m.exec(frame)?.[1] ?? 'null') as unknown;
      if (event === 'tool') {
        const { name, args: toolArgs } = data as { name: string; args: unknown };
        console.log(`· ${name} ${JSON.stringify(toolArgs)}`);
      } else if (event === 'answer') {
        printAnswer(data as Answer);
      } else if (event === 'error') {
        console.error(`Error: ${(data as { message: string }).message}`);
        process.exitCode = 1;
      }
    }
  }
}

function printAnswer(answer: Answer): void {
  console.log(`\n${answer.text}\n`);
  console.log(`Context: ${JSON.stringify(answer.context)}`);
  console.log(`Sites: ${answer.siteIds.join(', ') || '(none)'}`);
  for (const h of answer.handOffs) console.log(`Hand-off: ${JSON.stringify(h)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
