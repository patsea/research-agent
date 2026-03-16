'use strict';
/**
 * Shared Slack notification module for job-search-agent.
 * Uses the Slack incoming webhook from ~/.claude-auto.conf.
 * Native https — no dependencies. Fire-and-forget.
 *
 * Usage (CommonJS):
 *   const { notifySignal, notifyNewsletter, notifyNewSender, notifyEpisode, notifyAlert } = require('../shared/slack');
 *
 * Usage (ESM):
 *   import { notifySignal } from '../shared/slack.js';
 *
 * All functions return a promise but callers should NOT await in hot paths.
 * Call with .catch(() => {}) to swallow errors silently.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// --- Webhook URL loader ---

let _webhookUrl = null;

function getWebhookUrl() {
  if (_webhookUrl) return _webhookUrl;

  // 1. Check SLACK_WEBHOOK_URL env var
  if (process.env.SLACK_WEBHOOK_URL) {
    _webhookUrl = process.env.SLACK_WEBHOOK_URL;
    return _webhookUrl;
  }

  // 2. Fall back to ~/.claude-auto.conf
  try {
    const confPath = path.join(process.env.HOME, '.claude-auto.conf');
    if (fs.existsSync(confPath)) {
      const conf = fs.readFileSync(confPath, 'utf8');
      const match = conf.match(/CLAUDE_AUTO_SLACK_WEBHOOK="([^"]+)"/);
      if (match) {
        _webhookUrl = match[1];
        return _webhookUrl;
      }
    }
  } catch (_) {}

  return null;
}

// --- Low-level poster ---

function postToSlack(payload) {
  return new Promise((resolve, reject) => {
    const url = getWebhookUrl();
    if (!url) {
      console.log('[slack] No webhook URL configured — skipping notification');
      return resolve(false);
    }

    const parsed = new URL(url);
    const data = JSON.stringify(payload);

    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          console.error(`[slack] Webhook returned ${res.statusCode}: ${body}`);
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      console.error('[slack] Post error:', err.message);
      resolve(false); // resolve, don't reject — fire-and-forget
    });

    req.setTimeout(10000, () => {
      req.destroy();
      console.error('[slack] Post timeout');
      resolve(false);
    });

    req.write(data);
    req.end();
  });
}

// --- Notification helpers ---

/**
 * Signal Scanner — new signal detected
 */
function notifySignal(signal) {
  const { company_name, signal_type, sector, headline, source_name } = signal || {};
  return postToSlack({
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📡 Signal Scanner — New Signal` }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${company_name || 'Unknown'}* — ${signal_type || 'signal'}\n${headline || ''}`
        }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: [
            sector ? `Sector: ${sector}` : null,
            source_name ? `Source: ${source_name}` : null,
            `<http://localhost:3033|Open Signal Scanner>`
          ].filter(Boolean).join(' · ')
        }]
      }
    ]
  });
}

/**
 * Newsletter Monitor — new newsletter saved
 */
function notifyNewsletter(newsletter) {
  const { subject, sender_name, sender_email, account, summary } = newsletter || {};
  const from = sender_name ? `${sender_name} <${sender_email}>` : sender_email || 'Unknown';
  const snippet = summary ? (summary.length > 200 ? summary.slice(0, 200) + '...' : summary) : '';
  return postToSlack({
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📰 Newsletter Monitor` }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${subject || 'No subject'}*\nFrom: ${from}${account ? ` (${account})` : ''}`
        }
      },
      ...(snippet ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: snippet }
      }] : []),
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `<http://localhost:3041|Open Newsletter Monitor>` }]
      }
    ]
  });
}

/**
 * Gmail Hygiene — new sender discovered
 */
function notifyNewSender(sender) {
  const { email_address, display_name, domain, label_name, frequency_per_month } = sender || {};
  return postToSlack({
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📧 Gmail Hygiene — New Sender` }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${display_name || email_address || 'Unknown'}*\n${email_address || ''}`
        }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: [
            domain ? `Domain: ${domain}` : null,
            label_name ? `Label: ${label_name}` : null,
            frequency_per_month ? `~${frequency_per_month}/mo` : null,
            `<http://localhost:3039|Open Gmail Hygiene>`
          ].filter(Boolean).join(' · ')
        }]
      }
    ]
  });
}

/**
 * Podcast Monitor — new episode detected
 */
function notifyEpisode(episode) {
  const { title, feed_name, source_url, published_at, duration } = episode || {};
  const durStr = duration ? formatDuration(duration) : null;
  return postToSlack({
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🎙 Podcast Monitor — New Episode` }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${title || 'Untitled'}*\n_${feed_name || 'Unknown feed'}_`
        }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: [
            published_at ? `Published: ${new Date(published_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : null,
            durStr ? `Duration: ${durStr}` : null,
            source_url ? `<${source_url}|Open episode>` : null,
            `<http://localhost:3040|Open Podcast Monitor>`
          ].filter(Boolean).join(' · ')
        }]
      }
    ]
  });
}

/**
 * Generic alert — for errors, batch summaries, etc.
 */
function notifyAlert(agent, message, detail) {
  return postToSlack({
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `⚠️ ${agent || 'Job Search Agent'} — Alert` }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: message || 'No message' }
      },
      ...(detail ? [{
        type: 'context',
        elements: [{ type: 'mrkdwn', text: detail }]
      }] : [])
    ]
  });
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Daily digest notifications
async function sendPodcastDigest(items) {
  if (!items || items.length === 0) return;
  const top = items.slice(0, 3);
  const lines = top.map((ep, i) =>
    `${i+1}. *${(ep.title || 'Untitled').replace(/[<>|]/g, '')}* — ${ep.feed_name || ''} (score: ${ep.relevance_score ?? '?'})`
  );
  const text = `:studio_microphone: *Daily Podcast Digest* — top ${top.length} from past 24h\n` +
    lines.join('\n') + `\n<http://localhost:3040|View all episodes>`;
  await postToSlack({ text });
}

async function sendNewsletterDigest(items) {
  if (!items || items.length === 0) return;
  const top = items.slice(0, 3);
  const lines = top.map((nl, i) =>
    `${i+1}. *${(nl.subject || 'Untitled').replace(/[<>|]/g, '')}* — ${nl.sender_name || nl.sender_email || ''} (score: ${nl.relevance_score ?? '?'})`
  );
  const text = `:newspaper: *Daily Newsletter Digest* — top ${top.length} from past 24h\n` +
    lines.join('\n') + `\n<http://localhost:3041|View all newsletters>`;
  await postToSlack({ text });
}

module.exports = { notifySignal, notifyNewsletter, notifyNewSender, notifyEpisode, notifyAlert, postToSlack, sendPodcastDigest, sendNewsletterDigest };
