const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');

describe('Prompt consolidation', () => {
  test('Research JS files read from config/prompts not research/prompts', () => {
    const researchDir = path.join(PROJECT_ROOT, 'research');
    const jsFiles = [];

    // Recursively find all .js files in research/
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.endsWith('.bak')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) jsFiles.push(full);
      }
    }
    walk(researchDir);

    const violations = [];
    for (const file of jsFiles) {
      const content = fs.readFileSync(file, 'utf8');
      // Find readFileSync or readFile calls that reference prompts/ but NOT config/prompts/
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments
        if (line.trim().startsWith('//')) continue;
        // Check for prompt path references that don't use config/prompts
        if ((line.includes('readFileSync') || line.includes('readFile') || line.includes('PROMPT_PATH') || line.includes('templatePath')) &&
            line.includes('prompts/') && !line.includes('config/prompts')) {
          violations.push(`${path.relative(PROJECT_ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('Podcast summariser uses getModel() not hardcoded model strings', () => {
    const summariserPath = path.join(PROJECT_ROOT, 'podcast-monitor', 'modules', 'summariser.js');
    const content = fs.readFileSync(summariserPath, 'utf8');

    expect(content).not.toContain('claude-sonnet-4-5');
    // Model is now centralized via shared/models.cjs — verify getModel usage, not hardcoded string
    expect(content).toContain('getModel');
  });

  test('config/prompts has all 16+ expected prompt files', () => {
    const promptDir = path.join(PROJECT_ROOT, 'config', 'prompts');
    const files = fs.readdirSync(promptDir).filter(f => f.endsWith('.md'));

    const expectedPrompts = [
      'contact-identification.md',
      'dashboard-rubric-suggest.md',
      'email-reply-classification.md',
      'gmail-sender-classification.md',
      'newsletter-summarisation.md',
      'outreach-email-drafting.md',
      'podcast-summarisation.md',
      'research-company-assessment.md',
      'research-company-audit.md',
      'research-general-audit.md',
      'research-interview-prep-system.md',
      'research-interview-prep-template.md',
      'research-sigint-briefing.md',
      'signal-audit.md',
      'signal-extraction.md',
      'signal-research-generator.md',
    ];

    for (const expected of expectedPrompts) {
      expect(files).toContain(expected);
    }
    expect(files.length).toBeGreaterThanOrEqual(16);
  });
});
