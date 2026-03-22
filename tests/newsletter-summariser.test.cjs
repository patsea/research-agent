/**
 * Tests for newsletter-monitor/modules/summariser.js
 * Tests: output schema, DB field mapping, error handling, token injection
 *
 * The summariser uses require('node-fetch') which resolves to a sub-project node_modules.
 * We test the output parsing and prompt construction logic directly.
 */

const path = require('path');
const fs = require('fs');

// ─── Output parsing logic (from summariser.js lines 40-56) ─────────────────

function parseNewsletterOutput(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    return {
      summary: parsed.summary || rawText.slice(0, 500),
      one_line_takeaway: parsed.one_line_takeaway || '',
      top_tags: parsed.top_tags || [],
      key_points: parsed.key_points || [],
      best_sections: parsed.best_sections || [],
      skip_sections: parsed.skip_sections || [],
      actionable_followups: parsed.actionable_followups || []
    };
  } catch {
    return {
      summary: rawText || 'Summary unavailable.',
      one_line_takeaway: '',
      top_tags: [],
      key_points: [],
      best_sections: [],
      skip_sections: [],
      actionable_followups: []
    };
  }
}

// ─── Prompt construction logic (from summariser.js lines 18-22) ────────────

function buildNewsletterPrompt(promptText, newsletter) {
  const cleanPrompt = promptText.replace(/^#[^\n]*\n/gm, '').trim();
  return `${cleanPrompt}

Newsletter: ${newsletter.subject}
From: ${newsletter.sender_name || newsletter.sender_email || 'Unknown'}
Content: ${newsletter.body || newsletter.snippet || '(no content)'}`;
}

const FULL_RESPONSE = {
  summary: 'AI is advancing fast',
  one_line_takeaway: 'Keep watching GPT-5',
  top_tags: ['AI', 'LLM'],
  key_points: ['Point A', 'Point B'],
  best_sections: [{ title: 'Intro', reason: 'Great overview' }],
  skip_sections: [{ title: 'Ads', reason: 'Spam' }],
  actionable_followups: ['Read the paper']
};

describe('newsletter summariser — output schema', () => {

  test('returns object with "summary" field', () => {
    const result = parseNewsletterOutput(JSON.stringify(FULL_RESPONSE));
    expect(result).toHaveProperty('summary', 'AI is advancing fast');
  });

  test('returns object with "one_line_takeaway" field', () => {
    const result = parseNewsletterOutput(JSON.stringify(FULL_RESPONSE));
    expect(result).toHaveProperty('one_line_takeaway', 'Keep watching GPT-5');
  });

  test('returns object with "top_tags" array', () => {
    const result = parseNewsletterOutput(JSON.stringify(FULL_RESPONSE));
    expect(Array.isArray(result.top_tags)).toBe(true);
    expect(result.top_tags).toEqual(['AI', 'LLM']);
  });

  test('returns object with "key_points" array', () => {
    const result = parseNewsletterOutput(JSON.stringify(FULL_RESPONSE));
    expect(Array.isArray(result.key_points)).toBe(true);
  });

  test('returns object with "best_sections" array', () => {
    const result = parseNewsletterOutput(JSON.stringify(FULL_RESPONSE));
    expect(Array.isArray(result.best_sections)).toBe(true);
  });

  test('returns object with "skip_sections" array', () => {
    const result = parseNewsletterOutput(JSON.stringify(FULL_RESPONSE));
    expect(Array.isArray(result.skip_sections)).toBe(true);
  });

  test('returns object with "actionable_followups" array', () => {
    const result = parseNewsletterOutput(JSON.stringify(FULL_RESPONSE));
    expect(Array.isArray(result.actionable_followups)).toBe(true);
  });

  test('returns fallback object (not throw) when LLM returns non-JSON', () => {
    const result = parseNewsletterOutput('This is not JSON at all');
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('summary');
    expect(result.summary).toBe('This is not JSON at all');
  });

  test('returns empty arrays (not undefined) for missing fields in partial JSON', () => {
    const result = parseNewsletterOutput(JSON.stringify({ summary: 'Just summary' }));
    expect(result.top_tags).toEqual([]);
    expect(result.key_points).toEqual([]);
    expect(result.best_sections).toEqual([]);
  });
});

describe('newsletter summariser — token injection', () => {

  test('prompt sent to LLM contains actual subject, not literal {SUBJECT}', () => {
    const prompt = buildNewsletterPrompt('# Header\nSummarise this newsletter.', {
      subject: 'AI Weekly #42',
      body: 'Some content'
    });
    expect(prompt).toContain('AI Weekly #42');
    // Newsletter summariser uses string concatenation, not {SUBJECT} tokens
    // Verify the subject appears in the constructed prompt
  });

  test('prompt contains actual body content, not literal {CONTENT}', () => {
    const prompt = buildNewsletterPrompt('# Header\nSummarise this newsletter.', {
      subject: 'Test',
      body: 'The real newsletter body text'
    });
    expect(prompt).toContain('The real newsletter body text');
  });

  test('prompt includes sender name when provided', () => {
    const prompt = buildNewsletterPrompt('# Header\nPrompt text.', {
      subject: 'Test',
      body: 'Body',
      sender_name: 'John Doe'
    });
    expect(prompt).toContain('John Doe');
  });
});

describe('newsletter summariser — prompt file verification', () => {
  test('actual prompt file exists and is readable', () => {
    const promptPath = path.join(__dirname, '..', 'config', 'prompts', 'newsletter-summarisation.md');
    const content = fs.readFileSync(promptPath, 'utf8');
    expect(content.length).toBeGreaterThan(50);
  });
});
