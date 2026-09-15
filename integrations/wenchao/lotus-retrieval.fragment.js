/* Lotus integration. Included in wenchao-ai before its default export by prepare.mjs.
 * Reuses its embedding, query rewrite, FTS, RRF, dedupe, rerank and chunking helpers.
 * Does not call handleAsk, condenseQuestion, answer generation or answer caching.
 */
const LOTUS_CORPORA = Object.freeze({
  yinguang: { namespace: KB_NAMESPACE, table: 'chunks_fts', role: 'basis', origin: SITE_BASE },
  daan: { namespace: 'daan-v1', table: 'daan_chunks_fts', role: 'guide', origin: 'https://foyue.org' },
});

function lotusError(headers, status, code, message) {
  return json({ ok: false, error: { code, message } }, status, headers);
}

// Every vector attempt, including queryKnowledgeBase's legacy fallback, stays in
// the requested corpus. The table name comes only from this fixed local map.
function lotusCorpusEnv(env, corpus, health = {}) {
  const config = LOTUS_CORPORA[corpus];
  const sqlForCorpus = (sql) => sql.replace(/\bchunks_fts\b/g, config.table);
  const instrumentStatement = (statement) => ({
    bind: (...values) => instrumentStatement(statement.bind(...values)),
    async all() {
      try { return await statement.all(); }
      catch (error) { health.lexicalError = true; throw error; }
    },
    first: (...args) => statement.first(...args),
    run: (...args) => statement.run(...args),
    // D1.batch needs its native prepared statements, not this wrapper.
    _lotusNativeStatement: statement,
  });
  return {
    ...env,
    VEC: env.VEC && {
      async query(vector, options) {
        try {
          const result = await env.VEC.query(vector, { ...options, namespace: config.namespace });
          health.vector = true;
          return result;
        } catch (error) { health.vectorError = true; throw error; }
      },
      upsert: (rows) => env.VEC.upsert(rows.map((row) => ({ ...row, namespace: config.namespace }))),
    },
    DB: env.DB && {
      prepare: (sql) => instrumentStatement(env.DB.prepare(sqlForCorpus(sql))),
      exec: (sql) => env.DB.exec(sqlForCorpus(sql)),
      batch: (statements) => env.DB.batch(statements.map((s) => s._lotusNativeStatement || s)),
    },
  };
}

async function lotusKeyAuth(req, env, headers) {
  // This is a service-to-service endpoint. Origin/Referer is never authority.
  if (!extractApiKey(req)) return { response: lotusError(headers, 401, 'unauthorized', '检索服务需要服务端 API key。') };
  const auth = await authenticate(req, env);
  if (auth.error || auth.kind !== 'key') return { response: lotusError(headers, 401, 'unauthorized', '检索服务 API key 无效或已停用。') };
  return { auth };
}

function lotusPassage(match, index) {
  const md = match.metadata || {};
  const config = LOTUS_CORPORA[md.corpus];
  const text = md.text || '';
  // The original index clips parents at 1100 characters. Later child chunks
  // may lie outside that prefix: never claim that prefix contains the hit.
  const context = md.ctx && md.ctx.includes(text) ? md.ctx : text;
  const location = {};
  for (const key of ['pIndex', 'paraIndex', 'seg', 'part']) {
    if (md[key] !== undefined && md[key] !== null && md[key] !== '' && Number.isInteger(Number(md[key])) && Number(md[key]) >= 0) location[key] = Number(md[key]);
  }
  let url = '';
  try {
    const target = new URL(md.url || articlePath(md.aid, md.pIndex), config.origin);
    if (target.protocol === 'https:' && target.origin === config.origin) url = target.href;
  } catch { /* Return evidence text without an unsafe or fabricated link. */ }
  return {
    n: index + 1, id: match.id, aid: md.aid || '', title: md.title || '', text, context, url,
    ...location,
    vol: md.vol || '', volName: md.volName || '', sourceType: md.sourceType || '',
    corpus: md.corpus, role: config.role,
    score: Number.isFinite(match.score) ? match.score : null,
    ...(Number.isFinite(match.rerankScore) ? { rerankScore: match.rerankScore } : {}),
  };
}

