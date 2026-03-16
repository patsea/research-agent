import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getModel } = require('../../shared/models.cjs');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const GMAIL_CLASSIFIER_PROMPT = readFileSync(
  new URL('../../config/prompts/gmail-sender-classification.md', import.meta.url), 'utf8'
).replace(/^#[^\n]*\n/gm, '').trim();

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

  const raw = response.content[0]?.text?.trim() || 'Review & Unsubscribe';
  return TAXONOMY.find(c => c.toLowerCase() === raw.toLowerCase()) || 'Review & Unsubscribe';
}
