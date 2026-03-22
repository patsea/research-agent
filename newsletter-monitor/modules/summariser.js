'use strict';
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { getModel } = require('../../shared/models.cjs');

function _getNewsletterPrompt() {
  return fs.readFileSync(
    path.join(__dirname, '../../config/prompts/newsletter-summarisation.md'), 'utf8'
  ).replace(/^#[^\n]*\n/gm, '').trim();
}

async function summariseNewsletter(newsletter) {
  const NEWSLETTER_PROMPT = _getNewsletterPrompt();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No ANTHROPIC_API_KEY set');

  const prompt = NEWSLETTER_PROMPT
    .replace('{SUBJECT}', newsletter.subject || '')
    .replace('{SENDER_NAME}', newsletter.sender_name || '')
    .replace('{PUBLISHED_DATE}', newsletter.received_at || '')
    .replace('{SOURCE_NAME}', newsletter.sender_email || '')
    .replace('{CONTENT}', newsletter.body || newsletter.snippet || '');

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: getModel('classification'),
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch (err) {
    console.error('[newsletter-summariser] LLM call failed:', err.message);
    throw err;
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text?.trim() || '';
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      summary: parsed.summary || raw.slice(0, 500),
      one_line_takeaway: parsed.one_line_takeaway || '',
      is_newsletter: parsed.is_newsletter !== false,
      top_tags: parsed.top_tags || [],
      key_points: parsed.key_points || [],
      best_sections: parsed.best_sections || [],
      skip_sections: Array.isArray(parsed.skip_sections) ? parsed.skip_sections : [],
      actionable_followups: parsed.actionable_followups || []
    };
  } catch {
    // Old plain-text prompt or malformed JSON — return as summary only
    return { summary: raw || 'Summary unavailable.', one_line_takeaway: '', top_tags: [],
             key_points: [], best_sections: [], skip_sections: [],
             actionable_followups: [] };
  }
}

module.exports = { summariseNewsletter };
