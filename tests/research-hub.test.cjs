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
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('Research Hub (port 3035)', () => {
  test('GET /api/research-history returns array', async () => {
    const res = await get(3035, '/api/research-history');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/sigint/sources returns array', async () => {
    const res = await get(3035, '/api/sigint/sources');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /api/research (deprecated) returns 410', async () => {
    const res = await post(3035, '/api/research', { company: 'test' });
    expect(res.status).toBe(410);
  });

  test('POST /api/audit with short input returns 400', async () => {
    const res = await post(3035, '/api/audit', { content: 'short' });
    expect(res.status).toBe(400);
  });
});
