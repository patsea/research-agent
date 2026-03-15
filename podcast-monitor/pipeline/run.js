const { pollAllFeeds } = require('../modules/poller');
const { sendDailyDigest } = require('../modules/slack');
const { getDb } = require('../modules/db');

(async () => {
  console.log(`[pipeline] ${new Date().toISOString()} — Polling all feeds`);
  try {
    const newEpisodeIds = await pollAllFeeds();
    console.log(`[pipeline] Poll complete — ${newEpisodeIds.length} new episodes`);

    if (newEpisodeIds.length > 0) {
      const db = getDb();
      // Load episodes with feed toggle settings joined
      const episodes = newEpisodeIds.map(id =>
        db.prepare(`
          SELECT e.*, f.name as feed_name,
                 f.show_title, f.show_published, f.show_duration, f.show_description
          FROM episodes e
          JOIN feeds f ON e.feed_id = f.id
          WHERE e.id = ?
        `).get(id)
      ).filter(Boolean);

      const result = await sendDailyDigest(episodes);
      console.log(`[pipeline] Slack: ${JSON.stringify(result)}`);
    }

    process.exit(0);
  } catch (err) {
    console.error('[pipeline] Error:', err.message);
    process.exit(1);
  }
})();