async function handleLotusRetrieve(req, env, headers) {
  const access = await lotusKeyAuth(req, env, headers);
  if (access.response) return access.response;
  let body;
  try {
    const raw = await req.text();
    if (raw.length > 12000) return lotusError(headers, 413, 'request_too_large', '检索请求过长。');
    body = JSON.parse(raw);
  } catch { return lotusError(headers, 400, 'invalid_request', '请提交 JSON 检索请求。'); }
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  const corpora = body?.corpora === undefined ? ['yinguang', 'daan'] : body.corpora;
  const topK = body?.topK === undefined ? TOP_K : body.topK;
  if (!query || query.length > 2000 || !Array.isArray(corpora) || !corpora.length ||
      corpora.length > 2 || corpora.some((c) => !Object.hasOwn(LOTUS_CORPORA, c)) ||
      new Set(corpora).size !== corpora.length || !Number.isInteger(topK) || topK < 1 || topK > TOP_K ||
      (body.rewrite !== undefined && typeof body.rewrite !== 'boolean')) {
    return lotusError(headers, 400, 'invalid_request', '请提供有效的问题、语料范围和结果数量（1–8）。');
  }
  if (!env.VEC && !env.DB) return lotusError(headers, 503, 'retrieval_unavailable', '检索索引尚未配置。');
  const quota = await enforceQuota(req, env, access.auth);
  if (quota.limited) return lotusError(headers, 429, 'quota_exceeded', quota.message);
  const plan = body.rewrite === true ? await buildRetrieval(env, query) : { queries: [query], terms: naiveTerms(query) };
  const warnings = [], unavailableCorpora = [];
  let vectors = [];
  if (env.VEC && env.SILICONFLOW_API_KEY) {
    try { vectors = await embed(env, plan.queries); }
    catch { warnings.push('embedding_unavailable'); }
  } else warnings.push('vector_unconfigured');

  const pools = await Promise.all(corpora.map(async (corpus) => {
    const health = { vector: false, lexical: false };
    const scoped = lotusCorpusEnv(env, corpus, health);
    if (corpus === 'daan') {
      try {
        const ready = await env.DB.prepare('SELECT aid FROM lotus_daan_documents WHERE status = ? LIMIT 1').bind('ready').first();
        if (!ready) throw new Error('No completed Daan ingestion');
      } catch {
        unavailableCorpora.push(corpus);
        warnings.push('daan:not_indexed');
        return { matches: [], vector: false, lexical: false };
      }
    }
    let lexical = [];
    if (scoped.DB) {
      try {
        // Probe explicitly: lexicalSearch's best-effort catch otherwise hides
        // the difference between an empty result and an unbuilt corpus.
        await scoped.DB.prepare('SELECT 1 FROM chunks_fts LIMIT 1').all();
        health.lexical = true;
        lexical = await lexicalSearch(scoped, plan.terms, null);
        if (health.lexicalError) { health.lexical = false; warnings.push(`${corpus}:lexical_unavailable`); }
      } catch { warnings.push(`${corpus}:lexical_unavailable`); }
    }
    let matches = vectors.length
      ? mergeMatchPools(await Promise.all(vectors.map((v) => queryKnowledgeBase(scoped, v, null)))) : [];
    matches.sort((a, b) => (b.score || 0) - (a.score || 0));
    if (corpus === 'daan') {
      // Vectorize and D1 writes are not one transaction. Only completed source
      // documents may be shown; pending or interrupted imports stay invisible.
      const aids = [...new Set([...matches, ...lexical].map((m) => m.metadata?.aid).filter(Boolean))];
      if (aids.length) {
        try {
          const allowed = new Set();
          for (let i = 0; i < aids.length; i += 50) {
            const batch = aids.slice(i, i + 50);
            const ready = await env.DB.prepare(`SELECT aid FROM lotus_daan_documents WHERE status = ? AND aid IN (${batch.map(() => '?').join(',')})`).bind('ready', ...batch).all();
            for (const row of ready.results || []) allowed.add(row.aid);
          }
          matches = matches.filter((m) => allowed.has(m.metadata?.aid));
          lexical = lexical.filter((m) => allowed.has(m.metadata?.aid));
        } catch {
          unavailableCorpora.push(corpus);
          warnings.push('daan:manifest_unavailable');
          return { matches: [], vector: false, lexical: false };
        }
      }
    }
    if (!health.vector && !health.lexical) unavailableCorpora.push(corpus);
    if (health.vectorError) warnings.push(`${corpus}:vector_unavailable`);
    return {
      matches: (lexical.length ? fuseRRF([matches, lexical]) : matches)
        .map((m) => ({ ...m, metadata: { ...m.metadata, corpus } })),
      vector: health.vector, lexical: health.lexical,
    };
  }));
  if (unavailableCorpora.length === corpora.length) {
    return lotusError(headers, 503, 'retrieval_unavailable', '检索服务暂时不可用，请稍后重试。');
  }
  // Fuse across corpora by rank as well: vector cosine and RRF scores have
  // different scales, so they must not be directly compared.
  let matches = dedupeMatches(fuseRRF(pools.map((p) => p.matches)));
  matches = await rerankMatches(env, query, matches);
  const passages = matches.slice(0, topK).map(lotusPassage);
  const sources = [...new Map(passages.map((p) => [`${p.corpus}:${p.aid}`, {
    id: p.aid, title: p.title, url: p.url, corpus: p.corpus, role: p.role,
  }])).values()];
  const vector = pools.some((p) => p.vector), lexical = pools.some((p) => p.lexical);
  return json({ ok: true, query, passages, sources, retrieval: {
    version: 'lotus-r1', mode: vector && lexical ? 'hybrid' : vector ? 'vector' : 'lexical',
    corpora, warnings, unavailableCorpora, rewritten: plan.queries.length > 1,
  } }, 200, headers);
}

