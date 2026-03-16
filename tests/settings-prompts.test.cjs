/**
 * Settings — Prompt Editor tests
 * Phase 1: 5 file-based prompts accessible via GET /api/config/prompts/:name
 * Phase 2: 11 extracted prompts exist in config/prompts/ and accessible via API
 * POST saves changes
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3030';
const PROMPTS_DIR = path.join(__dirname, '..', 'config', 'prompts');

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${urlPath}`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`${BASE}${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let out = '';
      res.on('data', chunk => out += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(out) }); }
        catch { resolve({ status: res.statusCode, body: out }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Phase 1 prompts (copied from research/prompts/)
const PHASE1 = [
  'research-interview-prep-system',
  'research-interview-prep-template',
  'research-company-assessment',
  'research-company-audit',
  'research-sigint-briefing'
];

// Phase 2 prompts (extracted from source files)
const PHASE2 = [
  'signal-extraction',
  'signal-research-generator',
  'signal-audit',
  'research-general-audit',
  'contact-identification',
  'outreach-email-drafting',
  'email-reply-classification',
  'gmail-sender-classification',
  'podcast-summarisation',
  'newsletter-summarisation',
  'dashboard-rubric-suggest'
];

const ALL_PROMPTS = [...PHASE1, ...PHASE2];

describe('Prompt files exist on disk', () => {
  test.each(ALL_PROMPTS)('%s exists in config/prompts/', name => {
    const filePath = path.join(PROMPTS_DIR, `${name}.md`);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe('GET /api/config/prompts — list all', () => {
  test('returns array of 16 prompts', async () => {
    const { status, body } = await get('/api/config/prompts');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(16);
  });

  test('every prompt has name, label, agent, group, exists fields', async () => {
    const { body } = await get('/api/config/prompts');
    for (const p of body) {
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('label');
      expect(p).toHaveProperty('agent');
      expect(p).toHaveProperty('group');
      expect(p).toHaveProperty('exists');
    }
  });
});

describe('GET /api/config/prompts/:name — read single', () => {
  test.each(PHASE1)('Phase 1: %s returns content', async name => {
    const { status, body } = await get(`/api/config/prompts/${name}`);
    expect(status).toBe(200);
    expect(body.name).toBe(name);
    expect(typeof body.content).toBe('string');
    expect(body.content.length).toBeGreaterThan(10);
  });

  test.each(PHASE2)('Phase 2: %s returns content', async name => {
    const { status, body } = await get(`/api/config/prompts/${name}`);
    expect(status).toBe(200);
    expect(body.name).toBe(name);
    expect(typeof body.content).toBe('string');
    expect(body.content.length).toBeGreaterThan(10);
  });

  test('unknown prompt returns 404', async () => {
    const { status } = await get('/api/config/prompts/nonexistent-prompt');
    expect(status).toBe(404);
  });
});

describe('POST /api/config/prompts/:name — save', () => {
  test('saves content and reads it back', async () => {
    const testContent = '# Test Prompt\nThis is a test prompt content for verification.';
    const name = 'podcast-summarisation';

    // Read original
    const { body: original } = await get(`/api/config/prompts/${name}`);
    const originalContent = original.content;

    // Save test content
    const { status } = await post(`/api/config/prompts/${name}`, { content: testContent });
    expect(status).toBe(200);

    // Read back
    const { body: updated } = await get(`/api/config/prompts/${name}`);
    expect(updated.content).toBe(testContent);

    // Restore original
    await post(`/api/config/prompts/${name}`, { content: originalContent });
  });
});
