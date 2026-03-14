import fetch from 'node-fetch';
import { callGmail } from './gmail.js';

export async function extractUnsubUrl(emailId) {
  const raw = await callGmail('read_email', { email_id: emailId });
  const headerMatch = raw.match(/List-Unsubscribe:\s*<([^>]+)>/i);
  if (!headerMatch) return null;
  const url = headerMatch[1];
  if (url.startsWith('mailto:')) return { url, method: 'mailto' };
  return { url, method: 'header' };
}

export async function attemptUnsubscribe(url) {
  if (!url || url.startsWith('mailto:')) {
    return { result: 'requires_mailto', detail: 'mailto: links cannot be automated' };
  }
  try {
    const res = await fetch(url, { method: 'GET', timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' } });
    const body = await res.text();
    if (!res.ok) return { result: 'failed', detail: `HTTP ${res.status}` };
    const lower = body.toLowerCase();
    if (/unsubscribed|removed|abgemeldet|baja|you.ve been removed/.test(lower)) {
      return { result: 'success', detail: 'Unsubscribe confirmed in response body' };
    }
    if (/confirm|click|button|verify/.test(lower)) {
      return { result: 'uncertain', detail: 'Confirmation page requires manual interaction' };
    }
    return { result: 'uncertain', detail: 'Response unclear — manual verification needed' };
  } catch (err) {
    return { result: 'failed', detail: err.message };
  }
}