function lotusDaanChunks(article) {
  if (!article || typeof article.id !== 'string' || !/^daan-(?:s\d{2}|loose|qa)-\d{2,4}$/.test(article.id) ||
      typeof article.title !== 'string' || !article.title.trim() || article.title.length > 500 ||
      article.corpus !== 'daan' || article.role !== 'guide' || article.plain !== true ||
      !Array.isArray(article.segments) || !article.segments.length ||
      typeof article.sourcePath !== 'string' || !/^(?:s\d{2}|loose|qa)\/\d{2,4}\.txt$/.test(article.sourcePath) ||
      article.id !== 'daan-' + article.sourcePath.replace(/\.txt$/, '').replace('/', '-') ||
      typeof article.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(article.contentHash)) {
    throw new Error('Invalid Daan article identity or provenance');
  }
  let length = 0;
  for (const segment of article.segments) {
    if (!Array.isArray(segment.orig) || !segment.orig.length || segment.trans?.length ||
        segment.orig.some((p) => typeof p !== 'string' || !p.trim())) throw new Error('Invalid Daan paragraphs');
    length += segment.orig.reduce((total, p) => total + p.length, 0);
  }
  if (length > 250000) throw new Error('Daan article too large');
  const sourceURL = `https://foyue.org/text/${article.sourcePath}`;
  return chunksOf(article).map((chunk) => ({ ...chunk, meta: {
    ...chunk.meta, sourceType: 'teaching', corpus: 'daan', role: 'guide',
    url: sourceURL, sourcePath: article.sourcePath, contentHash: article.contentHash,
  } }));
}

