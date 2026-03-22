// Backfill: re-summarise records with raw/fenced JSON in summary column
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const Database = require('better-sqlite3');
const { summariseNewsletter } = require('../modules/summariser.js');

const DB_PATH = path.join(__dirname, '../data/newsletter-monitor.db');
const db = new Database(DB_PATH);

const rows = db.prepare(`
  SELECT id, sender_email, sender_name, subject, body, snippet, received_at
  FROM newsletters
  WHERE (summary LIKE '{%' OR summary LIKE '\`\`\`%')
    AND (one_line_takeaway IS NULL OR one_line_takeaway = '')
    AND body IS NOT NULL AND body != ''
`).all();

console.log(`Found ${rows.length} records to backfill`);

async function run() {
  let success = 0, failed = 0;
  for (const row of rows) {
    try {
      process.stdout.write(`  [${row.id}] ${(row.subject || '').substring(0, 50)}... `);
      const result = await summariseNewsletter({
        subject: row.subject,
        sender_name: row.sender_name,
        sender_email: row.sender_email,
        body: row.body,
        snippet: row.snippet,
        received_at: row.received_at
      });
      db.prepare(`
        UPDATE newsletters
        SET summary = ?, one_line_takeaway = ?,
            top_tags_json = ?, key_points_json = ?,
            best_sections_json = ?, actionable_followups_json = ?
        WHERE id = ?
      `).run(
        result.summary ?? '',
        result.one_line_takeaway ?? '',
        JSON.stringify(result.top_tags ?? []),
        JSON.stringify(result.key_points ?? []),
        JSON.stringify(result.best_sections ?? []),
        JSON.stringify(result.actionable_followups ?? []),
        row.id
      );
      console.log('OK');
      success++;
      await new Promise(r => setTimeout(r, 500)); // rate limit
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${success} success, ${failed} failed`);
  db.close();
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
