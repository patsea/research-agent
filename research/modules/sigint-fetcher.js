import fetch from 'node-fetch';
import { getSigintDb } from './sigint-db.js';

export async function fetchAllSources() {
  const db = getSigintDb();
  const sources = db.prepare('SELECT * FROM sources WHERE active = 1').all();
  const results = { fetched: 0, new: 0, errors: [] };
  const now = new Date().toISOString();

  for (const source of sources) {
    try {
      const res = await fetch(source.url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)' }
      });
      if (!res.ok) { results.errors.push(`${source.name}: HTTP ${res.status}`); continue; }
      const xml = await res.text();
      const items = parseRssItems(xml);
      for (const item of items) {
        try {
          db.prepare(`INSERT OR IGNORE INTO content_items
            (source_id, title, summary, url, published_at) VALUES (?, ?, ?, ?, ?)`)
            .run(source.id, item.title, item.summary, item.url, item.publishedAt);
          const changed = db.prepare('SELECT changes() as c').get().c;
          if (changed > 0) results.new++;
          results.fetched++;
        } catch {}
      }
      db.prepare('UPDATE sources SET last_fetched = ? WHERE id = ?').run(now, source.id);
    } catch (err) {
      results.errors.push(`${source.name}: ${err.message}`);
    }
  }
  return results;
}

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s) || [])[1]?.trim();
    const url = (block.match(/<link[^>]*>(.*?)<\/link>/s) || [])[1]?.trim()
             || (block.match(/<guid[^>]*>(.*?)<\/guid>/s) || [])[1]?.trim();
    const summary = (block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/s) || [])[1]
      ?.replace(/<[^>]+>/g, '').trim().slice(0, 500);
    const pubDate = (block.match(/<pubDate[^>]*>(.*?)<\/pubDate>/s) || [])[1]?.trim();
    if (title && url) items.push({ title, url, summary: summary || '', publishedAt: pubDate || null });
  }
  return items;
}
