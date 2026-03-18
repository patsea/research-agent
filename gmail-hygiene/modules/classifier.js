import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getModel } = require('../../shared/models.cjs');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function _getClassifierPrompt() {
  return readFileSync(
    new URL('../../config/prompts/gmail-sender-classification.md', import.meta.url), 'utf8'
  ).replace(/^#[^\n]*\n/gm, '').trim();
}

const TAXONOMY = [
  'Job Search/Outreach', 'Job Search/Alerts',
  'Newsletters/Tech & AI', 'Newsletters/News & Geopolitics',
  'Newsletters/Opinion', 'Newsletters/Spanish News',
  'INSEAD Alumni', 'Bills & Invoices',
  'Banking/Transactions', 'Banking/Promotions',
  'Health & Wellness', 'Travel & Transport',
  'Security & Accounts', 'Family & Personal',
  'Professional Tools', 'Meetups & Events',
  'Review & Unsubscribe'
];

export async function classifySender({ emailAddress, displayName, subjects }) {
  const GMAIL_CLASSIFIER_PROMPT = _getClassifierPrompt();
  const response = await client.messages.create({
    model: getModel('classification'),
    max_tokens: 50,
    messages: [{
      role: 'user',
      content: GMAIL_CLASSIFIER_PROMPT
        .replace('{EMAIL_ADDRESS}', emailAddress)
        .replace('{DISPLAY_NAME}', displayName || 'unknown')
        .replace('{SUBJECTS}', subjects.slice(0, 3).join(', ') || 'none')
    }]
  });

  const raw = response.content[0]?.text?.trim() || '';
  let category = 'Review & Unsubscribe';
  try {
    const parsed = JSON.parse(raw);
    const typeMap = {
      'recruiter': 'Job Search/Outreach',
      'operator': 'Job Search/Outreach',
      'founder': 'Job Search/Outreach',
      'investor': 'Job Search/Outreach',
      'network': 'Family & Personal',
      'generic_inbox': 'Review & Unsubscribe',
      'automated': 'Review & Unsubscribe',
      'unknown': 'Review & Unsubscribe'
    };
    category = typeMap[parsed.type] || 'Review & Unsubscribe';
  } catch {
    // LLM returned plain text — try direct TAXONOMY match as fallback
    category = TAXONOMY.find(c => c.toLowerCase() === raw.toLowerCase())
      || 'Review & Unsubscribe';
  }
  return category;
}
