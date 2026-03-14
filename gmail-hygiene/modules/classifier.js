import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 50,
    messages: [{
      role: 'user',
      content: `Classify this email sender into exactly one category.

Sender: ${emailAddress}
Display name: ${displayName || 'unknown'}
Recent subjects: ${subjects.slice(0, 3).join(', ') || 'none'}

Categories:
${TAXONOMY.map(c => `- ${c}`).join('\n')}

Respond with ONLY the category name, nothing else.`
    }]
  });

  const raw = response.content[0]?.text?.trim() || 'Review & Unsubscribe';
  return TAXONOMY.find(c => c.toLowerCase() === raw.toLowerCase()) || 'Review & Unsubscribe';
}
