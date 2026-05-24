'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

let db;
let tmpPath;

beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `log-test-${process.pid}-${Date.now()}.db`);
  process.env.ANTHROPIC_LOG_DB_OVERRIDE = tmpPath;
  db = new Database(tmpPath);
  db.exec(`CREATE TABLE api_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    agent TEXT, prompt_name TEXT, model TEXT,
    input_tokens INTEGER, output_tokens INTEGER,
    cost_usd REAL, latency_ms INTEGER,
    success INTEGER DEFAULT 1, error TEXT
  )`);
  // Reset module cache so anthropic.cjs picks up the env var fresh
  jest.resetModules();
});

afterEach(() => {
  try { db.close(); } catch (_) {}
  try { fs.unlinkSync(tmpPath); } catch (_) {}
  delete process.env.ANTHROPIC_LOG_DB_OVERRIDE;
});

describe('_logApiCall helper (shared/anthropic.cjs)', () => {
  test('success row writes all token + cost fields', () => {
    const { _logApiCall } = require('../../../shared/anthropic.cjs');
    _logApiCall({
      agent: 'podcast-monitor', promptName: 'podcast-summarisation',
      model: 'claude-haiku-4-5', inputTokens: 1000, outputTokens: 500,
      costUsd: 0.0125, latencyMs: 850, success: true,
    });
    const reader = new Database(tmpPath, { readonly: true });
    const row = reader.prepare('SELECT * FROM api_calls ORDER BY id DESC LIMIT 1').get();
    reader.close();
    expect(row.agent).toBe('podcast-monitor');
    expect(row.prompt_name).toBe('podcast-summarisation');
    expect(row.model).toBe('claude-haiku-4-5');
    expect(row.input_tokens).toBe(1000);
    expect(row.output_tokens).toBe(500);
    expect(row.cost_usd).toBeCloseTo(0.0125);
    expect(row.latency_ms).toBe(850);
    expect(row.success).toBe(1);
    expect(row.error).toBeNull();
  });

  test('failure row writes error, omits token fields', () => {
    const { _logApiCall } = require('../../../shared/anthropic.cjs');
    _logApiCall({
      agent: 'digest-server', promptName: 'deep-dive',
      model: 'claude-sonnet-4-6', latencyMs: 3200, success: false,
      error: 'rate limited',
    });
    const reader = new Database(tmpPath, { readonly: true });
    const row = reader.prepare('SELECT * FROM api_calls ORDER BY id DESC LIMIT 1').get();
    reader.close();
    expect(row.success).toBe(0);
    expect(row.error).toBe('rate limited');
    expect(row.input_tokens).toBeNull();
    expect(row.output_tokens).toBeNull();
    expect(row.cost_usd).toBeNull();
  });

  test('never throws on DB error (logger must not break callers)', () => {
    process.env.ANTHROPIC_LOG_DB_OVERRIDE = '/nonexistent/path/that/does/not/exist.db';
    jest.resetModules();
    const { _logApiCall } = require('../../../shared/anthropic.cjs');
    expect(() => _logApiCall({ agent: 'x', model: 'y', success: true })).not.toThrow();
  });
});
