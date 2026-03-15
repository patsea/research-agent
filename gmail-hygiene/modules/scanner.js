import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { notifyNewSender } = require('../../shared/slack.cjs');
import { callGmail, parseSearchResults } from './gmail.js';
import { classifySender } from './classifier.js';
import { getDb } from '../db.js';

export async function scanInbox(daysBack = 7, account = 'gmail') {
  const db = getDb();
  const results = { newSenders: 0, knownSenders: 0, errors: [], account };

  const raw = await callGmail('search_emails', {
    query: `newer_than:${daysBack}d`,
    max_results: 200
  }, account);

  let emails = parseSearchResults(raw);

  const senderMap = new Map();
  for (const email of emails) {
    // from may be object {email,name} (JSON) or string "Name <email>" (plain-text parsed)
    let addr = '';
    let name = '';
    if (typeof email.from === 'object' && email.from?.email) {
      addr = email.from.email;
      name = email.from.name || '';
    } else if (typeof email.from === 'string') {
      const m = email.from.match(/<([^>]+)>/);
      addr = m ? m[1] : email.from;
      name = m ? email.from.replace(/<[^>]+>/, '').trim() : '';
    }
    addr = addr || email.sender || '';
    const subj = email.subject || '';
    if (!addr) continue;
    if (!senderMap.has(addr)) senderMap.set(addr, { name, subjects: [] });
    senderMap.get(addr).subjects.push(subj);
  }

  const now = new Date().toISOString();
  for (const [addr, info] of senderMap) {
    const existing = db.prepare('SELECT id FROM senders WHERE email_address = ?').get(addr);
    if (existing) {
      // Calculate frequency_per_month from first_seen to now and email count in this scan
      const row = db.prepare('SELECT first_seen FROM senders WHERE email_address = ?').get(addr);
      let freq = null;
      if (row?.first_seen) {
        // Extrapolate emails seen in scan window to monthly rate
        freq = Math.round((info.subjects.length / (daysBack / 30)) * 10) / 10;
      }
      db.prepare('UPDATE senders SET last_seen = ?, frequency_per_month = COALESCE(?, frequency_per_month), updated_at = ? WHERE email_address = ?')
        .run(now, freq, now, addr);
      results.knownSenders++;
    } else {
      const domain = addr.split('@')[1] || '';
      const label = await classifySender({
        emailAddress: addr,
        displayName: info.name,
        subjects: info.subjects
      });
      const freq = Math.round((info.subjects.length / (daysBack / 30)) * 10) / 10;
      db.prepare(`INSERT INTO senders
        (email_address, display_name, domain, label_name, frequency_per_month, status, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`)
        .run(addr, info.name, domain, label, freq, now, now);
      db.prepare(`INSERT INTO actions (sender_id, action_type, detail, result)
        VALUES ((SELECT id FROM senders WHERE email_address = ?), 'classify', ?, 'success')`)
        .run(addr, `Classified as: ${label}`);
      notifyNewSender({ email_address: addr, display_name: info.name, domain, label_name: label, frequency_per_month: freq }).catch(() => {});
      results.newSenders++;
    }
  }

  return results;
}
