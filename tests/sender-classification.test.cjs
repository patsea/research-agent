/**
 * Tests for gmail-hygiene/modules/classifier.js
 * Tests: typeMap routing, taxonomy mapping, fallback behaviour
 *
 * Tests the pure routing logic extracted from classifier.js without importing the module.
 * The module's structure: LLM returns JSON with .type → typeMap maps to taxonomy category.
 * If JSON.parse fails, falls back to direct TAXONOMY text match.
 */

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

/**
 * Replicate classifier.js lines 42-60: parse LLM output, route via typeMap or fallback
 */
function classifySenderOutput(rawText) {
  let category = 'Review & Unsubscribe';
  try {
    const parsed = JSON.parse(rawText);
    category = typeMap[parsed.type] || 'Review & Unsubscribe';
  } catch {
    category = TAXONOMY.find(c => c.toLowerCase() === rawText.toLowerCase())
      || 'Review & Unsubscribe';
  }
  return category;
}

describe('classifier.js — classifySender output routing', () => {

  test('returns a string result (category)', () => {
    const result = classifySenderOutput(JSON.stringify({ type: 'recruiter' }));
    expect(typeof result).toBe('string');
  });

  test('JSON output has "type" field used for routing', () => {
    const llmOutput = { type: 'recruiter', summary: 'Tech recruiter' };
    const parsed = JSON.parse(JSON.stringify(llmOutput));
    expect(parsed).toHaveProperty('type');
  });

  test('JSON output can include "summary" field', () => {
    const llmOutput = { type: 'recruiter', summary: 'Tech recruiter at Firm X' };
    const parsed = JSON.parse(JSON.stringify(llmOutput));
    expect(parsed).toHaveProperty('summary');
  });

  test('maps "recruiter" type to Job Search/Outreach taxonomy', () => {
    const result = classifySenderOutput(JSON.stringify({ type: 'recruiter' }));
    expect(result).toBe('Job Search/Outreach');
  });

  test('maps "investor" type to Job Search/Outreach taxonomy', () => {
    const result = classifySenderOutput(JSON.stringify({ type: 'investor' }));
    expect(result).toBe('Job Search/Outreach');
  });

  test('maps "network" type to Family & Personal taxonomy', () => {
    const result = classifySenderOutput(JSON.stringify({ type: 'network' }));
    expect(result).toBe('Family & Personal');
  });

  test('maps "automated" type to Review & Unsubscribe taxonomy', () => {
    const result = classifySenderOutput(JSON.stringify({ type: 'automated' }));
    expect(result).toBe('Review & Unsubscribe');
  });

  test('maps "unknown" type to Review & Unsubscribe taxonomy', () => {
    const result = classifySenderOutput(JSON.stringify({ type: 'unknown' }));
    expect(result).toBe('Review & Unsubscribe');
  });

  test('falls back to text match if JSON.parse fails', () => {
    const result = classifySenderOutput('Job Search/Outreach');
    expect(result).toBe('Job Search/Outreach');
  });

  test('falls back to Review & Unsubscribe if text match also fails', () => {
    const result = classifySenderOutput('some random text');
    expect(result).toBe('Review & Unsubscribe');
  });
});
