'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { getModel } = require('../shared/models.cjs');
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
    body TEXT DEFAULT '',
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
    logActivity({ agent: 'newsletter-monitor', action: 'status-update', detail: `Newsletter ${req.params.id} → ${status}` });
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/run', async (req, res) => {
  const daysBack = req.body?.daysBack || 1;
  res.json({ ok: true, message: 'Pipeline started', daysBack });
  try {
    const result = await runPipeline(db, daysBack);
    logActivity({ agent: 'newsletter-monitor', action: 'run-complete', detail: `Fetched ${result.fetched}, summarised ${result.summarised}` });
  } catch(err) {
    console.error('[newsletter-monitor] Run error:', err.message);
  }
});

app.get('/api/run-log', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM run_log ORDER BY created_at DESC LIMIT 10').all());
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Daily newsletter digest — past 24h, AI-ranked by relevance_score
app.get('/api/digest/newsletter', async (req, res) => {
  try {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    const daysBack = parseInt(req.query.daysBack) || 1;
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(`
      SELECT id, subject, sender_name, sender_email, summary, relevance_score, received_at, account
      FROM newsletters WHERE received_at >= ?
      ORDER BY relevance_score DESC, received_at DESC LIMIT 20
    `).all(since);
    if (rows.length === 0) return res.json([]);

    const unscored = rows.filter(r => !r.relevance_score);
    if (unscored.length > 0 && ANTHROPIC_API_KEY) {
      const scoringInstruction = fs.readFileSync(
        path.join(__dirname, '../config/prompts/newsletter-digest-scoring.md'), 'utf8').trim();
      const prompt = scoringInstruction + `\nNewsletters:\n` +
        unscored.map(n => `ID:${n.id} Subject:"${n.subject}" From:${n.sender_name||''} Summary:${(n.summary||'').slice(0,150)}`).join('\n');
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: getModel('classification'), max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
        });
        const data = await r.json();
        const text = (data?.content?.[0]?.text || '[]').replace(/```json|```/g, '').trim();
        const scores = JSON.parse(text);
        const stmt = db.prepare('UPDATE newsletters SET relevance_score = ? WHERE id = ?');
        for (const { id, score } of scores) stmt.run(score, id);
      } catch (e) { console.error('[digest/newsletter] scoring error:', e.message); }
    }
    const ranked = db.prepare(`
      SELECT id, subject, sender_name, sender_email, summary, relevance_score, received_at, account
      FROM newsletters WHERE received_at >= ?
      ORDER BY relevance_score DESC, received_at DESC LIMIT 10
    `).all(since);
    res.json(ranked);
  } catch (err) {
    console.error('[digest/newsletter]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/digest/send', async (req, res) => {
  const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const lockFile = req.body?.lockFile ||
    process.env.NEWSLETTER_DIGEST_LOCK_FILE ||
    `/tmp/newsletter-digest-${today}.lock`;

  if (fs.existsSync(lockFile)) {
    return res.json({ ok: true, skipped: true, reason: 'already sent today' });
  }

  try {
    const { sendNewsletterDigest } = require('../shared/slack.cjs');
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const newsletters = db.prepare(
      "SELECT id, subject, sender_name, sender_email, summary, relevance_score, received_at, account FROM newsletters WHERE received_at >= ? ORDER BY relevance_score DESC LIMIT 10"
    ).all(since);
    fs.writeFileSync(lockFile, new Date().toISOString());
    if (newsletters.length > 0) await sendNewsletterDigest(newsletters);
    res.json({ ok: true, sent: true, count: newsletters.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/subscriptions', (req, res) => {
  try {
    const senders = db.prepare(`
      SELECT sender_name, sender_email, account,
             COUNT(*) as total,
             MAX(received_at) as last_received,
             SUM(CASE WHEN status='unsubscribed' THEN 1 ELSE 0 END) as unsub_count
      FROM newsletters
      GROUP BY sender_email
      ORDER BY last_received DESC
    `).all();
    res.json(senders);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Settings: read/write newsletter summarisation prompt
app.get('/api/settings/prompts', (req, res) => {
  try {
    const promptPath = path.join(__dirname, '..', 'config', 'prompts', 'newsletter-summarisation.md');
    const fs = require('fs');
    const content = fs.readFileSync(promptPath, 'utf8');
    res.json({ summarisation: content });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/settings/prompts', (req, res) => {
  try {
    const { summarisation } = req.body;
    if (!summarisation) return res.status(400).json({ error: 'Missing summarisation prompt' });
    const promptPath = path.join(__dirname, '..', 'config', 'prompts', 'newsletter-summarisation.md');
    const fs = require('fs');
    fs.writeFileSync(promptPath, summarisation, 'utf8');
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`[newsletter-monitor] Running on port ${PORT}`));
