import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'data', 'agent2.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS research_runs (
    id TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now')),
    company_name TEXT,
    role_title TEXT,
    context_type TEXT DEFAULT 'interview_prep',
    interview_stage TEXT DEFAULT 'recruiter_screen',
    output_path TEXT,
    attio_note_written INTEGER DEFAULT 0,
    status TEXT DEFAULT 'complete'
  );
  CREATE TABLE IF NOT EXISTS ask_claude_history (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES research_runs(id),
    created_at TEXT DEFAULT (datetime('now')),
    question TEXT,
    answer TEXT
  );
`);

export const researchRuns = {
  insert(data) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO research_runs(id, company_name, role_title, context_type, interview_stage, output_path, status) VALUES(?, ?, ?, ?, ?, ?, ?)"
    ).run(id, data.company_name, data.role_title, data.context_type || 'interview_prep', data.interview_stage || 'recruiter_screen', data.output_path || '', data.status || 'complete');
    return id;
  },
  get(id) {
    return db.prepare('SELECT * FROM research_runs WHERE id=?').get(id);
  },
  list(n = 20) {
    return db.prepare('SELECT * FROM research_runs ORDER BY created_at DESC LIMIT ?').all(n);
  },
  updateOutputPath(id, path) {
    db.prepare('UPDATE research_runs SET output_path=? WHERE id=?').run(path, id);
  },
  markAttioWritten(id) {
    db.prepare('UPDATE research_runs SET attio_note_written=1 WHERE id=?').run(id);
  }
};

export const askHistory = {
  insert(runId, question, answer) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO ask_claude_history(id, run_id, question, answer) VALUES(?, ?, ?, ?)"
    ).run(id, runId, question, answer);
    return id;
  },
  listByRun(runId) {
    return db.prepare('SELECT * FROM ask_claude_history WHERE run_id=? ORDER BY created_at ASC').all(runId);
  }
};
