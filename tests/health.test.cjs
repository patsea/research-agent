/**
 * Health check tests — all 10 agents
 * Requires all agents running on their respective ports before execution.
 * Run: npm test
 */

const http = require('http');

const AGENTS = [
  { name: 'Dashboard',           port: 3030, path: '/api/health' },
  { name: 'Signal Scanner',      port: 3033, path: '/api/health' },
  { name: 'Email Scan',          port: 3034, path: '/api/health' },
  { name: 'Research Hub',        port: 3035, path: '/api/health' },
  { name: 'Contact Research',    port: 3036, path: '/api/health' },
  { name: 'Outreach Drafter',    port: 3037, path: '/api/health' },
  { name: 'Scorer',              port: 3038, path: '/api/health' },
  { name: 'Gmail Hygiene',       port: 3039, path: '/api/health' },
  { name: 'Podcast Monitor',     port: 3040, path: '/api/health' },
  { name: 'Newsletter Monitor',  port: 3041, path: '/api/health' },
];

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: 'localhost', port, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.setTimeout(5000, () => { req.destroy(); reject(new Error(`Timeout port ${port}`)); });
    req.on('error', reject);
  });
}

describe('Health checks — all 10 agents', () => {
  for (const agent of AGENTS) {
    test(`${agent.name} (port ${agent.port}) returns 200 with status ok`, async () => {
      const res = await get(agent.port, agent.path);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
    });
  }
});
