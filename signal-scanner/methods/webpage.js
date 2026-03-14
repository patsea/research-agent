const axios = require('axios');

function detect(url) {
  if (/portfolio|investments|fund|venture|private.equity/i.test(url))
    return { confidence: 0.6, type: 'investor_press_release' };
  return { confidence: 0.5, type: 'webpage_scan' };
}

async function fetch(url) {
  // Attempt 1: Jina Reader
  try {
    const r = await axios.get(`https://r.jina.ai/${encodeURIComponent(url)}`, { timeout: 20000, headers: { Accept: 'text/plain' } });
    const t = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    if (t.length > 500) return { content: t.slice(0, 10000), method_used: 'jina' };
  } catch(e) { console.log(`[webpage] Jina failed: ${e.message}`); }

  // Attempt 2: Firecrawl
  const key = process.env.FIRECRAWL_API_KEY;
  if (key && key !== 'pending') {
    try {
      const r = await axios.post('https://api.firecrawl.dev/v1/scrape',
        { url, formats: ['markdown'], onlyMainContent: true },
        { headers: { Authorization: `Bearer ${key}` }, timeout: 30000 });
      const c = r.data?.data?.markdown || '';
      if (c.length > 500) return { content: c.slice(0, 10000), method_used: 'firecrawl' };
    } catch(e) { console.log(`[webpage] Firecrawl failed: ${e.message}`); }
  }

  // Attempt 3: Raw HTTP
  try {
    const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' }, responseType: 'text' });
    const stripped = String(r.data).replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    if (stripped.length > 500) return { content: stripped.slice(0, 10000), method_used: 'raw_http' };
  } catch(e) { console.log(`[webpage] Raw HTTP failed: ${e.message}`); }

  throw new Error(`All fetch methods failed for ${url}`);
}

module.exports = { detect, fetch };
