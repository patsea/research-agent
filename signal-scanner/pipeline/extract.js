require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

const PROMPT = `You are a signal extraction agent for a CPO/COO executive job search.
Extract business signals from the content that indicate a company may need senior product or operations leadership.
Focus on: funding rounds, PE/VC acquisitions, leadership changes, layoffs/reorg, product pivots, rapid growth.
Target: PE/VC-backed tech companies in Europe needing CPO or COO, especially AI transformation.
Return a JSON array. Each object must have EXACTLY these fields:
headline, company_name, signal_type (funding_round|pe_acquisition|leadership_change|layoffs_reorg|product_pivot|other),
sector (B2B SaaS|Enterprise Software|Marketplace|Fintech|HR Tech|Logistics|E-commerce|Media|Travel & Hospitality|Healthcare|Education|Retail|Real Estate|Other),
sector_raw, ai_summary (3-5 sentences: 1 what is happening 2 what this implies about the company state 3 how this maps to a CPO/COO specialising in AI transformation at PE/VC-backed European tech),
signal_date (YYYY-MM-DD or empty), source_url, excerpt (first 300 chars of relevant text), geography, confidence (High|Medium|Low).
Return ONLY valid JSON array. No markdown. No explanation. If no signals found return [].`;

async function extract(content, sourceName, method, customPrompt) {
  if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY not set in .env');
  if (!content || content.trim().length < 50) return [];
  const r = await axios.post('https://api.anthropic.com/v1/messages',
    { model: 'claude-haiku-4-5-20251001', max_tokens: 2000,
      messages: [{ role: 'user', content: `${customPrompt || PROMPT}\n\nSource: ${sourceName}\nMethod: ${method}\n\n---\n\n${content.slice(0, 8000)}` }] },
    { headers: { 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' }, timeout: 30000 });
  try {
    const raw = r.data.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(s => s.headline && s.ai_summary) : [];
  } catch(e) { console.error('[extract] parse failed:', e.message); return []; }
}

module.exports = { extract };
