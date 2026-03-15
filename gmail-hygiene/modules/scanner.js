import { callGmail, parseSearchResults } from './gmail.js';
import { classifySender } from './classifier.js';
import { getDb } from '../db.js';

export async function scanInbox(daysBack = 7) {
  const db = getDb();
  const results = { newSenders: 0, knownSenders: 0, errors: [] };

  const raw = await callGmail('search_emails', {
    query: `newer_than:${daysBack}d`,
    max_results: 200
  });

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
      db.prepare('UPDATE senders SET last_seen = ?, updated_at = ? WHERE email_address = ?')
        .run(now, now, addr);
      results.knownSenders++;
    } else {
      const domain = addr.split('@')[1] || '';
      const label = await classifySender({
        emailAddress: addr,
        displayName: info.name,
        subjects: info.subjects
      });
      db.prepare(`INSERT INTO senders
        (email_address, display_name, domain, label_name, status, first_seen, last_seen)
        VALUES (?, ?, ?, ?, 'active', ?, ?)`)
        .run(addr, info.name, domain, label, now, now);
      db.prepare(`INSERT INTO actions (sender_id, action_type, detail, result)
        VALUES ((SELECT id FROM senders WHERE email_address = ?), 'classify', ?, 'success')`)
        .run(addr, `Classified as: ${label}`);
      results.newSenders++;
    }
  }

  return results;
}
