require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sources, signals, exclusions, dedup, runLog } = require('../db');
const { extract } = require('./extract');
const rss = require('../methods/rss');
const webpage = require('../methods/webpage');
const email = require('../methods/email');
const { detect: detectMethod } = require('../methods/detect');

async function fetchSource(source) {
  const method = source.last_successful_method || source.method || 'auto';
  if (method === 'auto') {
    const d = await detectMethod(source.url);
    return fetchByMethod(source, d.method, d.resolved_url || source.url);
  }
  return fetchByMethod(source, method, source.url);
}

async function fetchByMethod(source, method, url) {
  if (method === 'rss') return { ...(await rss.fetch(url, source.last_run)), method };
  if (method === 'email_inbox') return { ...(await email.fetch(url, source.last_run)), method };
  const r = await webpage.fetch(url);
  return { ...r, method };
}

async function runPipeline(opts = {}) {
  const runId = runLog.start();
  const stats = { sources_attempted:0, sources_succeeded:0, signals_extracted:0, signals_suppressed:0, signals_written:0, errors:'' };
  const errors = [];
  const activeSources = opts.sourceId
    ? [sources.get(opts.sourceId)].filter(Boolean)
    : sources.list().filter(s => s.active);

  console.log(`[pipeline] Run ${runId} — ${activeSources.length} sources`);

  for (const source of activeSources) {
    stats.sources_attempted++;
    try {
      const fetched = await fetchSource(source);
      if (!fetched.content || fetched.content.trim().length < 50) continue;
      sources.update(source.id, { last_run: new Date().toISOString(), last_successful_method: fetched.method });
      stats.sources_succeeded++;
      const extracted = await extract(fetched.content, source.name, fetched.method, source.extraction_prompt);
      stats.signals_extracted += extracted.length;
      const excl = exclusions.list().map(s => s.toLowerCase());
      for (const sig of extracted) {
        if (excl.includes((sig.sector||'').toLowerCase())) { stats.signals_suppressed++; continue; }
        if (dedup.seen(sig.company_name, sig.signal_type)) { stats.signals_suppressed++; continue; }
        signals.insert({ ...sig, source_name: source.name, method: fetched.method, run_id: runId });
        if (sig.company_name) dedup.mark(sig.company_name, sig.signal_type);
        stats.signals_written++;
      }
      console.log(`[pipeline] ${source.name} — extracted: ${extracted.length}, written: ${stats.signals_written}`);
    } catch(err) {
      errors.push(`${source.name}: ${err.message}`);
      console.error('[pipeline] Error on', source.name, '—', err.message);
    }
  }

  dedup.prune();
  stats.errors = errors.join('; ');
  runLog.complete(runId, stats);
  console.log('[pipeline] Complete:', stats);
  return { runId, stats };
}

module.exports = { runPipeline };
