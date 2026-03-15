const fs = require('fs');
const path = require('path');
const axios = require('axios');

function getWebhookUrl() {
  const confPath = path.join(process.env.HOME, '.claude-auto.conf');
  if (!fs.existsSync(confPath)) return null;
  const conf = fs.readFileSync(confPath, 'utf8');
  const match = conf.match(/CLAUDE_AUTO_SLACK_WEBHOOK="([^"]+)"/);
  return match ? match[1] : null;
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short'
    });
  } catch { return dateStr; }
}

function truncate(str, len) {
  if (!str) return null;
  return str.length > len ? str.slice(0, len) + '…' : str;
}

async function sendDailyDigest(newEpisodes) {
  if (!newEpisodes || newEpisodes.length === 0) {
    console.log('[slack] No new episodes — skipping digest');
    return { sent: false, reason: 'no episodes' };
  }

  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    console.log('[slack] No webhook URL found in ~/.claude-auto.conf');
    return { sent: false, reason: 'no webhook' };
  }

  const date = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🎙 Podcast Monitor — ${date}` }
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `*${newEpisodes.length} new episode${newEpisodes.length > 1 ? 's' : ''}*` }]
    },
    { type: 'divider' }
  ];

  for (const ep of newEpisodes) {
    const fields = [];

    // Title always shown as main text
    const titleText = `*${ep.title || 'Untitled'}*\n_${ep.feed_name || 'Unknown feed'}_`;

    if (ep.show_published && ep.published_at) {
      fields.push({ type: 'mrkdwn', text: `📅 ${formatDate(ep.published_at)}` });
    }
    if (ep.show_duration && ep.duration) {
      const dur = formatDuration(ep.duration);
      if (dur) fields.push({ type: 'mrkdwn', text: `⏱ ${dur}` });
    }

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: titleText },
      ...(fields.length > 0 ? { fields } : {})
    });

    if (ep.show_description && ep.description) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: truncate(ep.description, 280) }
      });
    }

    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `<${ep.source_url}|Open episode> · Dismiss or Summarise at <http://localhost:3040|localhost:3040>` }]
    });

    blocks.push({ type: 'divider' });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `<http://localhost:3040|Open Podcast Monitor>` }]
  });

  try {
    await axios.post(webhookUrl, { blocks });
    console.log(`[slack] Digest sent — ${newEpisodes.length} episodes`);
    return { sent: true, episodeCount: newEpisodes.length };
  } catch (err) {
    console.error('[slack] Failed to send:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendDailyDigest };
