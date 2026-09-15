import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export async function readDaanCorpus(publicDir) {
  const root = await realpath(publicDir);
  const libraryText = await readFile(resolve(root, 'library.json'), 'utf8');
  const library = JSON.parse(libraryText);
  if (!Array.isArray(library.series) || !Array.isArray(library.qa)) throw new Error('Invalid library.json contract');
  const records = [], excluded = [];
  for (const series of library.series) {
    // jing contains sutras, liturgy and Yinguang prefaces. They are not Daan
    // lectures and must never be relabelled as guide material.
    if (series.id === 'jing') { excluded.push({ series: series.id, reason: 'sutras_and_prefaces', count: series.chapters?.length || 0 }); continue; }
    if (!/^(?:s\d{2}|loose)$/.test(series.id) || !Array.isArray(series.chapters)) throw new Error(`Unreviewed series: ${series.id}`);
    records.push(...series.chapters.map((chapter) => ({ ...chapter, volumeName: series.title, series: series.id })));
  }
  records.push(...library.qa.map((chapter) => ({ ...chapter, volumeName: '大安法师学佛问答', series: 'qa' })));
  const articles = [], ids = new Set();
  for (const record of records) {
    if (typeof record.path !== 'string' || !/^(?:s\d{2}|loose|qa)\/\d{2,4}\.txt$/.test(record.path) || record.path.split('/')[0] !== record.series) throw new Error('Invalid or mismatched source path');
    const path = await realpath(resolve(root, 'text', record.path));
    const rel = relative(resolve(root, 'text'), path);
    if (rel.startsWith('..' + sep) || rel === '..') throw new Error('Source text escapes the library root');
    const source = await readFile(path, 'utf8');
    if (source.includes('\uFFFD')) throw new Error(`Invalid decoding in ${record.path}`);
    const paragraphs = source.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
    if (!paragraphs.length || !record.title?.trim()) throw new Error(`Empty source: ${record.path}`);
    const text = paragraphs.join('\n');
    if (text.length > 250000) throw new Error(`Source exceeds ingestion limit: ${record.path}`);
    const id = 'daan-' + record.path.replace(/\.txt$/, '').replace('/', '-');
    if (ids.has(id)) throw new Error(`Duplicate source: ${id}`);
    ids.add(id);
    articles.push({
      id, title: record.title, volume: 'daan', volumeName: record.volumeName,
      corpus: 'daan', role: 'guide', plain: true,
      sourcePath: record.path, sourceURL: `https://foyue.org/text/${record.path}`,
      contentHash: sha256(text), sourceFileHash: sha256(source),
      segments: [{ orig: paragraphs }],
    });
  }
  return { articles, report: {
    sourcePublicDir: root, libraryGeneratedAt: library.generatedAt,
    libraryHash: sha256(libraryText), articles: articles.length,
    paragraphs: articles.reduce((n, a) => n + a.segments[0].orig.length, 0),
    characters: articles.reduce((n, a) => n + a.segments[0].orig.join('\n').length, 0),
    excluded, corpus: 'daan', role: 'guide', remoteWrites: 0,
  } };
}

export function batchArticles(articles) {
  const batches = [];
  let batch = [];
  for (const article of articles) {
    const candidate = [...batch, article];
    if (batch.length && (candidate.length > 8 || JSON.stringify({ articles: candidate, dryRun: false }).length > 480000)) {
      batches.push(batch); batch = [];
    }
    batch.push(article);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
  if (args.includes('--help')) {
    console.log('node integrations/wenchao/prepare-daan.mjs [--source ../foyue01/public] [--out integrations/wenchao/daan-prepared]');
    console.log('Default: validate and print a local dry-run report. --out writes local JSON request batches only. No network calls.');
  } else {
    const { articles, report } = await readDaanCorpus(resolve(value('--source', '../foyue01/public')));
    const batches = batchArticles(articles);
    const output = value('--out', '');
    if (output) {
      await mkdir(output, { recursive: true });
      for (let i = 0; i < batches.length; i++) {
        await writeFile(resolve(output, `batch-${String(i).padStart(4, '0')}.json`), JSON.stringify({ articles: batches[i], dryRun: true }));
      }
      await writeFile(resolve(output, 'report.json'), JSON.stringify({ ...report, batches: batches.length }, null, 2) + '\n');
    }
    console.log(JSON.stringify({ ...report, batches: batches.length, ...(output ? { output: resolve(output) } : {}) }, null, 2));
  }
}
