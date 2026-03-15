import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'data', 'agent3.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS rubrics (
    id TEXT PRIMARY KEY,
    name TEXT,
    scoring_type TEXT,
    dimensions TEXT,
    thresholds TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    is_default INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS score_runs (
    id TEXT PRIMARY KEY,
    rubric_id TEXT,
    input_count INTEGER,
    completed_at TEXT,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS scores (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    name TEXT,
    scoring_type TEXT,
    raw_score REAL,
    connection_multiplier REAL DEFAULT 1.0,
    final_score REAL,
    overall_badge TEXT,
    confidence TEXT,
    recommended_action TEXT,
    dimensions TEXT,
    h_signal TEXT,
    h_signal_evidence TEXT,
    connection_degree TEXT,
    connection_name TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS agent4_queue (
    score_id TEXT PRIMARY KEY REFERENCES scores(id),
    company_name TEXT,
    campaign_type TEXT,
    score_context TEXT,
    forwarded_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed default rubrics if none exist
const rubricCount = db.prepare('SELECT COUNT(*) as c FROM rubrics').get();
if (rubricCount.c === 0) {
  db.prepare(
    "INSERT INTO rubrics(id, name, scoring_type, dimensions, thresholds, is_default) VALUES(?, ?, ?, ?, ?, ?)"
  ).run(
    randomUUID(),
    'ELNS+H Default',
    'company',
    JSON.stringify([
      { id: 'E', name: 'Early growth signal', weight: 0.20, prompt: 'Has this company recently raised funding, been acquired by PE, shown rapid headcount growth, or announced geographic expansion?' },
      { id: 'L', name: 'Leadership gap', weight: 0.25, prompt: 'Is the CPO or COO role vacant, recently departed, or held by a founder with no product background?' },
      { id: 'N', name: 'No product discipline', weight: 0.20, prompt: 'Is there evidence of an engineering-led product culture, absence of a product function, or customer complaints about product direction?' },
      { id: 'S', name: 'Scale pressure', weight: 0.20, prompt: 'Is there investor timeline pressure, churn risk, or competitive threat requiring a product transformation?' },
      { id: 'H', name: 'Hiring history signal', weight: 0.15, prompt: 'Manual input from Cowork LinkedIn check — has this company attempted and failed to fill a senior product role in the last 12 months?' }
    ]),
    JSON.stringify({ hot: 0.65, warm: 0.40 }),
    1
  );

  db.prepare(
    "INSERT INTO rubrics(id, name, scoring_type, dimensions, thresholds, is_default) VALUES(?, ?, ?, ?, ?, ?)"
  ).run(
    randomUUID(),
    'Exec Search Firm Default',
    'firm',
    JSON.stringify([
      { id: 'T', name: 'Tech specialisation', weight: 0.40, prompt: 'Does this firm specialise in technology leadership placement? Look for: named tech practice, CPO/CTO/VP Product placements, tech-focused website, team bios with engineering or product backgrounds.' },
      { id: 'M', name: 'Market fit', weight: 0.25, prompt: 'Is this firm active in markets relevant to the candidate\'s target geographies?' },
      { id: 'N', name: 'Network signal', weight: 0.20, prompt: 'Manual input — is this firm known to the candidate, is there a warm connection, or has there been prior positive contact?' },
      { id: 'A', name: 'Activity recency', weight: 0.15, prompt: 'Has this firm placed a CPO, CTO, or VP Product role, or announced a relevant mandate, in the last 12 months?' }
    ]),
    JSON.stringify({ tier1: 0.65, tier2: 0.40 }),
    1
  );
}

export const rubrics = {
  list() { return db.prepare('SELECT * FROM rubrics ORDER BY created_at').all().map(r => ({ ...r, dimensions: JSON.parse(r.dimensions), thresholds: JSON.parse(r.thresholds) })); },
  get(id) { const r = db.prepare('SELECT * FROM rubrics WHERE id=?').get(id); return r ? { ...r, dimensions: JSON.parse(r.dimensions), thresholds: JSON.parse(r.thresholds) } : null; },
  getDefault(scoringType) { const r = db.prepare('SELECT * FROM rubrics WHERE scoring_type=? AND is_default=1').get(scoringType); return r ? { ...r, dimensions: JSON.parse(r.dimensions), thresholds: JSON.parse(r.thresholds) } : null; },
  insert(rubric) {
    const id = randomUUID();
    db.prepare("INSERT INTO rubrics(id, name, scoring_type, dimensions, thresholds, is_default) VALUES(?, ?, ?, ?, ?, ?)").run(id, rubric.name, rubric.scoringType, JSON.stringify(rubric.dimensions), JSON.stringify(rubric.thresholds), rubric.isDefault ? 1 : 0);
    return id;
  },
  update(id, fields) {
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'dimensions' || k === 'thresholds') { sets.push(`${k}=?`); vals.push(JSON.stringify(v)); }
      else { sets.push(`${k}=?`); vals.push(v); }
    }
    vals.push(id);
    db.prepare(`UPDATE rubrics SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  }
};

export const scores = {
  insert(score) {
    db.prepare(
      "INSERT INTO scores(id, run_id, name, scoring_type, raw_score, connection_multiplier, final_score, overall_badge, confidence, recommended_action, dimensions, h_signal, h_signal_evidence, connection_degree, connection_name, status, notes) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(score.id, score.runId || null, score.name, score.scoringType, score.rawScore, score.connectionMultiplier, score.finalScore, score.overallBadge, score.confidence, score.recommendedAction, JSON.stringify(score.dimensions), score.hSignal || null, score.hSignalEvidence || null, score.connectionDegree || null, score.connectionName || null, 'pending', score.notes || null);
    return score.id;
  },
  get(id) { const r = db.prepare('SELECT * FROM scores WHERE id=?').get(id); return r ? { ...r, dimensions: JSON.parse(r.dimensions) } : null; },
  list(filters = {}) {
    let q = 'SELECT * FROM scores WHERE 1=1';
    const params = [];
    if (filters.status) { q += ' AND status=?'; params.push(filters.status); }
    if (filters.scoringType) { q += ' AND scoring_type=?'; params.push(filters.scoringType); }
    q += ' ORDER BY final_score DESC';
    return db.prepare(q).all(...params).map(r => ({ ...r, dimensions: JSON.parse(r.dimensions) }));
  },
  update(id, fields) {
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'dimensions') { sets.push('dimensions=?'); vals.push(JSON.stringify(v)); }
      else { sets.push(`${k}=?`); vals.push(v); }
    }
    vals.push(id);
    db.prepare(`UPDATE scores SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  },
  updateStatus(id, status) { db.prepare('UPDATE scores SET status=? WHERE id=?').run(status, id); }
};

export const agent4Queue = {
  add(scoreId, companyName, campaignType, scoreContext) {
    db.prepare("INSERT OR REPLACE INTO agent4_queue(score_id, company_name, campaign_type, score_context, forwarded_at) VALUES(?, ?, ?, ?, datetime('now'))").run(scoreId, companyName, campaignType, scoreContext || '');
  },
  list() { return db.prepare('SELECT * FROM agent4_queue ORDER BY forwarded_at DESC').all(); }
};
