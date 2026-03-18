import axios from 'axios';
import { readFileSync } from 'fs';
import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getModel } = require('../../shared/models.cjs');

export async function classifyReply(subject, body) {
  const SYSTEM_PROMPT = readFileSync(
    new URL('../../config/prompts/email-reply-classification.md', import.meta.url), 'utf8'
  ).replace(/^#[^\n]*\n/gm, '').trim();

  // Strip unsubstituted placeholder tokens — these have no runtime data source
  // Patrick will remove them from the prompt file via Dashboard; this is a safety net
  const cleanPrompt = SYSTEM_PROMPT
    .replace(/\{\{EMAIL_ADDRESS\}\}/g, '')
    .replace(/\{\{DISPLAY_NAME\}\}/g, '')
    .replace(/\{\{SUBJECT\}\}/g, '')
    .replace(/\{\{RECENT_SUBJECTS\}\}/g, '')
    .replace(/\{\{BODY\}\}/g, '');

  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages',
      {
        model: getModel('classification'),
        max_tokens: 400,
        system: cleanPrompt,
        messages: [{ role: 'user', content: `Subject: ${subject}\n\nBody:\n${(body || '').slice(0, 2000)}` }]
      },
      {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
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
