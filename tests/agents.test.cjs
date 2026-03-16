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
