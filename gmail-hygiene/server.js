import 'dotenv/config';
import express from 'express';
import { scanInbox } from './modules/scanner.js';
import { attemptUnsubscribe, extractUnsubUrl } from './modules/unsubscriber.js';
import { callGmail, parseSearchResults } from './modules/gmail.js';
import { getDb } from './db.js';
import { logActivity } from '../shared/activityLogger.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3039;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'gmail-hygiene-gmail-hygiene', port: PORT });
});

app.post('/api/scan', async (req, res) => {
  const { daysBack = 7, account } = req.body;
  // If a specific account is requested, scan just that one
  // Otherwise scan all active accounts
  // NOTE: 'gmail-growthworks' excluded until OAuth credentials.json is created
  const accounts = account ? [account] : ['gmail', 'gmail-aloma'];
  const allResults = [];
  const errors = [];

  for (const acct of accounts) {
    try {
      const result = await scanInbox(daysBack, acct);
      allResults.push(result);
      logActivity({ agent: 'gmail-hygiene', action: 'scan_complete', result: 'success',
        detail: `[${acct}] new=${result.newSenders}, known=${result.knownSenders}` });
    } catch (err) {
      errors.push({ account: acct, error: err.message });
      logActivity({ agent: 'gmail-hygiene', action: 'scan_complete', result: 'error', detail: `[${acct}] ${err.message}` });
    }
  }

  const combined = {
    success: errors.length === 0,
    accounts: allResults,
    newSenders: allResults.reduce((s, r) => s + r.newSenders, 0),
    knownSenders: allResults.reduce((s, r) => s + r.knownSenders, 0),
    ...(errors.length > 0 ? { errors } : {})
  };
  res.json(combined);
});

app.get('/api/senders', (req, res) => {
  const db = getDb();
  const { status, label } = req.query;
  let query = 'SELECT * FROM senders WHERE 1=1';
  const params = [];
  if (status) { query += ' AND status = ?'; params.push(status); }
  if (label) { query += ' AND label_name = ?'; params.push(label); }
  query += ' ORDER BY last_seen DESC LIMIT 200';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/senders/:id/unsubscribe', async (req, res) => {
  const db = getDb();
  const sender = db.prepare('SELECT * FROM senders WHERE id = ?').get(req.params.id);
  if (!sender) return res.status(404).json({ error: 'Sender not found' });
  try {
    let url = sender.unsub_url;
    if (!url) {
      // Search Gmail for most recent message from this sender to get message ID
      const searchRaw = await callGmail('search_emails', {
        query: `from:${sender.email_address}`,
        max_results: 1
      });
      const msgs = parseSearchResults(searchRaw);
      if (msgs.length > 0) {
        const unsubInfo = await extractUnsubUrl(msgs[0].id || msgs[0].messageId);
        url = unsubInfo?.url;
      }
    }
    if (!url) {
      return res.json({ success: false, result: 'no_url', detail: 'No unsubscribe URL found' });
    }
    const outcome = await attemptUnsubscribe(url);
    const now = new Date().toISOString();
    db.prepare('UPDATE senders SET unsub_url = ?, unsub_result = ?, updated_at = ? WHERE id = ?')
      .run(url, outcome.result, now, sender.id);
    if (outcome.result === 'success') {
      db.prepare("UPDATE senders SET status = 'unsubscribed', updated_at = ? WHERE id = ?")
        .run(now, sender.id);
    }
    db.prepare('INSERT INTO actions (sender_id, action_type, detail, result) VALUES (?, ?, ?, ?)')
      .run(sender.id, 'unsubscribe', outcome.detail, outcome.result);
    logActivity({ agent: 'gmail-hygiene', action: 'unsubscribe', company: sender.domain, result: outcome.result, detail: outcome.detail });
    res.json({ success: true, ...outcome });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/senders/:id/block', async (req, res) => {
  const db = getDb();
  const sender = db.prepare('SELECT * FROM senders WHERE id = ?').get(req.params.id);
  if (!sender) return res.status(404).json({ error: 'Sender not found' });
  try {
    await callGmail('modify_email', {
      query: `from:${sender.email_address}`,
      add_labels: ['SPAM'],
      remove_labels: ['INBOX']
    });
    const now = new Date().toISOString();
    db.prepare("UPDATE senders SET status = 'blocked', updated_at = ? WHERE id = ?")
      .run(now, sender.id);
    db.prepare('INSERT INTO actions (sender_id, action_type, detail, result) VALUES (?, ?, ?, ?)')
      .run(sender.id, 'block', `Marked SPAM: ${sender.email_address}`, 'success');
    logActivity({ agent: 'gmail-hygiene', action: 'block', company: sender.domain, result: 'success' });
    res.json({ success: true, detail: `${sender.email_address} marked as SPAM` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/senders/:id/keep', (req, res) => {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE senders SET status = 'kept', updated_at = ? WHERE id = ?")
    .run(now, req.params.id);
  res.json({ success: true });
});

app.post('/api/senders/:id/classify', (req, res) => {
  const db = getDb();
  const { label_name } = req.body;
  if (!label_name) return res.status(400).json({ error: 'label_name required' });
  const now = new Date().toISOString();
  db.prepare('UPDATE senders SET label_name = ?, updated_at = ? WHERE id = ?')
    .run(label_name, now, req.params.id);
  res.json({ success: true });
});

app.get('/api/digest', (req, res) => {
  const db = getDb();
  const senders = db.prepare("SELECT status, COUNT(*) as count FROM senders GROUP BY status").all();
  const actions = db.prepare("SELECT action_type, result, COUNT(*) as count FROM actions GROUP BY action_type, result").all();
  res.json({ senders, actions, generated: new Date().toISOString() });
});

process.on('SIGTERM', () => { process.exit(0); });
process.on('SIGINT', () => { process.exit(0); });

app.listen(PORT, () => console.log(`Gmail Hygiene running on port ${PORT}`));
