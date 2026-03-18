const http = require('http');

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: 'localhost', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.setTimeout(8000, () => { req.destroy(); reject(new Error(`Timeout port ${port} ${path}`)); });
    req.on('error', reject);
  });
}

describe('Scorer (port 3038)', () => {
  test('GET /api/scores returns array', async () => {
    const res = await get(3038, '/api/scores');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Contact Research (port 3036)', () => {
  test('GET /api/research-library returns array', async () => {
    const res = await get(3036, '/api/research-library');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Outreach Drafter (port 3037)', () => {
  test('GET /api/drafts returns array', async () => {
    const res = await get(3037, '/api/drafts');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/positioning returns content', async () => {
    const res = await get(3037, '/api/positioning');
    expect(res.status).toBe(200);
  });

  test('positioningLoaded health field present', async () => {
    const res = await get(3037, '/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('positioningLoaded');
  });
});

describe('Email Scan (port 3034)', () => {
  test('GET /api/stats returns latestRun field', async () => {
    const res = await get(3034, '/api/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('latestRun');
  });

  test('GET /api/results returns array', async () => {
    const res = await get(3034, '/api/results');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Gmail Hygiene (port 3039)', () => {
  test('GET /api/senders returns array', async () => {
    const res = await get(3039, '/api/senders');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/digest returns status counts', async () => {
    const res = await get(3039, '/api/digest');
    expect(res.status).toBe(200);
  });
});

describe('Podcast Monitor (port 3040)', () => {
  test('GET /api/episodes returns array', async () => {
    const res = await get(3040, '/api/episodes');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/feeds returns array', async () => {
    const res = await get(3040, '/api/feeds');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Newsletter Monitor (port 3041)', () => {
  test('GET /api/newsletters returns array', async () => {
    const res = await get(3041, '/api/newsletters');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/history returns array', async () => {
    const res = await get(3041, '/api/history');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Scorer prompt file', () => {
  test('Scorer reads prompt from config/prompts/scorer-rubric.md', async () => {
    const fs = require('fs');
    const path = require('path');
    const promptPath = path.join(__dirname, '../config/prompts/scorer-rubric.md');
    expect(fs.existsSync(promptPath)).toBe(true);
    const content = fs.readFileSync(promptPath, 'utf8');
    expect(content.length).toBeGreaterThan(100);
  });
});

test('researcher.js reads interview prep system prompt from config/prompts/', () => {
  const fs = require('fs');
  const path = require('path');
  const content = fs.readFileSync(
    path.join(__dirname, '../research/modules/researcher.js'), 'utf8');
  // Must NOT reference research/prompts/
  expect(content).not.toContain('research/prompts/system_interview_prep');
  expect(content).not.toContain('system_interview_prep.txt');
  // Must reference config/prompts/
  expect(content).toContain('research-interview-prep-system');
});

test('researcher.js reads interview prep template from config/prompts/', () => {
  const fs = require('fs');
  const path = require('path');
  const content = fs.readFileSync(
    path.join(__dirname, '../research/modules/researcher.js'), 'utf8');
  expect(content).not.toContain('INTERVIEW_PREP_TEMPLATE_PATH');
  expect(content).toContain('research-interview-prep-template');
});

test('dashboard rubric suggest endpoint reads from config/prompts/dashboard-rubric-suggest.md', () => {
  const fs = require('fs');
  const path = require('path');
  const content = fs.readFileSync(
    path.join(__dirname, '../dashboard/server.js'), 'utf8');
  expect(content).toContain('dashboard-rubric-suggest');
});

test('config/prompts/podcast-digest-scoring.md exists', () => {
  const fs = require('fs');
  const path = require('path');
  expect(fs.existsSync(path.join(__dirname, '../config/prompts/podcast-digest-scoring.md'))).toBe(true);
});

test('config/prompts/newsletter-digest-scoring.md exists', () => {
  const fs = require('fs');
  const path = require('path');
  expect(fs.existsSync(path.join(__dirname, '../config/prompts/newsletter-digest-scoring.md'))).toBe(true);
});

test('config/prompts/portfolio-researcher.md exists', () => {
  const fs = require('fs');
  const path = require('path');
  expect(fs.existsSync(path.join(__dirname, '../config/prompts/portfolio-researcher.md'))).toBe(true);
});

test('podcast-monitor server.js does not contain hardcoded digest scoring prompt', () => {
  const fs = require('fs');
  const path = require('path');
  const content = fs.readFileSync(
    path.join(__dirname, '../podcast-monitor/server.js'), 'utf8');
  expect(content).not.toMatch(/Score each podcast episode/);
  expect(content).toContain('podcast-digest-scoring');
});

test('newsletter-monitor server.js does not contain hardcoded digest scoring prompt', () => {
  const fs = require('fs');
  const path = require('path');
  const content = fs.readFileSync(
    path.join(__dirname, '../newsletter-monitor/server.js'), 'utf8');
  expect(content).not.toMatch(/Score each newsletter/);
  expect(content).toContain('newsletter-digest-scoring');
});

test('portfolio-researcher.js does not contain hardcoded prompt', () => {
  const fs = require('fs');
  const path = require('path');
  const jsPath = path.join(__dirname, '../research/modules/portfolio-researcher.js');
  if (!fs.existsSync(jsPath)) return; // skip if file absent
  const content = fs.readFileSync(jsPath, 'utf8');
  expect(content).toContain('portfolio-researcher');
});

describe('Dashboard (port 3030)', () => {
  test('GET /api/activity returns array', async () => {
    const res = await get(3030, '/api/activity');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/status returns agent status map', async () => {
    const res = await get(3030, '/api/status');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });

  test('GET /api/proxy/email-scan/stats returns 200', async () => {
    const res = await get(3030, '/api/proxy/email-scan/stats');
    expect(res.status).toBe(200);
  });

  test('GET /api/proxy/gmail-hygiene/digest returns 200', async () => {
    const res = await get(3030, '/api/proxy/gmail-hygiene/digest');
    expect(res.status).toBe(200);
  });
});

test('identifyContact() accepts researchContext parameter', () => {
  const path = require('path');
  const fs = require('fs');
  const src = fs.readFileSync(
    path.join(__dirname, '../contact-research/modules/identifier.js'), 'utf8');
  expect(src).toContain('researchContext');
});

test('contact-identification.md contains {RESEARCH_CONTEXT} placeholder', () => {
  const path = require('path');
  const fs = require('fs');
  const prompt = fs.readFileSync(
    path.join(__dirname, '../config/prompts/contact-identification.md'), 'utf8');
  expect(prompt).toContain('{RESEARCH_CONTEXT}');
});

test('POST /api/research route accepts researchRunId', () => {
  const path = require('path');
  const fs = require('fs');
  const src = fs.readFileSync(
    path.join(__dirname, '../contact-research/server.js'), 'utf8');
  expect(src).toContain('researchRunId');
});

test('no hardcoded prompt text in identifier.js', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../contact-research/modules/identifier.js'), 'utf8');
  expect(src).not.toMatch(/Find the senior contact/i);
  expect(src).not.toMatch(/You are.*contact.*agent/i);
  expect(src).toContain('contact-identification');
});

test('scoring-rubric.json uses new MTOS+H company rubric', () => {
  const path = require('path');
  const rubric = require(path.join(__dirname, '../config/scoring-rubric.json'));
  const ids = rubric.companyRubric.dimensions.map(d => d.id);
  expect(ids).toContain('M');
  expect(ids).toContain('T');
  expect(ids).toContain('O');
  expect(ids).toContain('S');
  expect(ids).toContain('H');
  expect(ids).not.toContain('E');
  expect(ids).not.toContain('L');
  expect(ids).not.toContain('N');
  expect(rubric.companyRubric.name).toBe('MTOS+H Company Rubric');
});

test('scoring-rubric.json uses new FOAN firm rubric', () => {
  const path = require('path');
  const rubric = require(path.join(__dirname, '../config/scoring-rubric.json'));
  const ids = rubric.firmRubric.dimensions.map(d => d.id);
  expect(ids).toContain('F');
  expect(ids).toContain('O');
  expect(ids).toContain('A');
  expect(ids).toContain('N');
  expect(ids).not.toContain('T');
  expect(ids).not.toContain('M');
  expect(rubric.firmRubric.name).toBe('FOAN Firm Rubric');
});

test('H dimension is manual in company rubric', () => {
  const path = require('path');
  const rubric = require(path.join(__dirname, '../config/scoring-rubric.json'));
  const H = rubric.companyRubric.dimensions.find(d => d.id === 'H');
  expect(H).toBeDefined();
  expect(H.manual).toBe(true);
});

test('N dimension is manual in firm rubric', () => {
  const path = require('path');
  const rubric = require(path.join(__dirname, '../config/scoring-rubric.json'));
  const N = rubric.firmRubric.dimensions.find(d => d.id === 'N');
  expect(N).toBeDefined();
  expect(N.manual).toBe(true);
});

test('scorer-rubric.md contains new scoring rules', () => {
  const fs = require('fs');
  const path = require('path');
  const content = fs.readFileSync(
    path.join(__dirname, '../config/prompts/scorer-rubric.md'), 'utf8');
  expect(content).toContain('mandate-likelihood');
  expect(content).toContain('{{DIMENSIONS}}');
  expect(content).toContain('{{RESEARCH_CONTEXT}}');
  expect(content).toContain('{{JSON_SCHEMA}}');
  expect(content).toContain('{{NAME}}');
});

test('scorer derives manual dimensions from rubric JSON, not hardcoded map', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../scorer/modules/scorer.js'), 'utf8');
  // Must NOT contain hardcoded manual dimension map
  expect(src).not.toMatch(/company.*['"]H['"].*firm.*['"]N['"]/);
  expect(src).not.toMatch(/['"]H['"].*['"]N['"]/);
  // Must use d.manual or .manual property
  expect(src).toMatch(/\.manual/);
});
