'use strict';
const fs = require('fs');
const { fetchAllNewsletters } = require('./gmail');
const { summariseNewsletter } = require('./summariser');
const { notifyNewsletter, sendNewsletterDigest } = require('../../shared/slack.cjs');

const SENDER_BLOCKLIST = new Set([
  'jobalerts-noreply@linkedin.com',
  'messages-noreply@linkedin.com',
  'messaging-digest-noreply@linkedin.com',
  'notifications-noreply@linkedin.com',
  'groups-noreply@linkedin.com',
  'notification@slack.com',
  'noreply-location-sharing@google.com',
  'cloudplatform-noreply@google.com',
  'mailrobot@internations.org',
  'noreply@fitbit.com',
  'noreply@quironsalud.es',
  'noreply@lovable.dev',
  'notifications@zcal.co',
]);

const DOMAIN_BLOCKLIST = new Set([
  'github.com',
]);

const ALOMA_BLOCK_PATTERNS = [
  /\bDOWN\b/i,
  /Monthly SMS Limit/i,
  /payment unsuccessful/i,
  /cron-health-check/i,
];

function shouldSkip(email) {
  const sender = (email.sender_email || '').toLowerCase().trim();
  const subject = email.subject || '';
  const domain = sender.split('@')[1] || '';

  if (SENDER_BLOCKLIST.has(sender)) return `blocklisted sender: ${sender}`;
  if (DOMAIN_BLOCKLIST.has(domain)) return `blocklisted domain: ${domain}`;
  if (sender === 'hello@aloma.io') {
    for (const pattern of ALOMA_BLOCK_PATTERNS) {
      if (pattern.test(subject)) return `aloma system alert: ${subject}`;
    }
  }
  return null;
}

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

      const skipReason = shouldSkip(nl);
      if (skipReason) {
        console.log(`[pipeline] Skipping "${nl.subject}" — ${skipReason}`);
        continue;
      }

      let summaryResult = null;
      try {
        summaryResult = await summariseNewsletter(nl);
        summarised++;
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        log(`Summary error for "${nl.subject}": ${err.message}`);
        errors++;
      }

      if (summaryResult && summaryResult.is_newsletter === false) {
        console.log(`[pipeline] LLM flagged as non-newsletter: "${nl.subject}" — skipping insert`);
        continue;
      }

      const summaryText = typeof summaryResult === 'string' ? summaryResult : (summaryResult?.summary || null);
      const takeaway = summaryResult?.one_line_takeaway || '';
      const topTags = JSON.stringify(summaryResult?.top_tags || []);
      const keyPoints = JSON.stringify(summaryResult?.key_points || []);
      const bestSections = JSON.stringify(summaryResult?.best_sections || []);
      const followups = JSON.stringify(summaryResult?.actionable_followups || []);
      const skipSections = JSON.stringify(summaryResult?.skip_sections ?? []);
      const isNewsletter = summaryResult?.is_newsletter !== false ? 1 : 0;

      db.prepare(`
        INSERT INTO newsletters (message_id, subject, sender_name, sender_email, account, snippet, body, summary, one_line_takeaway, top_tags, key_points, best_sections, actionable_followups, skip_sections, is_newsletter, received_at, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'))
      `).run(nl.message_id, nl.subject, nl.sender_name, nl.sender_email, nl.account, '', nl.body || '', summaryText, takeaway, topTags, keyPoints, bestSections, followups, skipSections, isNewsletter, nl.date || new Date().toISOString());
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
