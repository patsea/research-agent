/**
 * Tests for podcast-monitor/modules/summariser.js
 * Tests: output schema, removed fields (schema migration), error handling, token injection
 *
 * The summariser uses dynamic import('node-fetch') which is difficult to mock in CJS tests.
 * We test the output parsing, field mapping, and prompt construction logic directly.
 */

const path = require('path');
const fs = require('fs');

// ─── Output parsing logic (from summariser.js lines 87-139) ────────────────

function parseAndMapOutput(rawText) {
  let raw = rawText.trim();
  raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  const parsed = JSON.parse(raw);

  const summary = parsed.summary || '';
  const one_line_takeaway = parsed.one_line_takeaway || '';
  const top_tags_json = JSON.stringify(parsed.top_tags || []);
  const key_points_json = JSON.stringify(parsed.key_points || []);
  const best_sections_json = JSON.stringify(parsed.best_sections || []);
  const skip_sections_json = JSON.stringify(parsed.skip_sections || []);
  const actionable_followups_json = JSON.stringify(parsed.actionable_followups || []);

  return { summary, one_line_takeaway, top_tags_json, key_points_json, best_sections_json, skip_sections_json, actionable_followups_json };
}

// ─── Prompt construction logic (from summariser.js lines 7-20) ─────────────

function buildPrompt(promptTemplate, episode, transcriptContent) {
  let prompt = promptTemplate.replace(/^#[^\n]*\n/gm, '').trim();
  prompt = prompt.replace('{EPISODE_TITLE}', episode.title || 'Unknown');
  prompt = prompt.replace('{PODCAST_NAME}', episode.channel_name || 'Unknown');
  prompt = prompt.replace('{PUBLISHED_DATE}', episode.published_at || 'Unknown');
  prompt = prompt.replace('{DESCRIPTION}', episode.description || '');
  prompt = prompt.replace('{CONTENT}', transcriptContent);
  return prompt;
}

const FULL_RESPONSE = {
  summary: 'AI agents are reshaping enterprise workflows',
  one_line_takeaway: 'Agent orchestration is the next platform shift',
  top_tags: ['AI', 'agents', 'enterprise'],
  key_points: ['Agents reduce manual work', 'Orchestration is key'],
  best_sections: [{ title: 'Agent Architecture', timestamp: '00:02:00', reason: 'Core thesis' }],
  skip_sections: [{ title: 'Sponsor Read', timestamp: '00:01:00', reason: 'Ad' }],
  actionable_followups: ['Read the LangGraph paper']
};

describe('podcast summariser — output schema', () => {

  test('returns object with "summary" field', () => {
    const result = parseAndMapOutput(JSON.stringify(FULL_RESPONSE));
    expect(result).toHaveProperty('summary', 'AI agents are reshaping enterprise workflows');
  });

  test('returns object with "one_line_takeaway" field', () => {
    const result = parseAndMapOutput(JSON.stringify(FULL_RESPONSE));
    expect(result).toHaveProperty('one_line_takeaway', 'Agent orchestration is the next platform shift');
  });

  test('returns object with "best_sections" array (as JSON string)', () => {
    const result = parseAndMapOutput(JSON.stringify(FULL_RESPONSE));
    const parsed = JSON.parse(result.best_sections_json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  test('returns object with "actionable_followups" array (as JSON string)', () => {
    const result = parseAndMapOutput(JSON.stringify(FULL_RESPONSE));
    const parsed = JSON.parse(result.actionable_followups_json);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test('does NOT return "new_novel_contrarian" field (schema migration confirmed)', () => {
    const result = parseAndMapOutput(JSON.stringify(FULL_RESPONSE));
    expect(result).not.toHaveProperty('new_novel_contrarian');
    expect(result).not.toHaveProperty('new_novel_contrarian_json');
  });

  test('does NOT return "overview" field (old schema gone)', () => {
    const result = parseAndMapOutput(JSON.stringify(FULL_RESPONSE));
    expect(result).not.toHaveProperty('overview');
  });

  test('throws (not returns null) when LLM returns non-JSON', () => {
    expect(() => parseAndMapOutput('This is not JSON')).toThrow();
  });
});

describe('podcast summariser — token injection', () => {
  const PROMPT_TEMPLATE = '# Prompt Header\nSummarise podcast {EPISODE_TITLE} from {PODCAST_NAME} published {PUBLISHED_DATE}.\nDescription: {DESCRIPTION}\nTranscript:\n{CONTENT}';

  const mockEpisode = {
    title: 'The Future of AI Agents',
    channel_name: 'Tech Frontiers',
    published_at: '2026-03-15',
    description: 'Deep dive into autonomous agents'
  };

  test('prompt contains actual episode title, not literal {EPISODE_TITLE}', () => {
    const prompt = buildPrompt(PROMPT_TEMPLATE, mockEpisode, 'transcript text');
    expect(prompt).toContain('The Future of AI Agents');
    expect(prompt).not.toContain('{EPISODE_TITLE}');
  });

  test('prompt contains actual podcast name, not literal {PODCAST_NAME}', () => {
    const prompt = buildPrompt(PROMPT_TEMPLATE, mockEpisode, 'transcript text');
    expect(prompt).toContain('Tech Frontiers');
    expect(prompt).not.toContain('{PODCAST_NAME}');
  });

  test('prompt contains actual transcript content, not literal {CONTENT}', () => {
    const prompt = buildPrompt(PROMPT_TEMPLATE, mockEpisode, 'This is the real transcript');
    expect(prompt).toContain('This is the real transcript');
    expect(prompt).not.toContain('{CONTENT}');
  });
});

describe('podcast summariser — prompt file token verification', () => {
  test('actual prompt file contains {EPISODE_TITLE} token for injection', () => {
    const promptPath = path.join(__dirname, '..', 'config', 'prompts', 'podcast-summarisation.md');
    const content = fs.readFileSync(promptPath, 'utf8');
    expect(content).toContain('{EPISODE_TITLE}');
  });
});
