import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'data', 'agent5.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    contact_id TEXT,
    contact_name TEXT,
    contact_email TEXT,
    contact_title TEXT,
    company TEXT,
    subject TEXT,
    body TEXT,
    word_count INTEGER,
    campaign_type TEXT,
    template_name TEXT,
    research_context TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    approved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE,
    description TEXT,
    structure_prompt TEXT,
    word_count_target INTEGER DEFAULT 200,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS agent5_queue (
    draft_id TEXT PRIMARY KEY REFERENCES drafts(id),
    queued_at TEXT DEFAULT (datetime('now')),
    gmail_draft_id TEXT,
    saved_at TEXT
  );
`);

// Seed default template if none exists
const templateCount = db.prepare('SELECT COUNT(*) as c FROM templates').get();
if (templateCount.c === 0) {
  db.prepare(
    "INSERT INTO templates(id, name, description, structure_prompt, word_count_target) VALUES(?, ?, ?, ?, ?)"
  ).run(
    randomUUID(),
    'default',
    'Problem / Proof / Ask — under 200 words',
    'Opening: 1-2 sentences referencing a specific challenge or moment at the company. Proof points: 2-3 bullets, strongest proof point first. Ask: one sentence, low friction.',
    200
  );
}

export const drafts = {
  insert(draft) {
    db.prepare(
      "INSERT INTO drafts(id, contact_id, contact_name, contact_email, contact_title, company, subject, body, word_count, campaign_type, template_name, research_context, status) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(draft.id, draft.contactId || null, draft.contactName, draft.contactEmail, draft.contactTitle, draft.company, draft.subject, draft.body, draft.wordCount, draft.campaignType, draft.templateName, draft.researchContext || null, 'draft');
    return draft.id;
  },
  get(id) {
    return db.prepare('SELECT * FROM drafts WHERE id=?').get(id);
  },
  list(status) {
    if (status) return db.prepare('SELECT * FROM drafts WHERE status=? ORDER BY created_at DESC').all(status);
    return db.prepare('SELECT * FROM drafts ORDER BY created_at DESC').all();
  },
  update(id, fields) {
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      sets.push(`${k}=?`);
      vals.push(v);
    }
    vals.push(id);
    db.prepare(`UPDATE drafts SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  },
  updateStatus(id, status) {
    if (status === 'approved') {
      db.prepare("UPDATE drafts SET status=?, approved_at=datetime('now') WHERE id=?").run(status, id);
    } else {
      db.prepare('UPDATE drafts SET status=? WHERE id=?').run(status, id);
    }
  }
};

export const templates = {
  list() {
    return db.prepare('SELECT * FROM templates ORDER BY created_at').all();
  },
  get(name) {
    return db.prepare('SELECT * FROM templates WHERE name=?').get(name);
  },
  insert(t) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO templates(id, name, description, structure_prompt, word_count_target) VALUES(?, ?, ?, ?, ?)"
    ).run(id, t.name, t.description, t.structurePrompt, t.wordCountTarget || 200);
    return id;
  }
};

export const agent5Queue = {
  add(draftId, gmailDraftId) {
    db.prepare(
      "INSERT OR REPLACE INTO agent5_queue(draft_id, queued_at, gmail_draft_id, saved_at) VALUES(?, datetime('now'), ?, datetime('now'))"
    ).run(draftId, gmailDraftId || null);
  },
  list() {
    return db.prepare(
      'SELECT q.*, d.contact_name, d.contact_email, d.company, d.subject, d.status FROM agent5_queue q JOIN drafts d ON q.draft_id = d.id ORDER BY q.queued_at DESC'
    ).all();
  }
};
