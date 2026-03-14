import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, 'activity.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    agent TEXT NOT NULL,
    action TEXT NOT NULL,
    contact TEXT,
    company TEXT,
    result TEXT,
    detail TEXT
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity(agent)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(timestamp DESC)`);

const insertStmt = db.prepare(`
  INSERT INTO activity (agent, action, contact, company, result, detail)
  VALUES (@agent, @action, @contact, @company, @result, @detail)
`);

const queryStmt = db.prepare(`
  SELECT * FROM activity ORDER BY timestamp DESC LIMIT ?
`);

const queryByAgentStmt = db.prepare(`
  SELECT * FROM activity WHERE agent = ? ORDER BY timestamp DESC LIMIT ?
`);

const queryByContactStmt = db.prepare(`
  SELECT * FROM activity WHERE contact LIKE ? ORDER BY timestamp DESC LIMIT ?
`);

const queryByAgentAndContactStmt = db.prepare(`
  SELECT * FROM activity WHERE agent = ? AND contact LIKE ? ORDER BY timestamp DESC LIMIT ?
`);

export function logActivity({ agent, action, contact = null, company = null, result = null, detail = null }) {
  insertStmt.run({ agent, action, contact, company, result, detail });
}

export function getActivity({ limit = 50, agent = null, contact = null } = {}) {
  if (agent && contact) {
    return queryByAgentAndContactStmt.all(agent, `%${contact}%`, limit);
  }
  if (agent) {
    return queryByAgentStmt.all(agent, limit);
  }
  if (contact) {
    return queryByContactStmt.all(`%${contact}%`, limit);
  }
  return queryStmt.all(limit);
}
