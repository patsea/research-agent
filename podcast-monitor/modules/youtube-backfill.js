/**
 * youtube-backfill.js — one-shot YouTube channel video enumeration via yt-dlp
 * Bypasses the 15-entry RSS feed limit by using --flat-playlist.
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

/**
 * Extract channel_id from a YouTube RSS feed URL.
 * Accepts: https://www.youtube.com/feeds/videos.xml?channel_id=XXXX
 * Returns: the channel_id string
 */
function extractChannelId(feedUrl) {
  const match = feedUrl.match(/channel_id=([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  throw new Error(`Cannot extract channel_id from feed URL: ${feedUrl}`);
}

/**
 * Fetch all video entries from a YouTube channel using yt-dlp --flat-playlist.
 * Returns array of { title, source_url, guid, published_at, description, thumbnail_url }
 */
async function fetchChannelVideos(feedUrl) {
  const channelId = extractChannelId(feedUrl);
  const channelUrl = `https://www.youtube.com/channel/${channelId}/videos`;
  const ytdlp = process.env.YTDLP_PATH || 'yt-dlp';

  const args = ['--flat-playlist', '--dump-json', '--no-warnings', channelUrl];
  console.log(`[youtube-backfill] Running: ${ytdlp} ${args.join(' ')}`);
  const startTime = Date.now();

  let raw;
  try {
    const { stdout } = await execFileAsync(ytdlp, args, {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024
    });
    raw = stdout;
  } catch (err) {
    throw new Error(`yt-dlp failed: ${err.message}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const lines = raw.trim().split('\n').filter(Boolean);
  console.log(`[youtube-backfill] yt-dlp returned ${lines.length} entries in ${elapsed}s`);

  const videos = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const videoId = entry.id || entry.url;
      if (!videoId) continue;

      videos.push({
        title: entry.title || 'Untitled',
        source_url: `https://www.youtube.com/watch?v=${videoId}`,
        guid: videoId,
        published_at: entry.upload_date
          ? `${entry.upload_date.slice(0, 4)}-${entry.upload_date.slice(4, 6)}-${entry.upload_date.slice(6, 8)}`
          : null,
        description: entry.description || null,
        thumbnail_url: entry.thumbnails && entry.thumbnails.length > 0
          ? entry.thumbnails[entry.thumbnails.length - 1].url
          : (entry.thumbnail || null)
      });
    } catch (_) {
      // Skip malformed lines
    }
  }

  console.log(`[youtube-backfill] Parsed ${videos.length} videos`);
  return videos;
}

/**
 * Fetch upload dates for specific video IDs using yt-dlp per-video metadata.
 * Processes in batches of 10 to avoid overwhelming yt-dlp.
 * Returns Map<videoId, ISODateString>
 */
async function fetchVideoDates(videoIds) {
  const ytdlp = process.env.YTDLP_PATH || 'yt-dlp';
  const results = new Map();
  const batchSize = 10;

  for (let i = 0; i < videoIds.length; i += batchSize) {
    const batch = videoIds.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(videoIds.length / batchSize);
    console.log(`[youtube-backfill] fetchVideoDates batch ${batchNum}/${totalBatches} (${batch.length} videos)`);

    for (const videoId of batch) {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      try {
        const { stdout } = await execFileAsync(ytdlp, [
          '--no-playlist', '--no-download', '--print', '%(id)s|||%(upload_date)s', url
        ], { timeout: 30000 });
        const raw = stdout.trim();

        const parts = raw.split('|||');
        if (parts.length >= 2 && parts[1] && parts[1] !== 'NA') {
          const d = parts[1]; // YYYYMMDD
          const isoDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
          results.set(parts[0], isoDate);
        }
      } catch (err) {
        console.warn(`[youtube-backfill] Failed to get date for ${videoId}: ${err.message}`);
      }
    }
  }

  console.log(`[youtube-backfill] fetchVideoDates: ${results.size}/${videoIds.length} dates resolved`);
  return results;
}

module.exports = { fetchChannelVideos, extractChannelId, fetchVideoDates };
