const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

let _db = null;

function getDb() {
  if (_db) return _db;

  _db = new Database(path.join(dataDir, 'podcast-monitor.db'));
  _db.pragma('journal_mode = WAL');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      last_polled TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id INTEGER,
      title TEXT NOT NULL,
      source_url TEXT NOT NULL UNIQUE,
      audio_url TEXT,
      published_at TEXT,
      duration TEXT,
      thumbnail TEXT,
      status TEXT DEFAULT 'new',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (feed_id) REFERENCES feeds(id)
    )
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL UNIQUE,
      transcript_path TEXT,
      summary_text TEXT,
      highlights_json TEXT,
      word_count INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (episode_id) REFERENCES episodes(id)
    )
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS interest_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Seed default tags if table is empty
  const count = _db.prepare('SELECT COUNT(*) as c FROM interest_tags').get().c;
  if (count === 0) {
    const defaults = [
      'PE/VC', 'product leadership', 'AI/LLMs', 'executive hiring',
      'portfolio operations', 'go-to-market', 'interim executive',
      'SaaS growth', 'organisational design', 'venture capital',
      'board dynamics', 'operator turned investor'
    ];
    const insert = _db.prepare('INSERT INTO interest_tags (text) VALUES (?)');
    for (const tag of defaults) {
      insert.run(tag);
    }
  }

  return _db;
}

module.exports = { getDb };
