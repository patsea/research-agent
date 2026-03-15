const Parser = require('rss-parser');
const { getDb } = require('./db');

const parser = new Parser({
  timeout: 30000,
  headers: { 'User-Agent': 'PodcastMonitor/1.0' }
});

async function pollFeed(feed) {
  const db = getDb();
  const insertedIds = [];

  try {
    const rss = await parser.parseURL(feed.url);

    const checkStmt = db.prepare('SELECT id FROM episodes WHERE source_url = ?');
    const insertStmt = db.prepare(`
      INSERT INTO episodes (feed_id, title, source_url, audio_url, published_at, thumbnail, status)
      VALUES (?, ?, ?, ?, ?, ?, 'new')
    `);

    // Backfill: if set, take only the most recent N episodes ignoring watermark
    // Otherwise apply watermark to only show episodes after feed was added
    let filteredItems;
    if (feed.backfill && feed.backfill > 0) {
      // Sort by date desc, take N most recent
      const sorted = [...rss.items].sort((a, b) => {
        return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
      });
      filteredItems = sorted.slice(0, feed.backfill);
      // Clear backfill after this poll so watermark applies going forward
      db.prepare('UPDATE feeds SET backfill = 0 WHERE id = ?').run(feed.id);
      console.log('[poller] Backfill mode:', filteredItems.length, 'episodes for feed', feed.name);
    } else {
      const watermark = feed.added_at ? new Date(feed.added_at) : new Date(0);
      filteredItems = rss.items.filter(item => {
        const pubDate = item.pubDate ? new Date(item.pubDate) : null;
        return pubDate && pubDate > watermark;
      });
    }

    for (const item of filteredItems) {
      const sourceUrl = item.link || item.guid;
      if (!sourceUrl) continue;

      const existing = checkStmt.get(sourceUrl);
      if (existing) continue;

      const audioUrl = item.enclosure?.url || null;
      const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : null;
      const thumbnail = item.itunes?.image || rss.image?.url || null;

      const result = insertStmt.run(feed.id, item.title || 'Untitled', sourceUrl, audioUrl, publishedAt, thumbnail);
      insertedIds.push(result.lastInsertRowid);
    }

    db.prepare('UPDATE feeds SET last_polled = datetime(\'now\') WHERE id = ?').run(feed.id);
  } catch (err) {
    console.error(`[poller] Error polling feed "${feed.name}":`, err.message);
  }

  return insertedIds;
}

async function pollAllFeeds() {
  const db = getDb();
  const feeds = db.prepare('SELECT * FROM feeds').all();
  const allIds = [];

  for (const feed of feeds) {
    const feedIds = await pollFeed(feed);
    allIds.push(...feedIds);
    console.log(`[poller] Feed "${feed.name}": ${feedIds.length} new episodes`);
  }

  return allIds;
}

module.exports = { pollFeed, pollAllFeeds };
