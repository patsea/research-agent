/**
 * Newsletter Monitor — Gmail fetch tests
 * Requires newsletter-monitor running on port 3041
 */
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
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

function post(port, path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const opts = {
      hostname: 'localhost', port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('Newsletter Monitor (port 3041)', () => {
  test('health check returns ok', async () => {
    const res = await get(3041, '/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  test('GET /api/newsletters returns array', async () => {
    const res = await get(3041, '/api/newsletters');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/run-log returns array with at least one entry', async () => {
    const res = await get(3041, '/api/run-log');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('POST /api/run returns ok:true', async () => {
    const res = await post(3041, '/api/run', { daysBack: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
  });

  test('newsletters include gmail-growthworks source', async () => {
    const res = await get(3041, '/api/newsletters');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const accounts = res.body.map(n => n.account || n.source_account);
    expect(accounts).toContain('gmail-growthworks');
  });
});