async function handleLotusDaanIndex(req, env, headers) {
  const secret = req.headers.get('X-Index-Secret') || extractApiKey(req);
  if (!env.INDEX_SECRET || secret !== env.INDEX_SECRET) return lotusError(headers, 403, 'forbidden', '建库密钥无效。');
  let body;
  try {
    const raw = await req.text();
    if (raw.length > 500000) return lotusError(headers, 413, 'request_too_large', '每批资料过大。');
    body = JSON.parse(raw);
  } catch { return lotusError(headers, 400, 'invalid_request', '请提交 JSON 建库请求。'); }
  if (!Array.isArray(body?.articles) || !body.articles.length || body.articles.length > 8 ||
      typeof body.dryRun !== 'boolean' || new Set(body.articles.map((a) => a?.id)).size !== body.articles.length) {
    return lotusError(headers, 400, 'invalid_request', '每批提交 1–8 篇，明确指定 dryRun。');
  }
  let groups;
  try {
    groups = await Promise.all(body.articles.map(async (article) => {
      const chunks = lotusDaanChunks(article);
      const hash = await sha256(article.segments.flatMap((s) => s.orig).join('\n'));
      if (hash !== article.contentHash) throw new Error('Content hash mismatch');
      return { article, chunks };
    }));
  } catch (error) { return lotusError(headers, 400, 'invalid_article', error.message); }
  const total = groups.reduce((sum, g) => sum + g.chunks.length, 0);
  if (body.dryRun) return json({ ok: true, dryRun: true, articles: groups.length, chunks: total, corpus: 'daan', role: 'guide', namespace: 'daan-v1' }, 200, headers);
  if (!env.DB || !env.VEC || !env.SILICONFLOW_API_KEY) return lotusError(headers, 503, 'index_unconfigured', '建库需要 D1、Vectorize 与嵌入密钥。');
  const scoped = lotusCorpusEnv(env, 'daan');
  if (!await ensureFts(scoped, false)) return lotusError(headers, 503, 'index_unavailable', '大安法师全文索引不可用。');
  await env.DB.exec('CREATE TABLE IF NOT EXISTS lotus_daan_documents (aid TEXT PRIMARY KEY, content_hash TEXT NOT NULL, chunks INTEGER NOT NULL, status TEXT NOT NULL)');
  // Check the whole batch before any vector mutation. Changed editions need a
  // reviewed replacement migration; silently leaving obsolete vectors is unsafe.
  for (const { article } of groups) {
    const existing = await env.DB.prepare('SELECT content_hash FROM lotus_daan_documents WHERE aid = ?').bind(article.id).first();
    if (existing && existing.content_hash !== article.contentHash) return lotusError(headers, 409, 'edition_conflict', `篇目 ${article.id} 已有不同底本，请先审查替换迁移。`);
  }
  for (const { article, chunks } of groups) {
    await env.DB.prepare('INSERT INTO lotus_daan_documents(aid,content_hash,chunks,status) VALUES (?,?,?,?) ON CONFLICT(aid) DO UPDATE SET status=excluded.status')
      .bind(article.id, article.contentHash, chunks.length, 'pending').run();
    const stored = await env.DB.prepare('SELECT content_hash FROM lotus_daan_documents WHERE aid = ?').bind(article.id).first();
    if (stored?.content_hash !== article.contentHash) return lotusError(headers, 409, 'edition_conflict', `篇目 ${article.id} 已有不同底本，请先审查替换迁移。`);
    for (let i = 0; i < chunks.length; i += INDEX_EMBED_BATCH) {
      const batch = chunks.slice(i, i + INDEX_EMBED_BATCH);
      const vectors = await embed(env, batch.map((c) => c.text));
      if (vectors.length !== batch.length) throw new Error('Embedding count mismatch');
      await scoped.VEC.upsert(batch.map((c, k) => ({ id: c.id, values: vectors[k], metadata: { ...c.meta, text: c.text } })));
    }
    await scoped.DB.prepare('DELETE FROM chunks_fts WHERE aid = ?').bind(article.id).run();
    const written = await writeD1(scoped, chunks);
    if (written !== chunks.length) return lotusError(headers, 503, 'index_partial', `篇目 ${article.id} 尚未完整入库，可用同一批安全重试。`);
    await env.DB.prepare('UPDATE lotus_daan_documents SET status = ? WHERE aid = ?').bind('ready', article.id).run();
  }
  return json({ ok: true, dryRun: false, articles: groups.length, chunks: total, corpus: 'daan', role: 'guide', namespace: 'daan-v1' }, 200, headers);
}
