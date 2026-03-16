'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { runPipeline } = require('./modules/pipeline');

const app = express();
const PORT = 3041;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database(path.join(__dirname, 'data', 'newsletter-monitor.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS newsletters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT UNIQUE,
    subject TEXT,
    sender_name TEXT,
    sender_email TEXT,
    account TEXT,
    snippet TEXT,
    summary TEXT,
    received_at TEXT,
    status TEXT DEFAULT 'new',
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS run_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER,
    fetched INTEGER DEFAULT 0,
    summarised INTEGER DEFAULT 0,
    skipped INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    created_at TEXT
  );
`);

let logActivity;
try {
  logActivity = require('../shared/activityLogger').logActivity;
} catch(_) { logActivity = () => {}; }

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'newsletter-monitor', port: PORT });
});

app.get('/api/newsletters', (req, res) => {
  const { date, limit = 50, status } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];
  let query = `SELECT * FROM newsletters WHERE date(received_at) = ? OR date(created_at) = ?`;
  const params = [targetDate, targetDate];
  if (status) { query += ` AND status = ?`; params.push(status); }
  query += ` ORDER BY received_at DESC LIMIT ?`;
  params.push(parseInt(limit));
  try {
    res.json(db.prepare(query).all(...params));
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history', (req, res) => {
  try {
    const days = db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count,
             SUM(CASE WHEN status='read' THEN 1 ELSE 0 END) as read_count,
             SUM(CASE WHEN status='unsubscribed' THEN 1 ELSE 0 END) as unsub_count
      FROM newsletters
      GROUP BY date(created_at)
      ORDER BY day DESC
      LIMIT 30
    `).all();
    res.json(days);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/newsletters/:id/status', (req, res) => {
  const { status } = req.body;
  const allowed = ['new', 'read', 'skip', 'unsubscribed'];
  if (!allowed.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${allowed.join(', ')}` });
  try {
    db.prepare('UPDATE newsletters SET status = ? WHERE id = ?').run(status, req.params.id);
    logActivity('newsletter-monitor', null, 'status-update', `Newsletter ${req.params.id} → ${status}`);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/run', async (req, res) => {
  const daysBack = req.body?.daysBack || 1;
  res.json({ ok: true, message: 'Pipeline started', daysBack });
  try {
    const result = await runPipeline(db, daysBack);
    logActivity('newsletter-monitor', null, 'run-complete', `Fetched ${result.fetched}, summarised ${result.summarised}`);
  } catch(err) {
    console.error('[newsletter-monitor] Run error:', err.message);
  }
});

app.get('/api/run-log', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM run_log ORDER BY created_at DESC LIMIT 10').all());
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`[newsletter-monitor] Running on port ${PORT}`));
