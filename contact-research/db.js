import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'data', 'agent4.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    title TEXT,
    company TEXT,
    linkedin_url TEXT,
    email_verified TEXT,
    confidence TEXT,
    source TEXT,
    campaign_type TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS queued_for_agent5 (
    contact_id TEXT PRIMARY KEY REFERENCES contacts(id),
    queued_at TEXT DEFAULT (datetime('now')),
    campaign_type TEXT,
    company_context TEXT
  );
`);

export const contacts = {
  insert(card) {
    db.prepare(
      "INSERT INTO contacts(id, name, email, title, company, linkedin_url, email_verified, confidence, source, campaign_type, status, notes) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(card.id, card.name, card.email, card.title, card.company, card.linkedinUrl, card.emailStatus, card.confidence, card.source, card.campaignType, card.status || 'pending', card.context || '');
    return card.id;
  },
  get(id) {
    return db.prepare('SELECT * FROM contacts WHERE id=?').get(id);
  },
  list(status) {
    if (status) return db.prepare('SELECT * FROM contacts WHERE status=? ORDER BY created_at DESC').all(status);
    return db.prepare('SELECT * FROM contacts ORDER BY created_at DESC').all();
  },
  updateStatus(id, status) {
    db.prepare('UPDATE contacts SET status=? WHERE id=?').run(status, id);
  }
};

export const agent5Queue = {
  add(contactId, campaignType, companyContext) {
    db.prepare(
      "INSERT OR REPLACE INTO queued_for_agent5(contact_id, queued_at, campaign_type, company_context) VALUES(?, datetime('now'), ?, ?)"
    ).run(contactId, campaignType, companyContext || '');
  },
  list() {
    return db.prepare(
      'SELECT q.*, c.name, c.email, c.title, c.company, c.linkedin_url FROM queued_for_agent5 q JOIN contacts c ON q.contact_id = c.id ORDER BY q.queued_at DESC'
    ).all();
  }
};
