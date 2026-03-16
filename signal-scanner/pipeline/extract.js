require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getModel } = require('../../shared/models.cjs');

const PROMPT = fs.readFileSync(
  path.join(__dirname, '../../config/prompts/signal-extraction.md'), 'utf8'
).replace(/^#[^\n]*\n/gm, '').trim();

async function extract(content, sourceName, method, customPrompt) {
  if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY not set in .env');
  if (!content || content.trim().length < 50) return [];
  const r = await axios.post('https://api.anthropic.com/v1/messages',
    { model: getModel('classification'), max_tokens: 2000,
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
