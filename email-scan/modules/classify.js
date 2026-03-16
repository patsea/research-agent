import axios from 'axios';
import { readFileSync } from 'fs';
import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getModel } = require('../../shared/models.cjs');

const SYSTEM_PROMPT = readFileSync(
  new URL('../../config/prompts/email-reply-classification.md', import.meta.url), 'utf8'
).replace(/^#[^\n]*\n/gm, '').trim();

export async function classifyReply(subject, body) {
  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages',
      {
        model: getModel('classification'),
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Subject: ${subject}\n\nBody:\n${(body || '').slice(0, 2000)}` }]
      },
      {
        headers: { 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
        timeout: 15000
      }
    );
    const raw = r.data.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(raw);
  } catch (e) {
    console.error('[classify] error:', e.message);
    return { type: 'other', summary: (body || '').slice(0, 200), next_step: 'Review manually', ooo_return_date: null };
  }
}
