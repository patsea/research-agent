import { searchMessages, readMessage } from './gmail.js';
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

async function scanOutgoing(stats, options = {}) {
  const { dryRun = false, lookbackHours = 24 } = options;
  console.log('[scan] Scanning outgoing emails...');
  const messages = await searchMessages(`from:me in:sent after:${lookbackDate(lookbackHours)}`);
  for (const msg of messages) {
    const id = msg.id || msg.messageId;
    if (!id || processed.seen(id)) continue;
    stats.scanned++;
    try {
      const full = await readMessage(id);
      const toEmail = extractEmail(full.to || full.To || '');
      if (!toEmail || isExcludedSender(toEmail)) { processed.mark(id, 'excluded'); continue; }
      const person = await lookupByEmail(toEmail);
      if (!person) { stats.unknownSenders++; processed.mark(id, 'not_in_attio'); continue; }
      if (PROTECTED.has(person.currentStatus)) { processed.mark(id, 'protected_skip'); continue; }

      stats.classified.outgoing++;
      if (!dryRun) {
        await updateStatus(person.id, 'Outreach sent');
        const sentDate = full.date || full.Date || new Date().toISOString();
        await setNextAction(person.id, addDays(sentDate, 14));
        await appendNote(person.id, `Outreach sent: ${full.subject || '(no subject)'}`, `Email sent on ${sentDate}. Subject: ${full.subject || '(no subject)'}`);
        stats.attioUpdates++;
      }
      processed.mark(id, 'outgoing_tracked');
    } catch (e) { console.error('[scan] outgoing error:', e.message); }
  }
}

async function scanInbound(stats, options = {}) {
  const { dryRun = false, lookbackHours = 24 } = options;
  console.log('[scan] Scanning inbound replies...');
  const messages = await searchMessages(`after:${lookbackDate(lookbackHours)} -from:me -in:drafts -in:spam -in:trash`);
  for (const msg of messages) {
    const id = msg.id || msg.messageId;
    if (!id || processed.seen(id)) continue;
    stats.scanned++;
    try {
      const full = await readMessage(id);
      const fromEmail = extractEmail(full.from || full.From || '');
      if (!fromEmail || isExcludedSender(fromEmail)) { processed.mark(id, 'excluded'); continue; }
      const person = await lookupByEmail(fromEmail);
      if (!person) { stats.unknownSenders++; processed.mark(id, 'not_in_attio'); continue; }

      const classified = await classifyReply(full.subject || '', full.body || full.snippet || '');
      const replyDate = full.date || full.Date || new Date().toISOString();
      stats.classified[classified.type] = (stats.classified[classified.type] || 0) + 1;

      if (!dryRun) {
        switch (classified.type) {
          case 'interested':
            if (!PROTECTED.has(person.currentStatus)) await updateStatus(person.id, 'Interested');
            await createTask(person.id, `Follow up with ${person.name}`, addDays(replyDate, 2));
            stats.attioUpdates++;
            break;
          case 'request_info':
            if (!PROTECTED.has(person.currentStatus)) await updateStatus(person.id, 'Interested');
            await createTask(person.id, `Review and respond to ${person.name}`, replyDate.split('T')[0] || addDays(replyDate, 0));
            stats.attioUpdates++;
            break;
          case 'not_right_timing':
          case 'soft_no':
            if (!PROTECTED.has(person.currentStatus)) await updateStatus(person.id, 'On File');
            stats.attioUpdates++;
            break;
          case 'hard_no':
            if (!PROTECTED.has(person.currentStatus)) await updateStatus(person.id, 'Closed');
            stats.attioUpdates++;
            break;
          case 'ooo':
            await createTask(person.id, `Re-contact ${person.name} on return`, classified.ooo_return_date || addDays(replyDate, 21));
            stats.attioUpdates++;
            break;
          default:
            break;
        }
        await appendNote(person.id, `Reply classified: ${classified.type}`, classified.summary || '(no summary)');
      }
      processed.mark(id, `inbound_${classified.type}`);
    } catch (e) { console.error('[scan] inbound error:', e.message); }
  }
}

async function scanBounces(stats, options = {}) {
  const { dryRun = false, lookbackHours = 24 } = options;
  console.log('[scan] Scanning for bounces...');
  const messages = await searchMessages(`(from:mailer-daemon@* OR from:postmaster@* OR subject:"delivery failed" OR subject:"undeliverable") after:${lookbackDate(lookbackHours)}`);
  for (const msg of messages) {
    const id = msg.id || msg.messageId;
    if (!id || processed.seen(id)) continue;
    stats.scanned++;
    try {
      const full = await readMessage(id);
      const subject = full.subject || '';
      const body = full.body || full.snippet || '';
      if (!isBounce(subject, body)) { processed.mark(id, 'bounce_false_positive'); continue; }
      const allEmails = (body.match(/[\w.+-]+@[\w.-]+\.\w{2,}/g) || [])
        .filter(e => !e.includes('mailer-daemon') && !e.includes('postmaster'));
      const recipientEmail = allEmails[0];
      if (!recipientEmail) { processed.mark(id, 'bounce_no_recipient'); continue; }
      const person = await lookupByEmail(recipientEmail);
      if (!person) { stats.unknownSenders++; processed.mark(id, 'bounce_not_in_attio'); continue; }

      stats.classified.bounce = (stats.classified.bounce || 0) + 1;
      if (!dryRun) {
        await updateStatus(person.id, 'Bad email');
        await appendNote(person.id, 'Email bounce detected', `Hard bounce for ${recipientEmail}. Subject: ${subject}`);
        stats.attioUpdates++;
      }
      processed.mark(id, 'bounce_detected');
    } catch (e) { console.error('[scan] bounce error:', e.message); }
  }
}

export async function runScan(options = {}) {
  const { lookbackHours = 24, dryRun = false } = options;
  const stats = { scanned: 0, classified: {}, attioUpdates: 0, unknownSenders: 0, dryRun };
  const errors = [];

  console.log(`[scan] Starting scan — lookback: ${lookbackHours}h, dryRun: ${dryRun}`);

  try {
    await scanOutgoing(stats, options);
  } catch (e) { errors.push(`outgoing: ${e.message}`); console.error('[scan] outgoing fatal:', e.message); }

  try {
    await scanInbound(stats, options);
  } catch (e) { errors.push(`inbound: ${e.message}`); console.error('[scan] inbound fatal:', e.message); }

  try {
    await scanBounces(stats, options);
  } catch (e) { errors.push(`bounces: ${e.message}`); console.error('[scan] bounces fatal:', e.message); }

  // Don't close MCP client here — let server.js keep the singleton alive.
  // Standalone scan.js calls closeClient() explicitly before process.exit().

  if (errors.length) stats.errors = errors;

  console.log(`[scan] Done — scanned: ${stats.scanned}, attioUpdates: ${stats.attioUpdates}, unknown: ${stats.unknownSenders}, dryRun: ${dryRun}`);
  return stats;
}

// Re-export individual scanners for backward compatibility with scan.js entry point
export { scanOutgoing, scanInbound, scanBounces };
