// Explicit operator command. prepare-daan.mjs is entirely local; this command
// contacts the configured Worker and requires --dry-run or --execute.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const dryRun = args.includes('--dry-run'), execute = args.includes('--execute');
if (args.includes('--help') || dryRun === execute) {
  console.log('WENCHAO_INDEX_SECRET=<secret> node integrations/wenchao/submit-daan.mjs --batches integrations/wenchao/daan-prepared (--dry-run | --execute) [--from 0] [--limit 1]');
  console.log('Optional WENCHAO_INDEX_URL must be the HTTPS /api/ai/index/daan endpoint. Sends batches sequentially and stops on the first failure.');
  process.exit(dryRun === execute && !args.includes('--help') ? 1 : 0);
}
const token = process.env.WENCHAO_INDEX_SECRET;
if (!token) throw new Error('Set WENCHAO_INDEX_SECRET in the process environment; do not put it in a file or command argument');
const endpoint = new URL(process.env.WENCHAO_INDEX_URL || 'https://wenchao.foyue.org/api/ai/index/daan');
if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/api/ai/index/daan' || endpoint.username || endpoint.password || endpoint.search) throw new Error('Invalid HTTPS Daan index endpoint');
const directory = resolve(value('--batches', 'integrations/wenchao/daan-prepared'));
const from = Number(value('--from', '0')), limit = Number(value('--limit', '1'));
if (!Number.isInteger(from) || from < 0 || !Number.isInteger(limit) || limit < 1) throw new Error('Invalid batch range');
const files = (await readdir(directory)).filter((name) => /^batch-\d{4}\.json$/.test(name)).sort().slice(from, from + limit);
if (!files.length) throw new Error('No batches in selected range');
for (const file of files) {
  const body = JSON.parse(await readFile(resolve(directory, file), 'utf8'));
  body.dryRun = dryRun;
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180000),
    headers: { 'Content-Type': 'application/json', 'X-Index-Secret': token }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(`${file}: ${response.status} ${result.error?.code || 'index_failed'}; stopped, retry from this batch after resolving the cause`);
  console.log(JSON.stringify({ file, dryRun: result.dryRun, articles: result.articles, chunks: result.chunks }));
}
