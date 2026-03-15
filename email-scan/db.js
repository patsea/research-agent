import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'data', 'agent6.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS run_log (
    id TEXT PRIMARY KEY,
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    emails_scanned INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    notes_created INTEGER DEFAULT 0,
    tasks_created INTEGER DEFAULT 0,
    bounces_detected INTEGER DEFAULT 0,
    flags TEXT DEFAULT '',
    errors TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS processed_emails (
    gmail_message_id TEXT PRIMARY KEY,
    processed_at TEXT DEFAULT (datetime('now')),
    action TEXT DEFAULT '',
    sender_email TEXT,
    sender_name TEXT,
    subject TEXT,
    classification_type TEXT,
    classification_summary TEXT,
    attio_record_id TEXT,
    attio_updated INTEGER DEFAULT 0,
    ooo_return_date TEXT
  );
`);

export const runLog = {
  start() {
    const id = randomUUID();
    db.prepare("INSERT INTO run_log(id, started_at) VALUES(?, datetime('now'))").run(id);
    return id;
  },
  update(id, stats) {
    db.prepare("UPDATE run_log SET completed_at=datetime('now'), emails_scanned=?, records_updated=?, notes_created=?, tasks_created=?, bounces_detected=?, flags=?, errors=? WHERE id=?")
      .run(stats.emails_scanned||0, stats.records_updated||0, stats.notes_created||0, stats.tasks_created||0, stats.bounces_detected||0, stats.flags||'', stats.errors||'', id);
  },
  latest() { return db.prepare('SELECT * FROM run_log ORDER BY started_at DESC LIMIT 1').get(); },
  list(n = 10) { return db.prepare('SELECT * FROM run_log ORDER BY started_at DESC LIMIT ?').all(n); }
};

export const processed = {
  seen(id) { return !!db.prepare('SELECT 1 FROM processed_emails WHERE gmail_message_id=?').get(id); },
  mark(id, action, extra = {}) {
    db.prepare(`INSERT OR IGNORE INTO processed_emails(
      gmail_message_id, processed_at, action,
      sender_email, sender_name, subject,
      classification_type, classification_summary,
      attio_record_id, attio_updated, ooo_return_date
    ) VALUES(?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id, action || '',
        extra.senderEmail || null, extra.senderName || null, extra.subject || null,
        extra.classificationType || null, extra.classificationSummary || null,
        extra.attioRecordId || null, extra.attioUpdated || 0, extra.oooReturnDate || null
      );
  },
  query(filters = {}) {
    let sql = 'SELECT * FROM processed_emails WHERE 1=1';
    const params = [];
    if (filters.action) { sql += ' AND action=?'; params.push(filters.action); }
    if (filters.classification_type) { sql += ' AND classification_type=?'; params.push(filters.classification_type); }
    if (filters.attio_updated !== undefined) { sql += ' AND attio_updated=?'; params.push(filters.attio_updated); }
    if (filters.since) { sql += ' AND processed_at >= ?'; params.push(filters.since); }
    sql += ' ORDER BY processed_at DESC';
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
    return db.prepare(sql).all(...params);
  },
  stats() {
    const latest = db.prepare('SELECT * FROM run_log ORDER BY started_at DESC LIMIT 1').get();
    const actionCounts = db.prepare('SELECT action, COUNT(*) as count FROM processed_emails GROUP BY action ORDER BY count DESC').all();
    const attioUpdated = db.prepare('SELECT COUNT(*) as count FROM processed_emails WHERE attio_updated=1').get();
    const lastWeek = db.prepare("SELECT COUNT(*) as count FROM processed_emails WHERE processed_at >= datetime('now', '-7 days')").get();
    return { latestRun: latest, actionCounts, attioUpdatedCount: attioUpdated.count, lastWeekCount: lastWeek.count };
  }
};
