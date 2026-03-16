try { require('dotenv').config(); } catch (_) {}
const express = require('express');
const path = require('path');
const { getDb } = require('./modules/db');
const { pollFeed, pollAllFeeds } = require('./modules/poller');
const { transcribe, fetchMetadata } = require('./modules/transcriber');
const { resolveChannelId } = require('./modules/youtube');
const { summarise } = require('./modules/summariser');
const { fetchChannelVideos, fetchVideoDates } = require('./modules/youtube-backfill');

const app = express();
const PORT = 3040;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Activity logger (ESM — dynamic import, fire-and-forget)
let logActivity = null;
(async () => {
  try {
    const mod = await import('../shared/activityLogger.js');
    logActivity = mod.logActivity;
  } catch (_) {
    console.log('[server] shared activityLogger not available — activity logging disabled');
  }
})();

function logAct(action, detail) {
  if (logActivity) {
    try { logActivity({ agent: 'podcast-monitor', action, detail }); } catch (_) {}
  }
}

// --- Health ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'podcast-monitor', port: PORT });
});

// --- Feeds ---
app.get('/api/feeds', (req, res) => {
  const feeds = getDb().prepare('SELECT * FROM feeds ORDER BY created_at DESC').all();
  res.json(feeds);
});

app.post('/api/feeds', async (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    new URL(url);
  } catch (_) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const result = getDb().prepare("INSERT INTO feeds (name, url, added_at, backfill) VALUES (?, ?, datetime('now'), ?)").run(name || url, url, req.body.backfill || 0);
    const feed = getDb().prepare('SELECT * FROM feeds WHERE id = ?').get(result.lastInsertRowid);

    // Poll immediately
    const ids = await pollFeed(feed);
    logAct('feed_added', `${feed.name}: ${ids.length} episodes`);
    res.json({ feed, episodesAdded: ids.length });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Feed URL already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/feeds/:id', (req, res) => {
  getDb().prepare('DELETE FROM feeds WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// --- Episodes ---
app.get('/api/episodes', (req, res) => {
  const { status, limit = 100 } = req.query;
  let sql = 'SELECT e.*, f.name as feed_name FROM episodes e LEFT JOIN feeds f ON e.feed_id = f.id';
  const params = [];

  if (status) {
    sql += ' WHERE e.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY e.created_at DESC LIMIT ?';
  params.push(Number(limit));

  const episodes = getDb().prepare(sql).all(...params);
  res.json(episodes);
});

app.post('/api/episodes/url', async (req, res) => {
  const { url, title } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  // Fetch metadata via yt-dlp (async)
  const meta = await fetchMetadata(url);

  try {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO episodes (feed_id, title, source_url, audio_url, published_at, duration, thumbnail, status)
      VALUES (NULL, ?, ?, NULL, ?, ?, ?, 'new')
    `).run(
      (meta && meta.title) || title || url,
      url,
      (meta && meta.published_at) || null,
      (meta && meta.duration)     || null,
      (meta && meta.thumbnail)    || null
    );
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(result.lastInsertRowid);
    logAct('url_added', url);
    res.json(episode);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'URL already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/episodes/:id/dismiss', (req, res) => {
  const db = getDb();
  // Archive the summary instead of deleting it
  db.prepare('UPDATE summaries SET archived = 1 WHERE episode_id = ?').run(req.params.id);
  // Delete transcript file if it exists
  const ep = db.prepare('SELECT transcript_path FROM episodes WHERE id = ?').get(req.params.id);
  if (ep && ep.transcript_path && require('fs').existsSync(ep.transcript_path)) {
    require('fs').unlinkSync(ep.transcript_path);
    console.log('[dismiss] Deleted transcript:', ep.transcript_path);
  }
  db.prepare('UPDATE episodes SET status = \'dismissed\' WHERE id = ?').run(req.params.id);
  res.json({ dismissed: true, archived: true });
});

// POST /api/episodes/:id/fetch-metadata — pre-fetch YouTube thumbnail + channel name
app.post('/api/episodes/:id/fetch-metadata', async (req, res) => {
  const db = getDb();
  const ep = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Episode not found' });

  // Check if this is a YouTube episode (source_url contains youtube.com or youtu.be)
  const isYouTube = ep.source_url && (ep.source_url.includes('youtube.com') || ep.source_url.includes('youtu.be'));
  if (!isYouTube) {
    return res.json({ skipped: true, reason: 'Not a YouTube episode' });
  }

  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const ytdlp = process.env.YTDLP_PATH || 'yt-dlp';
    const { stdout: raw } = await execFileAsync(ytdlp, ['--dump-json', '--no-download', ep.source_url], { timeout: 30000 });
    const meta = JSON.parse(raw);
    const thumbnail = (meta.thumbnails && meta.thumbnails.length > 0)
      ? meta.thumbnails[meta.thumbnails.length - 1].url
      : meta.thumbnail || null;
    const channel_name = meta.uploader || meta.channel || meta.uploader_id || null;
    db.prepare('UPDATE episodes SET thumbnail = ?, channel_name = ? WHERE id = ?')
      .run(thumbnail, channel_name, ep.id);
    logAct('metadata-fetched', `Fetched metadata for: ${ep.title}`);
    res.json({ ok: true, thumbnail, channel_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/episodes/:id/summarise', (req, res) => {
  const id = Number(req.params.id);
  const episode = getDb().prepare('SELECT * FROM episodes WHERE id = ?').get(id);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });

  getDb().prepare('UPDATE episodes SET status = \'processing\' WHERE id = ?').run(id);
  res.status(202).json({ status: 'processing', episodeId: id });

  // Run transcription + summarisation async
  (async () => {
    try {
      console.log(`[server] Starting transcription for episode ${id}: ${episode.title}`);
      await transcribe(id);
      console.log(`[server] Transcription complete, starting summarisation for episode ${id}`);
      await summarise(id);
      console.log(`[server] Summarisation complete for episode ${id}`);
    } catch (err) {
      console.error(`[server] Pipeline error for episode ${id}:`, err.message);
      getDb().prepare('UPDATE episodes SET status = \'new\' WHERE id = ?').run(id);
    }
  })();
});

// --- Summaries ---
function parseSummary(s) {
  if (!s) return s;
  if (Array.isArray(s)) return s.map(item => ({
    ...item,
    topic_tags: item.topic_tags ? JSON.parse(item.topic_tags) : []
  }));
  return { ...s, topic_tags: s.topic_tags ? JSON.parse(s.topic_tags) : [] };
}

app.get('/api/summaries', (req, res) => {
  const summaries = getDb().prepare(`
    SELECT s.*, e.title, e.source_url, e.thumbnail, e.published_at, e.channel_name,
           f.name as feed_name
    FROM summaries s
    JOIN episodes e ON s.episode_id = e.id
    LEFT JOIN feeds f ON e.feed_id = f.id
    WHERE s.summary_text IS NOT NULL AND (s.archived IS NULL OR s.archived = 0)
    ORDER BY s.created_at DESC
  `).all();
  res.json(parseSummary(summaries));
});

app.get('/api/summaries/:id', (req, res) => {
  const summary = getDb().prepare(`
    SELECT s.*, e.title, e.source_url, e.thumbnail, e.published_at, e.audio_url, e.channel_name,
           f.name as feed_name
    FROM summaries s
    JOIN episodes e ON s.episode_id = e.id
    LEFT JOIN feeds f ON e.feed_id = f.id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!summary) return res.status(404).json({ error: 'Summary not found' });
  res.json(parseSummary(summary));
});

// POST /api/summaries/:id/section — on-demand deep summary for a specific topic tag
app.post('/api/summaries/:id/section', async (req, res) => {
  const { topic_index } = req.body;
  if (topic_index === undefined) return res.status(400).json({ error: 'topic_index required' });

  const db = getDb();
  const summary = db.prepare('SELECT * FROM summaries WHERE id = ?').get(req.params.id);
  if (!summary) return res.status(404).json({ error: 'Summary not found' });

  let topicTags;
  try { topicTags = JSON.parse(summary.topic_tags || '[]'); } catch { topicTags = []; }

  const tag = topicTags[topic_index];
  if (!tag) return res.status(404).json({ error: 'Tag index out of range' });

  if (!summary.transcript_path || !require('fs').existsSync(summary.transcript_path)) {
    return res.status(404).json({ error: 'Transcript file not found on disk' });
  }

  try {
    const whisperData = JSON.parse(require('fs').readFileSync(summary.transcript_path, 'utf8'));

    const toSecs = (ts) => {
      const parts = ts.split(':').map(Number);
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    };
    const startSecs = toSecs(tag.timestamp_start);
    const endSecs = toSecs(tag.timestamp_end);

    // Extract relevant segments (with 30s buffer either side)
    const segments = (whisperData.segments || []).filter(seg =>
      seg.start >= (startSecs - 30) && seg.end <= (endSecs + 30)
    );

    if (segments.length === 0) {
      return res.status(404).json({ error: 'No transcript segments found for this timestamp range' });
    }

    const chunkText = segments.map(seg => seg.text.trim()).join(' ');

    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    const fetchMod = (await import('node-fetch')).default;
    const response = await fetchMod('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: 'You are summarising a specific section of a podcast for a senior executive. Be precise, factual, and specific. Capture the key arguments, data points, and conclusions from this section.',
        messages: [{
          role: 'user',
          content: `Topic: ${tag.topic}\nTimestamp range: ${tag.timestamp_start} – ${tag.timestamp_end}\n\nTranscript section:\n${chunkText}\n\nWrite a detailed 2-3 paragraph summary of this specific section. Include specific claims, numbers, names, and arguments made. Do not pad or generalise.`
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'Claude API error', detail: err });
    }

    const data = await response.json();
    const deepSummary = data.content[0].text.trim();

    res.json({
      topic: tag.topic,
      timestamp_start: tag.timestamp_start,
      timestamp_end: tag.timestamp_end,
      teaser: tag.teaser,
      deep_summary: deepSummary
    });

  } catch (err) {
    console.error('[section-summary] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Tags ---
app.get('/api/tags', (req, res) => {
  const tags = getDb().prepare('SELECT * FROM interest_tags ORDER BY created_at').all();
  res.json(tags);
});

app.post('/api/tags', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    const result = getDb().prepare('INSERT INTO interest_tags (text) VALUES (?)').run(text.trim());
    const tag = getDb().prepare('SELECT * FROM interest_tags WHERE id = ?').get(result.lastInsertRowid);
    res.json(tag);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Tag already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tags/:id', (req, res) => {
  getDb().prepare('DELETE FROM interest_tags WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// --- Poll all feeds ---
app.post('/api/feeds/poll', async (req, res) => {
  const ids = await pollAllFeeds();
  logAct('poll_all', `${ids.length} new episodes`);
  res.json({ newEpisodes: ids.length });
});

// PATCH /api/feeds/:id/meta — update metadata display toggles
app.patch('/api/feeds/:id/meta', (req, res) => {
  const { show_title, show_published, show_duration, show_description } = req.body;
  const db = getDb();
  db.prepare(`
    UPDATE feeds SET
      show_title = COALESCE(?, show_title),
      show_published = COALESCE(?, show_published),
      show_duration = COALESCE(?, show_duration),
      show_description = COALESCE(?, show_description)
    WHERE id = ?
  `).run(
    show_title != null ? (show_title ? 1 : 0) : null,
    show_published != null ? (show_published ? 1 : 0) : null,
    show_duration != null ? (show_duration ? 1 : 0) : null,
    show_description != null ? (show_description ? 1 : 0) : null,
    req.params.id
  );
  const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(req.params.id);
  res.json(feed);
});

// GET /api/summaries/:id/suggested-tags — topic tags not yet in interest_tags
app.get('/api/summaries/:id/suggested-tags', (req, res) => {
  const db = getDb();
  const summary = db.prepare('SELECT topic_tags FROM summaries WHERE id = ?').get(req.params.id);
  if (!summary) return res.status(404).json({ error: 'Summary not found' });

  let topicTags;
  try { topicTags = JSON.parse(summary.topic_tags || '[]'); } catch { topicTags = []; }

  const existingTags = db.prepare('SELECT text FROM interest_tags').all().map(t => t.text.toLowerCase());

  const suggested = topicTags
    .map(t => t.topic)
    .filter(topic => topic && !existingTags.includes(topic.toLowerCase()));

  res.json({ suggested: [...new Set(suggested)] });
});

// POST /api/feeds/youtube — add a YouTube channel by handle, URL, or channel ID
// Also accepts { url } for a single YouTube video (auto-fetches metadata)
app.post('/api/feeds/youtube', async (req, res) => {
  const { input, name, backfill, url } = req.body;

  // Single video URL mode: insert as episode + auto-fetch metadata
  if (url && !input) {
    const isVideo = url.includes('youtube.com/watch') || url.includes('youtu.be/');
    if (!isVideo) return res.status(400).json({ error: 'url must be a YouTube video URL' });

    try {
      const db = getDb();
      // Check for duplicate
      const existing = db.prepare('SELECT id FROM episodes WHERE source_url = ?').get(url);
      if (existing) return res.status(409).json({ error: 'Video already exists', id: existing.id });

      const result = db.prepare(`
        INSERT INTO episodes (feed_id, title, source_url, audio_url, published_at, duration, thumbnail, status)
        VALUES (NULL, ?, ?, NULL, NULL, NULL, NULL, 'new')
      `).run(url, url);
      const episodeId = result.lastInsertRowid;
      logAct('youtube_video_added', url);
      res.json({ id: episodeId });

      // Auto-fetch metadata async (non-blocking) — single yt-dlp call for all fields
      setImmediate(async () => {
        try {
          const { execFile } = require('child_process');
          const { promisify } = require('util');
          const execFileAsync = promisify(execFile);
          const ytdlp = process.env.YTDLP_PATH || '/opt/homebrew/bin/yt-dlp';
          const { stdout } = await execFileAsync(ytdlp, ['--dump-json', '--no-playlist', url], { timeout: 30000 });
          const d = JSON.parse(stdout.trim());
          const title = d.title || null;
          const thumbnail = d.thumbnail || (d.thumbnails && d.thumbnails[0] && d.thumbnails[0].url) || null;
          const duration = d.duration || null;
          const published_at = d.upload_date ? d.upload_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : null;
          const channel_name = d.uploader || d.channel || d.uploader_id || null;
          db.prepare(`
            UPDATE episodes SET title = COALESCE(?, title),
              thumbnail = COALESCE(?, thumbnail),
              duration = COALESCE(?, duration),
              published_at = COALESCE(?, published_at),
              channel_name = COALESCE(?, channel_name)
            WHERE id = ?
          `).run(title, thumbnail, duration, published_at, channel_name, episodeId);
          console.log('[podcast-monitor] Auto-metadata fetched for episode', episodeId);
        } catch (err) {
          console.error('[podcast-monitor] Auto-metadata fetch failed:', err.message);
        }
      });
      return;
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Video already exists' });
      }
      return res.status(500).json({ error: err.message });
    }
  }

  if (!input) return res.status(400).json({ error: 'input required (handle, URL, or channel ID)' });

  try {
    const { channelId, channelName, rssUrl } = await resolveChannelId(input);
    const feedName = name || channelName || input;

    const db = getDb();
    // Check for duplicate
    const existing = db.prepare('SELECT id FROM feeds WHERE url = ?').get(rssUrl);
    if (existing) return res.status(409).json({ error: 'Channel already subscribed', feedId: existing.id });

    const result = db.prepare(
      "INSERT INTO feeds (name, url, added_at, backfill) VALUES (?, ?, datetime('now'), ?)"
    ).run(feedName, rssUrl, backfill || 0);

    const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(result.lastInsertRowid);

    // Poll immediately
    let newIds = [];
    try {
      newIds = await pollFeed(feed);
      console.log('[youtube] Polled', feed.name, '—', newIds.length, 'episodes');
    } catch (pollErr) {
      console.error('[youtube] Poll error:', pollErr.message);
    }

    // Auto-fetch metadata for newly added episodes (non-blocking)
    if (newIds.length > 0) {
      setImmediate(async () => {
        for (const epId of newIds) {
          try {
            const ep = db.prepare('SELECT source_url FROM episodes WHERE id = ?').get(epId);
            if (ep && ep.source_url && (ep.source_url.includes('youtube.com') || ep.source_url.includes('youtu.be'))) {
              const meta = await fetchMetadata(ep.source_url);
              if (meta) {
                db.prepare(`
                  UPDATE episodes SET title = COALESCE(?, title),
                    thumbnail = COALESCE(?, thumbnail),
                    duration = COALESCE(?, duration),
                    published_at = COALESCE(?, published_at)
                  WHERE id = ?
                `).run(meta.title, meta.thumbnail, meta.duration, meta.published_at, epId);
              }
            }
          } catch (err) {
            console.error('[podcast-monitor] Auto-metadata fetch failed for episode', epId, ':', err.message);
          }
        }
        console.log('[podcast-monitor] Auto-metadata fetched for', newIds.length, 'episodes');
      });
    }

    const updatedFeed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(result.lastInsertRowid);
    res.json({ feed: updatedFeed, channelId, rssUrl });

  } catch (err) {
    console.error('[youtube] Error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/feeds/:id/backfill-youtube — one-shot backfill all videos from YouTube channel
app.post('/api/feeds/:id/backfill-youtube', async (req, res) => {
  const db = getDb();
  const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(req.params.id);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });

  if (!feed.url || !feed.url.includes('youtube.com/feeds/videos.xml')) {
    return res.status(400).json({ error: 'Not a YouTube RSS feed' });
  }

  try {
    const videos = await fetchChannelVideos(feed.url);

    // Optional limit: only insert the N most recent videos (yt-dlp returns most-recent-first)
    const limit = req.body.limit ? parseInt(req.body.limit, 10) : null;
    const videosToInsert = (limit && limit > 0) ? videos.slice(0, limit) : videos;

    const insert = db.prepare(`
      INSERT OR IGNORE INTO episodes (feed_id, title, source_url, published_at, description, thumbnail, status)
      VALUES (?, ?, ?, ?, ?, ?, 'new')
    `);

    let inserted = 0;
    for (const v of videosToInsert) {
      const result = insert.run(feed.id, v.title, v.source_url, v.published_at, v.description, v.thumbnail_url);
      if (result.changes > 0) inserted++;
    }

    const skipped = videosToInsert.length - inserted;
    console.log(`[youtube-backfill] Feed ${feed.id} (${feed.name}): found=${videos.length}, limit=${limit || 'none'}, inserted=${inserted}, skipped=${skipped}`);
    logAct('youtube_backfill', `${feed.name}: ${inserted} new / ${skipped} existing (limit=${limit || 'none'})`);
    res.json({ ok: true, found: videos.length, limited_to: limit || videos.length, inserted, skipped });
  } catch (err) {
    console.error('[youtube-backfill] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/feeds/:id/backfill-dates — populate NULL published_at using yt-dlp per-video date
app.post('/api/feeds/:id/backfill-dates', async (req, res) => {
  const db = getDb();
  const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(req.params.id);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });

  // Find episodes with NULL published_at for this feed
  const episodes = db.prepare(
    'SELECT id, source_url FROM episodes WHERE feed_id = ? AND published_at IS NULL'
  ).all(feed.id);

  if (episodes.length === 0) {
    return res.json({ ok: true, found: 0, updated: 0, still_null: 0 });
  }

  // Extract video IDs from source_url (pattern: ?v=VIDEO_ID)
  const videoIdMap = new Map(); // videoId → episode id(s)
  const videoIds = [];
  for (const ep of episodes) {
    const match = ep.source_url && ep.source_url.match(/[?&]v=([A-Za-z0-9_-]+)/);
    if (match) {
      const vid = match[1];
      videoIds.push(vid);
      if (!videoIdMap.has(vid)) videoIdMap.set(vid, []);
      videoIdMap.get(vid).push(ep.id);
    }
  }

  // Fetch dates via yt-dlp
  const dateMap = await fetchVideoDates(videoIds);

  // Update episodes
  const update = db.prepare('UPDATE episodes SET published_at = ? WHERE id = ?');
  let updated = 0;
  for (const [videoId, isoDate] of dateMap) {
    const epIds = videoIdMap.get(videoId) || [];
    for (const epId of epIds) {
      update.run(isoDate, epId);
      updated++;
    }
  }

  const stillNull = db.prepare(
    'SELECT COUNT(*) as cnt FROM episodes WHERE feed_id = ? AND published_at IS NULL'
  ).get(feed.id).cnt;

  console.log(`[backfill-dates] Feed ${feed.id}: found=${episodes.length}, updated=${updated}, still_null=${stillNull}`);
  logAct('backfill_dates', `${feed.name}: ${updated}/${episodes.length} dates populated`);
  res.json({ ok: true, found: episodes.length, updated, still_null: stillNull });
});

// Daily podcast digest — past 24h, AI-ranked by relevance_score
app.get('/api/digest/podcast', async (req, res) => {
  try {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const db = getDb();
    // feed_name via JOIN feeds (not a column on episodes)
    const rows = db.prepare(`
      SELECT e.id, e.title, f.name AS feed_name, e.channel_name, e.description,
             e.relevance_score, e.created_at
      FROM episodes e LEFT JOIN feeds f ON e.feed_id = f.id
      WHERE e.created_at >= ? ORDER BY e.relevance_score DESC, e.created_at DESC LIMIT 20
    `).all(since);
    if (rows.length === 0) return res.json([]);

    const unscored = rows.filter(r => !r.relevance_score);
    if (unscored.length > 0 && ANTHROPIC_API_KEY) {
      const prompt = `Score each podcast episode 1-10 for relevance to a senior tech exec job search (AI, operations, growth, PE/VC). Return ONLY a JSON array, no markdown: [{"id": N, "score": N}]\nEpisodes:\n` +
        unscored.map(e => `ID:${e.id} "${e.title}" Feed:${e.feed_name||''} Desc:${(e.description||'').slice(0,150)}`).join('\n');
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
        });
        const data = await r.json();
        const text = (data?.content?.[0]?.text || '[]').replace(/```json|```/g, '').trim();
        const scores = JSON.parse(text);
        const stmt = db.prepare('UPDATE episodes SET relevance_score = ? WHERE id = ?');
        for (const { id, score } of scores) stmt.run(score, id);
      } catch (e) { console.error('[digest/podcast] scoring error:', e.message); }
    }
    const ranked = db.prepare(`
      SELECT e.id, e.title, f.name AS feed_name, e.channel_name, e.description,
             e.relevance_score, e.created_at
      FROM episodes e LEFT JOIN feeds f ON e.feed_id = f.id
      WHERE e.created_at >= ? ORDER BY e.relevance_score DESC, e.created_at DESC LIMIT 10
    `).all(since);
    res.json(ranked);
  } catch (err) {
    console.error('[digest/podcast]', err);
    res.status(500).json({ error: err.message });
  }
});

// Catch-all: serve index.html (MUST be after all API routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Podcast Monitor running at http://localhost:${PORT}`);
  console.log(`  Pipeline: POST /api/episodes/:id/summarise\n`);
});
