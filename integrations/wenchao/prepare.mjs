import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));

export function patchWorker(source, fragment) {
  if (source.includes('function handleLotusRetrieve(')) throw new Error('Lotus integration already present');
  for (const symbol of ['embed', 'buildRetrieval', 'queryKnowledgeBase', 'lexicalSearch', 'fuseRRF', 'dedupeMatches', 'rerankMatches', 'chunksOf', 'ensureFts', 'writeD1', 'authenticate', 'enforceQuota']) {
    if (!source.includes(`function ${symbol}(`)) throw new Error(`Upstream contract changed: missing ${symbol}`);
  }
  const marker = 'export default {';
  const route = "    if (pathname === '/index') return handleIndex(req, env, url, headers);";
  if (source.split(marker).length !== 2 || source.split(route).length !== 2) throw new Error('Upstream route structure changed; inspect before applying');
  return source.replace(marker, `${fragment}\n\n${marker}`).replace(route,
    "    if (pathname === '/api/retrieve' || pathname === '/retrieve') return handleLotusRetrieve(req, env, headers).catch(() => lotusError(headers, 503, 'retrieval_unavailable', '检索服务暂时不可用，请稍后重试。'));\n" +
    "    if (pathname === '/index/daan') return handleLotusDaanIndex(req, env, headers).catch(() => lotusError(headers, 503, 'index_unavailable', '建库暂未完成，可使用同底本请求重试。'));\n" + route);
}

export function patchConfig(source) {
  const marker = 'routes = [\n';
  if (source.includes('wenchao.foyue.org/api/retrieve')) throw new Error('Retrieve route already present');
  if (source.split(marker).length !== 2) throw new Error('Upstream routes configuration changed');
  return source.replace(marker, marker + '  { pattern = "wenchao.foyue.org/api/retrieve*", zone_name = "foyue.org" },\n');
}

export async function prepare(sourceDir, outputDir) {
  const sourceWorker = resolve(sourceDir, 'worker.js');
  const sourceConfig = resolve(sourceDir, 'wrangler.toml');
  const [worker, config, fragment] = await Promise.all([
    readFile(sourceWorker, 'utf8'), readFile(sourceConfig, 'utf8'), readFile(resolve(here, 'lotus-retrieval.fragment.js'), 'utf8'),
  ]);
  if (resolve(sourceDir) === resolve(outputDir)) throw new Error('Output must be separate from the existing worker');
  await mkdir(outputDir, { recursive: true });
  const outputs = [['worker.js', patchWorker(worker, fragment), sourceWorker], ['wrangler.toml', patchConfig(config), sourceConfig]];
  let patch = '';
  for (const [name, contents, original] of outputs) {
    const destination = resolve(outputDir, name);
    await writeFile(destination, contents);
    const diff = spawnSync('diff', ['-u', '--label', `a/workers/ai-proxy/${name}`, '--label', `b/workers/ai-proxy/${name}`, original, destination], { encoding: 'utf8' });
    if (diff.status !== 0 && diff.status !== 1) throw new Error(diff.stderr || 'diff failed');
    patch += diff.stdout;
  }
  await writeFile(resolve(outputDir, 'lotus-retrieval.patch'), patch);
  const evidence = {
    preparedAt: new Date().toISOString(), sourceWorker, sourceConfig,
    sourceWorkerSha256: createHash('sha256').update(worker).digest('hex'),
    sourceConfigSha256: createHash('sha256').update(config).digest('hex'),
    modifiedExternalFiles: false,
  };
  await writeFile(resolve(outputDir, 'source-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  return { outputDir: resolve(outputDir), ...evidence };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
  if (args.includes('--help')) {
    console.log('node integrations/wenchao/prepare.mjs [--source ../wenchao/workers/ai-proxy] [--out integrations/wenchao/prepared]');
  } else {
    const result = await prepare(resolve(value('--source', '../wenchao/workers/ai-proxy')), resolve(value('--out', 'integrations/wenchao/prepared')));
    console.log(JSON.stringify(result, null, 2));
  }
}
