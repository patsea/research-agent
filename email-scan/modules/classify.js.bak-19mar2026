import axios from 'axios';
import 'dotenv/config';

const SYSTEM_PROMPT = `You are an email reply classifier for an executive job search outreach campaign.
Classify the reply and return ONLY valid JSON with these fields:
- type: one of "interested" | "request_info" | "not_right_timing" | "soft_no" | "hard_no" | "ooo" | "other"
- summary: 2-3 sentence summary of what was said
- next_step: suggested next action for the sender
- ooo_return_date: ISO date string (YYYY-MM-DD) if out-of-office with a return date, otherwise null

Classification rules:
- "interested": wants to talk, suggests a call, asks to connect
- "request_info": asks for more detail but not committing
- "not_right_timing": positive but not now, suggests future contact
- "soft_no": polite decline, not interested right now
- "hard_no": firm decline, do not contact again
- "ooo": out of office / auto-reply — extract return date if present
- "other": anything that doesn't fit above

Return ONLY the JSON object. No markdown. No explanation.`;

export async function classifyReply(subject, body) {
  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
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
