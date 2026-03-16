/**
 * Model config tests
 * Tests: config/models.json existence, required keys, API GET/POST
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const MODELS_PATH = path.join(__dirname, '..', 'config', 'models.json');
const BASE_URL = 'http://localhost:3030';

function httpRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Model config file', () => {
  test('config/models.json exists', () => {
    expect(fs.existsSync(MODELS_PATH)).toBe(true);
  });

  test('models.json has required slot keys', () => {
    const data = JSON.parse(fs.readFileSync(MODELS_PATH, 'utf8'));
    expect(data).toHaveProperty('synthesis');
    expect(data).toHaveProperty('classification');
    expect(data).toHaveProperty('podcast_summary');
    expect(data).toHaveProperty('podcast_section');
  });
});

describe('Model config API', () => {
  test('GET /api/config/models returns 200 with synthesis key', async () => {
    const res = await httpRequest('GET', '/api/config/models');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('synthesis');
  });

  test('POST /api/config/models saves and returns updated config', async () => {
    // Read current
    const current = await httpRequest('GET', '/api/config/models');
    expect(current.status).toBe(200);

    // Update synthesis to a different model
    const updated = { ...current.body, synthesis: 'claude-haiku-4-5-20251001' };
    delete updated._available;
    delete updated._descriptions;
    const postRes = await httpRequest('POST', '/api/config/models', updated);
    expect(postRes.status).toBe(200);
    expect(postRes.body).toHaveProperty('ok', true);

    // Verify it persisted
    const verify = await httpRequest('GET', '/api/config/models');
    expect(verify.body.synthesis).toBe('claude-haiku-4-5-20251001');

    // Restore original
    const restore = { ...current.body };
    delete restore._available;
    delete restore._descriptions;
    await httpRequest('POST', '/api/config/models', restore);
  });
});
