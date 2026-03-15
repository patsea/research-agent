const { execSync } = require('child_process');

const YTDLP = '/opt/homebrew/bin/yt-dlp';

/**
 * Resolve a YouTube channel URL, handle, or ID to a channel ID and RSS URL.
 * Accepts: @handle, youtube.com/@handle, youtube.com/channel/ID, or raw UCxxxx ID
 */
async function resolveChannelId(input) {
  input = input.trim();

  // Already a channel ID (starts with UC and ~24 chars)
  if (/^UC[A-Za-z0-9_-]{20,}$/.test(input)) {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${input}`;
    return { channelId: input, channelName: null, rssUrl };
  }

  // Normalise to a full URL
  let url = input;
  if (!url.startsWith('http')) {
    // Could be @handle or just a handle
    const handle = url.startsWith('@') ? url : `@${url}`;
    url = `https://www.youtube.com/${handle}`;
  }

  // Use yt-dlp to resolve channel metadata (fast, no download)
  try {
    const raw = execSync(
      `${YTDLP} --dump-single-json --flat-playlist --playlist-end 1 "${url}"`,
      { timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();

    const d = JSON.parse(raw);
    const channelId = d.channel_id || d.uploader_id || null;
    const channelName = d.channel || d.uploader || d.title || null;

    if (!channelId) throw new Error('Could not extract channel ID from yt-dlp response');

    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    return { channelId, channelName, rssUrl };

  } catch (err) {
    // Fallback: scrape the channel page for channelId
    const https = require('https');
    const pageHtml = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });

    const match = pageHtml.match(/"channelId":"(UC[A-Za-z0-9_-]{20,})"/);
    if (!match) throw new Error(`Could not resolve channel ID from: ${url}`);

    const channelId = match[1];
    const nameMatch = pageHtml.match(/"channelName":"([^"]+)"/);
    const channelName = nameMatch ? nameMatch[1] : null;
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    return { channelId, channelName, rssUrl };
  }
}

module.exports = { resolveChannelId };
