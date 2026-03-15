'use strict';
const { fetchNewsletters } = require('./gmail');
const { summariseNewsletter } = require('./summariser');
const { notifyNewsletter } = require('../../shared/slack.cjs');

async function runPipeline(db, daysBack = 1) {
  const log = (msg) => console.log(`[newsletter-monitor] ${new Date().toISOString()} ${msg}`);
  const runId = Date.now();
  let fetched = 0, summarised = 0, skipped = 0, errors = 0;

  log('Starting newsletter scan...');

  try {
    const newsletters = await fetchNewsletters(daysBack);
    fetched = newsletters.length;
    log(`Fetched ${fetched} newsletters`);

    for (const nl of newsletters) {
      const existing = db.prepare('SELECT id FROM newsletters WHERE message_id = ?').get(nl.messageId);
      if (existing) { skipped++; continue; }

      let summary = null;
      try {
        summary = await summariseNewsletter(nl);
        summarised++;
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        log(`Summary error for "${nl.subject}": ${err.message}`);
        errors++;
      }

      db.prepare(`
        INSERT INTO newsletters (message_id, subject, sender_name, sender_email, account, snippet, summary, received_at, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'))
      `).run(nl.messageId, nl.subject, nl.sender, nl.senderEmail, nl.account, nl.snippet || '', summary, nl.receivedAt || new Date().toISOString());
      notifyNewsletter({ subject: nl.subject, sender_name: nl.sender, sender_email: nl.senderEmail, account: nl.account, summary }).catch(() => {});
    }

    db.prepare(`
      INSERT INTO run_log (run_id, fetched, summarised, skipped, errors, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(runId, fetched, summarised, skipped, errors);

    log(`Run complete: ${summarised} summarised, ${skipped} skipped, ${errors} errors`);
    return { ok: true, fetched, summarised, skipped, errors };
  } catch (err) {
    log(`Pipeline error: ${err.message}`);
    db.prepare(`INSERT INTO run_log (run_id, fetched, summarised, skipped, errors, created_at) VALUES (?, 0, 0, 0, 1, datetime('now'))`).run(runId, 0, 0, 0, 1);
    return { ok: false, error: err.message };
  }
}

module.exports = { runPipeline };
