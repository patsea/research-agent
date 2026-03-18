import { searchMessages, readMessage, ACTIVE_ACCOUNTS } from './gmail.js';
import { classifyReply } from './classify.js';
import { processed, runLog } from '../db.js';
import { lookupByEmail, updateStatus, setNextAction, appendNote, createTask } from './attio.js';

const PROTECTED = new Set(['Interested', 'Call scheduled', 'Call had', 'Mandate flagged', 'In process']);

const EXCLUSION_DOMAINS = new Set([
  'mailer-daemon', 'postmaster', 'noreply', 'no-reply', 'notifications',
  'donotreply', 'do-not-reply', 'bounce', 'auto-reply', 'autoreply'
]);

function lookbackDate(hours = 24) {
  const d = new Date(Date.now() - hours * 3600000);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(baseDate, n) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function isBounce(subject, body) {
  const subjectLower = (subject || '').toLowerCase();
  const bodyLower = (body || '').toLowerCase();
  const subjectSignals = ['delivery failed', 'undeliverable', 'delivery status notification', 'failure notice', 'returned mail', 'message not delivered', 'non-delivery report', 'address not found', 'mail delivery'];
  const bodySignals = ['550 5.1.1', '550 5.4.1', 'user unknown', 'no such user', 'account does not exist', 'mailbox not found', 'email account that you tried to reach does not exist'];
  return subjectSignals.some(s => subjectLower.includes(s)) || bodySignals.some(s => bodyLower.includes(s));
}

function extractEmail(text) {
  const match = (text || '').match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
  return match ? match[0] : null;
}

function isExcludedSender(email) {
  if (!email) return true;
  const local = email.split('@')[0].toLowerCase();
  return EXCLUSION_DOMAINS.has(local);
}

function extractName(fromHeader) {
  if (!fromHeader) return null;
  const match = fromHeader.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : null;
}

async function scanOutgoing(stats, options = {}, account = 'gmail') {
  const { dryRun = false, lookbackHours = 24 } = options;
  console.log(`[scan:${account}] Scanning outgoing emails...`);
  const messages = await searchMessages(`from:me in:sent after:${lookbackDate(lookbackHours)}`, account);
  for (const msg of messages) {
    const id = msg.id || msg.messageId;
    if (!id || processed.seen(id)) continue;
    stats.scanned++;
    try {
      const full = await readMessage(id, account);
      const toEmail = extractEmail(full.to || full.To || '');
      const outSubject = full.subject || null;
      if (!toEmail || isExcludedSender(toEmail)) { processed.mark(id, 'excluded', { senderEmail: toEmail, subject: outSubject, account }); continue; }
      const person = await lookupByEmail(toEmail);
      if (!person) { stats.unknownSenders++; processed.mark(id, 'not_in_attio', { senderEmail: toEmail, subject: outSubject, account }); continue; }
      if (PROTECTED.has(person.currentStatus)) { processed.mark(id, 'protected_skip', { senderEmail: toEmail, senderName: person.name, subject: outSubject, attioRecordId: person.id, account }); continue; }

      stats.classified.outgoing++;
      if (!dryRun) {
        await updateStatus(person.id, 'Outreach sent');
        const sentDate = full.date || full.Date || new Date().toISOString();
        await setNextAction(person.id, addDays(sentDate, 14));
        await appendNote(person.id, `Outreach sent: ${outSubject || '(no subject)'}`, `Email sent on ${sentDate}. Subject: ${outSubject || '(no subject)'}`);
        stats.attioUpdates++;
      }
      processed.mark(id, 'outgoing_tracked', { senderEmail: toEmail, senderName: person.name, subject: outSubject, attioRecordId: person.id, attioUpdated: dryRun ? 0 : 1, account });
    } catch (e) { console.error(`[scan:${account}] outgoing error:`, e.message); }
  }
}

async function scanInbound(stats, options = {}, account = 'gmail') {
  const { dryRun = false, lookbackHours = 24 } = options;
  console.log(`[scan:${account}] Scanning inbound replies...`);
  const messages = await searchMessages(`after:${lookbackDate(lookbackHours)} -from:me -in:drafts -in:spam -in:trash`, account);
  for (const msg of messages) {
    const id = msg.id || msg.messageId;
    if (!id || processed.seen(id)) continue;
    stats.scanned++;
    try {
      const full = await readMessage(id, account);
      const fromRaw = full.from || full.From || '';
      const fromEmail = extractEmail(fromRaw);
      const fromName = extractName(fromRaw);
      const inSubject = full.subject || null;
      if (!fromEmail || isExcludedSender(fromEmail)) { processed.mark(id, 'excluded', { senderEmail: fromEmail, senderName: fromName, subject: inSubject, account }); continue; }
      const person = await lookupByEmail(fromEmail);
      if (!person) { stats.unknownSenders++; processed.mark(id, 'not_in_attio', { senderEmail: fromEmail, senderName: fromName, subject: inSubject, account }); continue; }

      const classified = await classifyReply(full.subject || '', full.body || full.snippet || '');
      const replyDate = full.date || full.Date || new Date().toISOString();
      stats.classified[classified.type] = (stats.classified[classified.type] || 0) + 1;
      let didAttioUpdate = false;

      if (!dryRun) {
        switch (classified.type) {
          case 'interested':
            if (!PROTECTED.has(person.currentStatus)) await updateStatus(person.id, 'Interested');
            await createTask(person.id, `Follow up with ${person.name}`, addDays(replyDate, 2));
            stats.attioUpdates++;
            didAttioUpdate = true;
            break;
          case 'request_info':
            if (!PROTECTED.has(person.currentStatus)) await updateStatus(person.id, 'Interested');
            await createTask(person.id, `Review and respond to ${person.name}`, replyDate.split('T')[0] || addDays(replyDate, 0));
            stats.attioUpdates++;
            didAttioUpdate = true;
            break;
          case 'not_now':
          case 'soft_no':
            if (!PROTECTED.has(person.currentStatus)) await updateStatus(person.id, 'On File');
            stats.attioUpdates++;
            didAttioUpdate = true;
            break;
          case 'hard_no':
            if (!PROTECTED.has(person.currentStatus)) await updateStatus(person.id, 'Closed');
            stats.attioUpdates++;
            didAttioUpdate = true;
            break;
          case 'meeting':
            if (!PROTECTED.has(person.currentStatus)) await updateStatus(person.id, 'Interested');
            await createTask(person.id, `Prepare for meeting with ${person.name}`, addDays(replyDate, 1));
            await appendNote(person.id, `Meeting proposed by ${person.name}`, classified.summary || '(no summary)');
            stats.attioUpdates++;
            didAttioUpdate = true;
            break;
          case 'referral':
            await appendNote(person.id, `Referral from ${person.name}`, classified.summary || '(no summary)');
            break;
          case 'unclear':
            await appendNote(person.id, `Unclear reply from ${person.name}`, classified.summary || '(no summary)');
            break;
          case 'ooo':
            await createTask(person.id, `Re-contact ${person.name} on return`, classified.ooo_return_date || addDays(replyDate, 21));
            stats.attioUpdates++;
            didAttioUpdate = true;
            break;
          default:
            break;
        }
        await appendNote(person.id, `Reply classified: ${classified.type}`, classified.summary || '(no summary)');
      }
      processed.mark(id, `inbound_${classified.type}`, {
        senderEmail: fromEmail, senderName: fromName || person.name, subject: inSubject,
        classificationType: classified.type, classificationSummary: classified.summary || null,
        attioRecordId: person.id, attioUpdated: didAttioUpdate ? 1 : 0,
        oooReturnDate: classified.ooo_return_date || null, account
      });
    } catch (e) { console.error(`[scan:${account}] inbound error:`, e.message); }
  }
}

async function scanBounces(stats, options = {}, account = 'gmail') {
  const { dryRun = false, lookbackHours = 24 } = options;
  console.log(`[scan:${account}] Scanning for bounces...`);
  const messages = await searchMessages(`(from:mailer-daemon@* OR from:postmaster@* OR subject:"delivery failed" OR subject:"undeliverable") after:${lookbackDate(lookbackHours)}`, account);
  for (const msg of messages) {
    const id = msg.id || msg.messageId;
    if (!id || processed.seen(id)) continue;
    stats.scanned++;
    try {
      const full = await readMessage(id, account);
      const subject = full.subject || '';
      const body = full.body || full.snippet || '';
      if (!isBounce(subject, body)) { processed.mark(id, 'bounce_false_positive', { subject, account }); continue; }
      const allEmails = (body.match(/[\w.+-]+@[\w.-]+\.\w{2,}/g) || [])
        .filter(e => !e.includes('mailer-daemon') && !e.includes('postmaster'));
      const recipientEmail = allEmails[0];
      if (!recipientEmail) { processed.mark(id, 'bounce_no_recipient', { subject, account }); continue; }
      const person = await lookupByEmail(recipientEmail);
      if (!person) { stats.unknownSenders++; processed.mark(id, 'bounce_not_in_attio', { senderEmail: recipientEmail, subject, account }); continue; }

      stats.classified.bounce = (stats.classified.bounce || 0) + 1;
      if (!dryRun) {
        await updateStatus(person.id, 'Bad email');
        await appendNote(person.id, 'Email bounce detected', `Hard bounce for ${recipientEmail}. Subject: ${subject}`);
        stats.attioUpdates++;
      }
      processed.mark(id, 'bounce_detected', { senderEmail: recipientEmail, senderName: person.name, subject, classificationType: 'bounce', attioRecordId: person.id, attioUpdated: dryRun ? 0 : 1, account });
    } catch (e) { console.error(`[scan:${account}] bounce error:`, e.message); }
  }
}

export async function runScan(options = {}) {
  const { lookbackHours = 24, dryRun = false } = options;
  const stats = { scanned: 0, classified: {}, attioUpdates: 0, unknownSenders: 0, dryRun, accounts: [...ACTIVE_ACCOUNTS] };
  const errors = [];

  console.log(`[scan] Starting scan — lookback: ${lookbackHours}h, dryRun: ${dryRun}, accounts: ${ACTIVE_ACCOUNTS.join(', ')}`);

  // Run all accounts in parallel, merge results into shared stats
  const accountScans = ACTIVE_ACCOUNTS.map(async (account) => {
    const accountErrors = [];

    try {
      await scanOutgoing(stats, options, account);
    } catch (e) { accountErrors.push(`${account}/outgoing: ${e.message}`); console.error(`[scan:${account}] outgoing fatal:`, e.message); }

    try {
      await scanInbound(stats, options, account);
    } catch (e) { accountErrors.push(`${account}/inbound: ${e.message}`); console.error(`[scan:${account}] inbound fatal:`, e.message); }

    try {
      await scanBounces(stats, options, account);
    } catch (e) { accountErrors.push(`${account}/bounces: ${e.message}`); console.error(`[scan:${account}] bounces fatal:`, e.message); }

    return accountErrors;
  });

  const allErrors = await Promise.all(accountScans);
  for (const errs of allErrors) errors.push(...errs);

  if (errors.length) stats.errors = errors;

  console.log(`[scan] Done — scanned: ${stats.scanned}, attioUpdates: ${stats.attioUpdates}, unknown: ${stats.unknownSenders}, dryRun: ${dryRun}`);
  return stats;
}

// Re-export individual scanners for backward compatibility with scan.js entry point
export { scanOutgoing, scanInbound, scanBounces };
