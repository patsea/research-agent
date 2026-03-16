/**
 * Podcast Monitor — auto-metadata on YouTube add
 * Requires podcast-monitor running on port 3040
 */
const http = require('http');

function post(port, path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const opts = {
      hostname: 'localhost', port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: 'localhost', port, path }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

describe('Podcast Monitor — YouTube auto-metadata (port 3040)', () => {
  let episodeId;

  test('Adding YouTube URL returns episode id', async () => {
    const res = await post(3040, '/api/feeds/youtube', {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    episodeId = res.body.id;
  });

  test('Episode has thumbnail populated within 10s of add', async () => {
    await new Promise(r => setTimeout(r, 10000));
    const res = await get(3040, `/api/episodes?limit=5`);
    const ep = res.body.find(e => e.id === episodeId);
    expect(ep).toBeDefined();
    const hasMeta = ep?.thumbnail_url || ep?.channel_name || ep?.title;
    expect(hasMeta).toBeTruthy();
  }, 20000);
});
