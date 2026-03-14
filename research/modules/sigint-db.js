import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/sigint.db');

let db;

export function getSigintDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        url TEXT NOT NULL UNIQUE,
        priority INTEGER DEFAULT 5,
        active INTEGER DEFAULT 1,
        last_fetched TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS content_items (
        id INTEGER PRIMARY KEY,
        source_id INTEGER REFERENCES sources(id),
        title TEXT NOT NULL,
        summary TEXT,
        url TEXT NOT NULL UNIQUE,
        published_at TEXT,
        fetched_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS briefings (
        id INTEGER PRIMARY KEY,
        title TEXT,
        week_start TEXT NOT NULL,
        week_end TEXT NOT NULL,
        content TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS briefing_sources (
        briefing_id INTEGER REFERENCES briefings(id),
        content_item_id INTEGER REFERENCES content_items(id),
        PRIMARY KEY (briefing_id, content_item_id)
      );
    `);
  }
  return db;
}
