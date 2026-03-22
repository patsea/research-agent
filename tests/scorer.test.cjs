/**
 * Scorer — rubric loading, dimension filtering, and prompt injection tests
 * No running agents required. Tests rubric config and scorer logic directly.
 */
const fs = require('fs');
const path = require('path');

const RUBRIC_PATH = path.join(__dirname, '../config/scoring-rubric.json');
const PROMPT_PATH = path.join(__dirname, '../config/prompts/scorer-rubric.md');

// Mirror getActiveRubric from scorer/server.js (not exported, so replicate logic)
function getActiveRubric(scoringType) {
  const rubric = JSON.parse(fs.readFileSync(RUBRIC_PATH, 'utf8'));
  if (scoringType === 'company') return rubric.companyRubric;
  if (scoringType === 'firm') return rubric.firmRubric;
  throw new Error(`Unknown scoringType: ${scoringType}`);
}

describe('Scorer — Rubric Loading', () => {
  test('getActiveRubric("company") reads from scoring-rubric.json (not DB)', () => {
    const rubric = getActiveRubric('company');
    expect(rubric).toBeDefined();
    expect(rubric.name).toBeDefined();
    expect(rubric.dimensions).toBeDefined();
    // Verify it came from the JSON file, not a database
    const raw = JSON.parse(fs.readFileSync(RUBRIC_PATH, 'utf8'));
    expect(rubric).toEqual(raw.companyRubric);
  });

  test('getActiveRubric("firm") reads from scoring-rubric.json (not DB)', () => {
    const rubric = getActiveRubric('firm');
    expect(rubric).toBeDefined();
    expect(rubric.name).toBeDefined();
    expect(rubric.dimensions).toBeDefined();
    const raw = JSON.parse(fs.readFileSync(RUBRIC_PATH, 'utf8'));
    expect(rubric).toEqual(raw.firmRubric);
  });

  test('getActiveRubric("company").dimensions contains M, T, O, S, H', () => {
    const rubric = getActiveRubric('company');
    const ids = rubric.dimensions.map(d => d.id);
    expect(ids).toContain('M');
    expect(ids).toContain('T');
    expect(ids).toContain('O');
    expect(ids).toContain('S');
    expect(ids).toContain('H');
  });

  test('getActiveRubric("firm").dimensions contains F, O, A, N', () => {
    const rubric = getActiveRubric('firm');
    const ids = rubric.dimensions.map(d => d.id);
    expect(ids).toContain('F');
    expect(ids).toContain('O');
    expect(ids).toContain('A');
    expect(ids).toContain('N');
  });
});

describe('Scorer — Auto vs Manual Dimensions', () => {
  test('autoDimensions for company excludes H (manual: true)', () => {
    const rubric = getActiveRubric('company');
    const autoDims = rubric.dimensions.filter(d => !d.manual);
    const autoIds = autoDims.map(d => d.id);
    expect(autoIds).not.toContain('H');
  });

  test('autoDimensions for firm excludes N (manual: true)', () => {
    const rubric = getActiveRubric('firm');
    const autoDims = rubric.dimensions.filter(d => !d.manual);
    const autoIds = autoDims.map(d => d.id);
    expect(autoIds).not.toContain('N');
  });

  test('autoDimensions for company includes M, T, O, S (manual: false)', () => {
    const rubric = getActiveRubric('company');
    const autoDims = rubric.dimensions.filter(d => !d.manual);
    const autoIds = autoDims.map(d => d.id);
    expect(autoIds).toContain('M');
    expect(autoIds).toContain('T');
    expect(autoIds).toContain('O');
    expect(autoIds).toContain('S');
  });

  test('autoDimensions for firm includes F, O, A (manual: false)', () => {
    const rubric = getActiveRubric('firm');
    const autoDims = rubric.dimensions.filter(d => !d.manual);
    const autoIds = autoDims.map(d => d.id);
    expect(autoIds).toContain('F');
    expect(autoIds).toContain('O');
    expect(autoIds).toContain('A');
  });
});

describe('Scorer — Prompt Injection', () => {
  test('scorer prompt injects {{DIMENSIONS}} and {{JSON_SCHEMA}} using autoDimensions only', () => {
    const rubric = getActiveRubric('company');
    const autoDimensions = rubric.dimensions.filter(d => !d.manual);
    const template = fs.readFileSync(PROMPT_PATH, 'utf8');

    // Replicate scorer.js prompt building logic
    const dimPrompts = autoDimensions.map(d => `${d.id}: ${d.prompt}`).join('\n');
    const jsonSchema = autoDimensions.map(d =>
      `  "${d.id}": { "signal": "High|Medium|Low", "evidence": "one sentence", "confidence": "High|Medium|Low" }`
    ).join(',\n');

    const prompt = template
      .replace('{{NAME}}', 'TestCo')
      .replace('{{DIMENSIONS}}', dimPrompts)
      .replace('{{RESEARCH_CONTEXT}}', 'test context')
      .replace('{{JSON_SCHEMA}}', jsonSchema);

    // autoDimensions should be present
    for (const d of autoDimensions) {
      expect(prompt).toContain(`"${d.id}"`);
      expect(prompt).toContain(d.prompt);
    }

    // Template placeholders should be fully replaced
    expect(prompt).not.toContain('{{DIMENSIONS}}');
    expect(prompt).not.toContain('{{JSON_SCHEMA}}');
    expect(prompt).not.toContain('{{NAME}}');
    expect(prompt).not.toContain('{{RESEARCH_CONTEXT}}');
  });

  test('manual dimensions not present in the LLM prompt payload', () => {
    const rubric = getActiveRubric('company');
    const autoDimensions = rubric.dimensions.filter(d => !d.manual);
    const manualDimensions = rubric.dimensions.filter(d => d.manual);
    const template = fs.readFileSync(PROMPT_PATH, 'utf8');

    const dimPrompts = autoDimensions.map(d => `${d.id}: ${d.prompt}`).join('\n');
    const jsonSchema = autoDimensions.map(d =>
      `  "${d.id}": { "signal": "High|Medium|Low", "evidence": "one sentence", "confidence": "High|Medium|Low" }`
    ).join(',\n');

    const prompt = template
      .replace('{{NAME}}', 'TestCo')
      .replace('{{DIMENSIONS}}', dimPrompts)
      .replace('{{RESEARCH_CONTEXT}}', 'test context')
      .replace('{{JSON_SCHEMA}}', jsonSchema);

    // Manual dimension H should NOT appear in the JSON schema section
    for (const d of manualDimensions) {
      // The manual dimension ID should not appear as a JSON key in the schema
      expect(prompt).not.toContain(`"${d.id}": { "signal"`);
      // The manual dimension prompt text should not appear in the dimensions section
      expect(prompt).not.toContain(`${d.id}: ${d.prompt}`);
    }
  });
});
