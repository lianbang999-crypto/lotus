import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto, createHash } from 'node:crypto';
import vm from 'node:vm';
import { patchWorker, patchConfig } from './prepare.mjs';
import { readDaanCorpus, batchArticles } from './prepare-daan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const upstream = resolve(here, '../../../wenchao/workers/ai-proxy');
const source = await readFile(resolve(upstream, 'worker.js'), 'utf8');
const fragment = await readFile(resolve(here, 'lotus-retrieval.fragment.js'), 'utf8');
const patched = patchWorker(source, fragment);

function runtime() {
  const calls = [];
  const sandbox = {
    Response, Request, URL, Headers, TextEncoder, TextDecoder, AbortSignal,
    ReadableStream, TransformStream, crypto: webcrypto, console, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      if (url.endsWith('/embeddings')) return Response.json({ data: body.input.map((_, index) => ({ index, embedding: [0.1, 0.2] })) });
      if (url.endsWith('/rerank')) return Response.json({ results: body.documents.map((_, index) => ({ index, relevance_score: 0.9 - index * 0.05 })) });
      if (url.endsWith('/chat/completions')) return Response.json({ choices: [{ message: { content: '{"q":"念佛摄心","kw":["念佛","摄心"]}' } }] });
      throw new Error(`Unexpected fetch: ${url}`);
    },
  };
  vm.runInNewContext(patched.replace('export default {', 'globalThis.worker = {') + '\nglobalThis.lotusHelpers = {lotusDaanChunks};', sandbox);
  return { worker: sandbox.worker, calls, helpers: sandbox.lotusHelpers };
}

function environment({ rows = [], db = true, vectorError = false } = {}) {
  const queries = [], sql = [], upserts = [], documents = new Map(), ftsRows = new Map();
  for (const row of rows.filter((r) => r.namespace === 'daan-v1')) documents.set(row.metadata.aid, { aid: row.metadata.aid, status: 'ready' });
  const env = {
    API_KEYS: JSON.stringify({ valid: { name: 'lotus', limit: 100 }, disabled: { disabled: true } }),
    INDEX_SECRET: 'test-index', SILICONFLOW_API_KEY: 'test-provider',
    VEC: {
      async query(vector, options) {
        queries.push(options);
        if (vectorError) throw new Error('Vector service unavailable');
        return { matches: rows.filter((r) => r.namespace === options.namespace).map(({ namespace, ...row }) => row) };
      },
      async upsert(values) { upserts.push(...values); },
    },
  };
  if (db) env.DB = {
    async exec(query) { sql.push(query); },
    prepare(query) {
      sql.push(query);
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async all() {
          if (query.startsWith('SELECT aid FROM lotus_daan_documents')) return { results: [...documents.entries()].filter(([aid, doc]) => doc.status === this.args[0] && this.args.slice(1).includes(aid)).map(([aid]) => ({ aid })) };
          return { results: [] };
        },
        async first() {
          if (query.includes('WHERE status = ? LIMIT 1')) return [...documents.values()].find((doc) => doc.status === this.args[0]) || null;
          return documents.get(this.args[0]) || null;
        },
        async run() {
          if (query.startsWith('INSERT INTO lotus_daan_documents')) documents.set(this.args[0], { content_hash: this.args[1], status: this.args[3] });
          if (query.startsWith('UPDATE lotus_daan_documents')) documents.get(this.args[1]).status = this.args[0];
          if (query.startsWith('DELETE FROM daan_chunks_fts')) ftsRows.delete(this.args[0]);
          if (query.startsWith('INSERT INTO daan_chunks_fts')) {
            const existing = ftsRows.get(this.args[4]) || [];
            existing.push(this.args[1]); ftsRows.set(this.args[4], existing);
          }
          return { success: true };
        },
      };
    },
    async batch(statements) { return Promise.all(statements.map((s) => s.run())); },
  };
  return { env, queries, sql, upserts, documents, ftsRows };
}

