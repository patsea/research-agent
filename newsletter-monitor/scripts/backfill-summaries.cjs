'use strict';
// Backfill corrupted newsletter summaries.
// No LLM calls. Three strategies:
//   1. Fenced (```json): strip fences, JSON.parse → extract all fields
//   2. Truncated ({...): regex-extract summary + one_line_takeaway text, clear arrays
//   3. Unrecoverable: clear summary to '' so next pipeline run re-processes with fixed max_tokens

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/newsletter-monitor.db');
const db = new Database(DB_PATH);

const rows = db.prepare(`
  SELECT id, subject, summary FROM newsletters
  WHERE (summary LIKE '{%' OR summary LIKE '\`\`\`%')
    AND (one_line_takeaway IS NULL OR one_line_takeaway = '')
`).all();

console.log(`Affected records: ${rows.length}`);

const update = db.prepare(`
  UPDATE newsletters
  SET summary = ?, one_line_takeaway = ?,
      top_tags_json = ?, key_points_json = ?, best_sections_json = ?
  WHERE id = ?
`);

let recovered = 0, cleared = 0;

for (const row of rows) {
  let raw = (row.summary || '').replace(/^```json\s*/,'').replace(/```\s*$/,'').trim();

  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_) {}

  if (parsed && parsed.summary) {
    update.run(
      parsed.summary || '',
      parsed.one_line_takeaway || '',
      JSON.stringify(Array.isArray(parsed.top_tags) ? parsed.top_tags : []),
      JSON.stringify(Array.isArray(parsed.key_points) ? parsed.key_points : []),
      JSON.stringify(Array.isArray(parsed.best_sections) ? parsed.best_sections : []),
      row.id
    );
    console.log(`[${row.id}] recovered (full parse): ${row.subject || ''}`);
    recovered++;
  } else {
    // Partial parse via regex — summary field usually appears first
    const sm = raw.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const tm = raw.match(/"one_line_takeaway"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const s = sm ? sm[1].replace(/\\n/g,'\n').replace(/\\"/g,'"') : '';
    const t = tm ? tm[1].replace(/\\n/g,'\n').replace(/\\"/g,'"') : '';

    if (s) {
      update.run(s, t, '[]', '[]', '[]', row.id);
      console.log(`[${row.id}] recovered (regex): ${row.subject || ''}`);
      recovered++;
    } else {
      update.run('', '', '[]', '[]', '[]', row.id);
      console.log(`[${row.id}] cleared (unrecoverable): ${row.subject || ''}`);
      cleared++;
    }
  }
}

console.log(`\nDone: ${recovered} recovered, ${cleared} cleared for reingest`);
db.close();
