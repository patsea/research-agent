const Parser = require('rss-parser');
const parser = new Parser({ timeout: 15000 });

async function detect(url) {
  const axios = require('axios');
  for (const path of ['','/feed','/rss','/atom.xml','/?feed=rss2','/rss.xml']) {
    try {
      const r = await axios.get(url.replace(/\/$/, '') + path, { timeout: 5000, responseType: 'text' });
      if (/<rss|<feed|<channel/.test(r.data)) return { confidence: 0.95, resolved_url: url.replace(/\/$/, '') + path };
    } catch(_) {}
  }
  return { confidence: 0, resolved_url: url };
}

async function fetch(url, lastRun) {
  const cutoff = lastRun ? new Date(lastRun) : new Date(Date.now() - 864e5);
  const feed = await parser.parseURL(url);
  const items = (feed.items || []).filter(i => {
    const pub = i.pubDate || i.isoDate;
    return !pub || new Date(pub) > cutoff;
  });
  const content = items.map(i =>
    `TITLE: ${i.title||''}\nDATE: ${i.pubDate||''}\nURL: ${i.link||''}\nSUMMARY: ${(i.contentSnippet||i.summary||'').slice(0,500)}\n---`
  ).join('\n\n');
  return { content, item_count: items.length };
}

module.exports = { detect, fetch };
