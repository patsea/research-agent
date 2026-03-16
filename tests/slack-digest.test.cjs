const request = require('supertest');

describe('Podcast digest route', () => {
  it('GET /api/digest/podcast returns 200 array', async () => {
    const res = await request('http://localhost:3040').get('/api/digest/podcast');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
  it('digest items have relevance_score field', async () => {
    const res = await request('http://localhost:3040').get('/api/digest/podcast');
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('relevance_score');
    }
  });
});

describe('Newsletter digest route', () => {
  it('GET /api/digest/newsletter returns 200 array', async () => {
    const res = await request('http://localhost:3041').get('/api/digest/newsletter');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
  it('digest items have relevance_score field', async () => {
    const res = await request('http://localhost:3041').get('/api/digest/newsletter');
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('relevance_score');
    }
  });
});
