'use strict';
const fs = require('fs');
const { fetchAllNewsletters } = require('./gmail');
const { summariseNewsletter } = require('./summariser');
const { notifyNewsletter, sendNewsletterDigest } = require('../../shared/slack.cjs');

async function runPipeline(db, daysBack = 1) {
  const log = (msg) => console.log(`[newsletter-monitor] ${new Date().toISOString()} ${msg}`);
  const runId = Date.now();
  let fetched = 0, summarised = 0, skipped = 0, errors = 0;

  log('Starting newsletter scan...');

  try {
    const newsletters = await fetchAllNewsletters(daysBack);
    fetched = newsletters.length;
    log(`Fetched ${fetched} newsletters`);

    for (const nl of newsletters) {
      const existing = db.prepare('SELECT id FROM newsletters WHERE message_id = ?').get(nl.message_id);
      if (existing) { skipped++; continue; }

      let summaryResult = null;
      try {
        summaryResult = await summariseNewsletter(nl);
        summarised++;
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        log(`Summary error for "${nl.subject}": ${err.message}`);
        errors++;
      }

      const summaryText = typeof summaryResult === 'string' ? summaryResult : (summaryResult?.summary || null);
      const takeaway = summaryResult?.one_line_takeaway || '';
      const topTags = JSON.stringify(summaryResult?.top_tags || []);
      const keyPoints = JSON.stringify(summaryResult?.key_points || []);
      const bestSections = JSON.stringify(summaryResult?.best_sections || []);
      const followups = JSON.stringify(summaryResult?.actionable_followups || []);

      db.prepare(`
        INSERT INTO newsletters (message_id, subject, sender_name, sender_email, account, snippet, body, summary, one_line_takeaway, top_tags_json, key_points_json, best_sections_json, actionable_followups_json, received_at, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'))
      `).run(nl.message_id, nl.subject, nl.sender_name, nl.sender_email, nl.account, '', nl.body || '', summaryText, takeaway, topTags, keyPoints, bestSections, followups, nl.date || new Date().toISOString());
      // REMOVED digest-refactor-20Mar: notifyNewsletter({ subject: nl.subject, sender_name: nl.sender_name, sender_email: nl.sender_email, account: nl.account, summary }).catch(() => {});
    }

    db.prepare(`
      INSERT INTO run_log (run_id, fetched, summarised, skipped, errors, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(runId, fetched, summarised, skipped, errors);

    log(`Run complete: ${summarised} summarised, ${skipped} skipped, ${errors} errors`);

    // Send digest Slack after pipeline run completes (lockfile prevents repeat sends)
    const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const lockFile = process.env.NEWSLETTER_DIGEST_LOCK_FILE ||
      `/tmp/newsletter-digest-${today}.lock`;
    if (!fs.existsSync(lockFile)) {
      try {
        const digestRes = await fetch('http://localhost:3041/api/digest/newsletter');
        const digestItems = await digestRes.json();
        if (digestItems.length > 0) {
          await sendNewsletterDigest(digestItems);
          fs.writeFileSync(lockFile, new Date().toISOString());
          log('Digest sent to Slack');
        }
      } catch (e) { console.error('[pipeline] digest Slack error:', e.message); }
    } else {
      log(`Digest already sent today (${lockFile}) — skipping Slack`);
    }

    return { ok: true, fetched, summarised, skipped, errors };
  } catch (err) {
    log(`Pipeline error: ${err.message}`);
    db.prepare(`INSERT INTO run_log (run_id, fetched, summarised, skipped, errors, created_at) VALUES (?, 0, 0, 0, 1, datetime('now'))`).run(runId);
    return { ok: false, error: err.message };
  }
}

module.exports = { runPipeline };
