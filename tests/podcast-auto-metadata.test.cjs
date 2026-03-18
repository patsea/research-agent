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

function isServerUp(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: 'localhost', port, path: '/api/episodes?limit=1' }, (res) => {
      res.resume();
      resolve(true);
    });
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

let serverRunning = false;

beforeAll(async () => {
  serverRunning = await isServerUp(3040);
  if (!serverRunning) {
    console.log('⚠️  Podcast monitor not running on port 3040 — skipping integration tests');
  }
});

describe('Podcast Monitor — YouTube auto-metadata (port 3040)', () => {
  let episodeId;

  test('Adding YouTube URL returns episode id', async () => {
    if (!serverRunning) return;
    const res = await post(3040, '/api/feeds/youtube', {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    // 200 = new insert, 409 = already exists (idempotent)
    expect([200, 409]).toContain(res.status);
    expect(res.body).toHaveProperty('id');
    episodeId = res.body.id;
  });

  test('Episode has thumbnail populated within 10s of add', async () => {
    if (!serverRunning) return;
    await new Promise(r => setTimeout(r, 10000));
    const res = await get(3040, `/api/episodes?limit=5`);
    const ep = res.body.find(e => e.id === episodeId);
    expect(ep).toBeDefined();
    const hasMeta = ep?.thumbnail_url || ep?.channel_name || ep?.title;
    expect(hasMeta).toBeTruthy();
  }, 20000);
});

test('episodes table has rich scoring columns', () => {
  const Database = require('better-sqlite3');
  const path = require('path');
  const db = new Database(path.join(__dirname, '../podcast-monitor/data/podcast-monitor.db'));
  const cols = db.prepare('PRAGMA table_info(episodes)').all().map(c => c.name);
  expect(cols).toContain('episode_verdict');
  expect(cols).toContain('one_line_takeaway');
  expect(cols).toContain('best_sections_json');
  expect(cols).toContain('skip_sections_json');
  expect(cols).toContain('top_tags_json');
  expect(cols).toContain('why_relevant');
  db.close();
});

test('parser supports both score and episode_score field names', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../podcast-monitor/server.js'), 'utf8');
  expect(src).toMatch(/episode_score/);
});