function request(body, key = 'valid', path = '/api/retrieve') {
  return new Request(`https://wenchao.foyue.org${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), Origin: 'https://wenchao.foyue.org' },
    body: JSON.stringify(body),
  });
}

const evidenceRows = [
  { id: 'zg1-001#0', namespace: 'v2', score: 0.8, metadata: { aid: 'zg1-001', title: '文钞测试篇', text: '测试原文甲', ctx: '前文。测试原文甲。后文。', url: '/a/zg1-001/?p=0', sourceType: 'primary', origKey: '测试原文甲' } },
  { id: 'daan-s01-01#0', namespace: 'daan-v1', score: 0.9, metadata: { aid: 'daan-s01-01', title: '讲记测试篇', text: '测试讲记乙', ctx: '测试讲记乙', url: 'https://foyue.org/text/s01/01.txt', sourceType: 'teaching', origKey: '测试讲记乙' } },
  { id: 'old#0', namespace: undefined, score: 1, metadata: { aid: 'old', title: 'Legacy data must not leak', text: '错误的旧库', origKey: '错误的旧库' } },
];

test('preparation validates upstream contracts and adds only explicit routes', async () => {
  assert.match(patched, /pathname === '\/api\/retrieve'/);
  assert.match(patched, /pathname === '\/index\/daan'/);
  assert.throws(() => patchWorker(patched, fragment), /already present/);
  assert.throws(() => patchWorker(source.replace('async function embed(', 'async function renamed('), fragment), /missing embed/);
  const config = patchConfig(await readFile(resolve(upstream, 'wrangler.toml'), 'utf8'));
  assert.match(config, /wenchao.foyue.org\/api\/retrieve\*/);
});

test('retrieval requires a valid service key even with a first-party Origin', async () => {
  const { worker, calls } = runtime();
  const { env } = environment();
  for (const token of ['', 'wrong', 'disabled']) {
    const result = await worker.fetch(request({ query: '念佛摄心' }, token), env, {});
    assert.equal(result.status, 401);
    assert.equal((await result.json()).error.code, 'unauthorized');
  }
  assert.equal(calls.length, 0);
});

test('retrieval reuses ranking, returns distinct source roles and makes no answer-generation call', async () => {
  const { worker, calls } = runtime();
  const { env, queries, sql } = environment({ rows: evidenceRows });
  const response = await worker.fetch(request({ query: '如何念佛摄心？' }), env, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.passages.length, 2);
  assert.deepEqual(new Set(body.passages.map((p) => `${p.corpus}:${p.role}`)), new Set(['yinguang:basis', 'daan:guide']));
  assert.equal(body.passages[0].context.includes(body.passages[0].text), true);
  assert.equal(body.passages.some((p) => p.aid === 'old'), false);
  assert.equal(calls.some((c) => c.url.endsWith('/chat/completions')), false);
  assert.equal(calls.some((c) => c.url.endsWith('/rerank')), true);
  assert.equal(queries.every((q) => ['v2', 'daan-v1'].includes(q.namespace)), true);
  assert.equal(sql.some((s) => s.includes('daan_chunks_fts MATCH')), true);
});

test('empty namespace fallback cannot leak legacy or another corpus', async () => {
  const { worker } = runtime();
  const { env, queries, documents } = environment({ rows: evidenceRows.filter((r) => r.namespace !== 'daan-v1') });
  documents.set('daan-s01-01', { aid: 'daan-s01-01', status: 'ready' });
  const response = await worker.fetch(request({ query: '摄心', corpora: ['daan'] }), env, {});
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).passages, []);
  assert.equal(queries.length, 3);
  assert.equal(queries.every((q) => q.namespace === 'daan-v1'), true);
});

test('Daan data is unavailable before ingestion and pending chunks are never returned', async () => {
  const { worker } = runtime();
  const { env, documents } = environment({ rows: evidenceRows });
  documents.get('daan-s01-01').status = 'pending';
  let body = await (await worker.fetch(request({ query: '摄心' }), env, {})).json();
  assert.deepEqual(body.retrieval.unavailableCorpora, ['daan']);
  assert.equal(body.passages.some((p) => p.corpus === 'daan'), false);
  documents.set('daan-s01-02', { aid: 'daan-s01-02', status: 'ready' });
  body = await (await worker.fetch(request({ query: '摄心', corpora: ['daan'] }), env, {})).json();
  assert.deepEqual(body.passages, []);
});

test('unavailable retrieval returns an explicit error instead of empty evidence', async () => {
  const { worker } = runtime();
  const { env } = environment({ db: false, vectorError: true });
  const response = await worker.fetch(request({ query: '摄心' }), env, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'retrieval_unavailable');
});

test('invalid corpus/topK/query is rejected before provider calls', async () => {
  const { worker, calls } = runtime();
  const { env } = environment();
  for (const body of [{ query: 'a', corpora: ['__proto__'] }, { query: 'a', topK: 99 }, { query: '' }, { query: 'a', corpora: ['daan', 'daan'] }]) {
    assert.equal((await worker.fetch(request(body), env, {})).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('optional query rewrite is isolated from answer generation', async () => {
  const { worker, calls } = runtime();
  const { env } = environment({ rows: evidenceRows });
  const response = await worker.fetch(request({ query: '心乱怎么办', rewrite: true }), env, {});
  assert.equal(response.status, 200);
  const chatCalls = calls.filter((c) => c.url.endsWith('/chat/completions'));
  assert.equal(chatCalls.length, 1);
  assert.equal(chatCalls[0].body.max_tokens, 120);
  assert.equal(chatCalls[0].body.stream, false);
  assert.equal((await response.json()).retrieval.rewritten, true);
});

test('parent evidence never substitutes an unrelated prefix for a later hit', async () => {
  const { worker } = runtime();
  const late = { ...evidenceRows[0], metadata: { ...evidenceRows[0].metadata, ctx: 'Earlier truncated paragraph without the matching text' } };
  const { env } = environment({ rows: [late] });
  const body = await (await worker.fetch(request({ query: '摄心', corpora: ['yinguang'] }), env, {})).json();
  assert.equal(body.passages[0].context, body.passages[0].text);
});

function article(text = '这是一段仅用于接口测试的讲记文字。') {
  return { id: 'daan-qa-001', title: '接口测试', volume: 'daan', corpus: 'daan', role: 'guide', plain: true, sourcePath: 'qa/001.txt', contentHash: createHash('sha256').update(text).digest('hex'), segments: [{ orig: [text] }] };
}

test('Daan dry-run validates provenance and chunks without any writes or provider call', async () => {
  const { worker, calls } = runtime();
  const { env, sql, upserts } = environment();
  const response = await worker.fetch(request({ articles: [article()], dryRun: true }, 'test-index', '/api/ai/index/daan'), env, {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).chunks, 1);
  assert.equal(sql.length, 0); assert.equal(upserts.length, 0); assert.equal(calls.length, 0);
  const forged = article(); forged.contentHash = '0'.repeat(64);
  assert.equal((await worker.fetch(request({ articles: [forged], dryRun: true }, 'test-index', '/api/ai/index/daan'), env, {})).status, 400);
});

test('Daan ingestion is additive, same-edition retry replaces FTS rows, changed edition conflicts', async () => {
  const { worker } = runtime();
  const { env, sql, upserts, documents, ftsRows } = environment();
  for (let i = 0; i < 2; i++) {
    const response = await worker.fetch(request({ articles: [article()], dryRun: false }, 'test-index', '/api/ai/index/daan'), env, {});
    assert.equal(response.status, 200);
  }
  assert.equal(upserts.every((v) => v.namespace === 'daan-v1' && v.metadata.role === 'guide'), true);
  assert.equal(ftsRows.get('daan-qa-001').length, 1);
  assert.equal(documents.get('daan-qa-001').status, 'ready');
  assert.equal(sql.some((s) => /DROP TABLE/.test(s)), false);
  assert.equal(sql.some((s) => /(?:INTO|FROM) chunks_fts\b/.test(s)), false);
  assert.equal((await worker.fetch(request({ articles: [article('不同版本。')], dryRun: false }, 'test-index', '/api/ai/index/daan'), env, {})).status, 409);
});

test('an interrupted vector write returns a structured failure and leaves the article pending', async () => {
  const { worker } = runtime();
  const { env, documents } = environment();
  env.VEC.upsert = async () => { throw new Error('Private provider internal details'); };
  const response = await worker.fetch(request({ articles: [article()], dryRun: false }, 'test-index', '/api/ai/index/daan'), env, {});
  assert.equal(response.status, 503);
  assert.equal(documents.get('daan-qa-001').status, 'pending');
  const body = await response.json();
  assert.equal(body.error.code, 'index_unavailable');
  assert.equal(JSON.stringify(body).includes('Private provider'), false);
});

test('adapter validates the existing local Daan library and excludes sutras', async () => {
  const { articles, report } = await readDaanCorpus(resolve(here, '../../../foyue01/public'));
  assert.ok(articles.length > 1000);
  assert.equal(articles.every((a) => a.corpus === 'daan' && a.role === 'guide' && !a.sourcePath.startsWith('jing/')), true);
  assert.equal(report.excluded[0].series, 'jing');
  assert.equal(report.remoteWrites, 0);
  const { helpers } = runtime();
  for (const a of articles) assert.ok(helpers.lotusDaanChunks(a).length > 0);
  assert.equal(batchArticles(articles).every((b) => b.length <= 8 && JSON.stringify({ articles: b, dryRun: true }).length <= 500000), true);
});
