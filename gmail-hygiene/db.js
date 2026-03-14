import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'data', 'agent7.db');

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS senders (
      id INTEGER PRIMARY KEY,
      email_address TEXT NOT NULL UNIQUE,
      display_name TEXT,
      domain TEXT NOT NULL,
      label_id TEXT,
      label_name TEXT,
      frequency_per_month REAL,
      status TEXT DEFAULT 'active',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      unsub_url TEXT,
      unsub_method TEXT,
      unsub_result TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY,
      sender_id INTEGER REFERENCES senders(id),
      action_type TEXT NOT NULL,
      detail TEXT,
      result TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS filters (
      id INTEGER PRIMARY KEY,
      gmail_filter_id TEXT,
      label_id TEXT NOT NULL,
      label_name TEXT NOT NULL,
      criteria_json TEXT NOT NULL,
      agent_managed INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS digests (
      id INTEGER PRIMARY KEY,
      week_start TEXT NOT NULL,
      new_senders INTEGER,
      emails_classified INTEGER,
      unsub_attempted INTEGER,
      unsub_succeeded INTEGER,
      blocked INTEGER,
      digest_markdown TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}
