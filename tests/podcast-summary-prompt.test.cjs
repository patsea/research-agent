/**
 * Podcast Monitor — summary prompt includes new/novel/contrarian
 * Checks the prompt file/string contains the required section
 */
const fs = require('fs');
const path = require('path');

const BASE = '/Users/pwilliamson/Dropbox/ALOMA/claude-code/job-search-agent/podcast-monitor';

describe('Podcast summary prompt — new/novel/contrarian', () => {
  test('Summary prompt contains new/novel/contrarian instruction', () => {
    const candidates = [
      path.join(BASE, 'modules/summariser.js'),
      path.join(BASE, 'prompts/summary.md'),
      path.join(BASE, 'prompts/podcast-summary.md'),
      path.join(BASE, 'server.js'),
    ];
    let found = false;
    let foundIn = '';
    for (const f of candidates) {
      if (!fs.existsSync(f)) continue;
      const content = fs.readFileSync(f, 'utf8').toLowerCase();
      if (content.includes('novel') || content.includes('contrarian') || content.includes('new and novel')) {
        found = true;
        foundIn = f;
        break;
      }
    }
    expect(found).toBe(true);
    if (found) console.log('✅ Found in:', foundIn);
  });

  test('Summary prompt contains mandatory section marker', () => {
    const candidates = [
      path.join(BASE, 'modules/summariser.js'),
      path.join(BASE, 'server.js'),
    ];
    let found = false;
    for (const f of candidates) {
      if (!fs.existsSync(f)) continue;
      const content = fs.readFileSync(f, 'utf8').toLowerCase();
      if (content.includes('must include') || content.includes('mandatory') || content.includes('always include')) {
        found = true; break;
      }
    }
    expect(found).toBe(true);
  });
});
