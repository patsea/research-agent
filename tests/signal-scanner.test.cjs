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

describe('Signal Scanner (port 3033)', () => {
  test('GET /api/signals returns array', async () => {
    const res = await get(3033, '/api/signals');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/signals?limit=1 returns at most 1 result', async () => {
    const res = await get(3033, '/api/signals?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(1);
  });
});
