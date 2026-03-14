#!/usr/bin/env node
import 'dotenv/config';
import { runLog } from './db.js';
import { scanOutgoing, scanInbound, scanBounces } from './modules/scan.js';
import { closeClient } from './modules/gmail.js';
import { appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logPath = join(__dirname, 'logs', 'scan_log.csv');

console.log(`[scan] Agent 6 email scan — ${new Date().toISOString()}`);

const runId = runLog.start();
const stats = { emails_scanned: 0, records_updated: 0, notes_created: 0, tasks_created: 0, bounces_detected: 0, flags: '', errors: '' };
const errors = [];

try {
  await scanOutgoing(stats);
  await scanInbound(stats);
  await scanBounces(stats);
} catch (e) {
  errors.push(e.message);
  console.error('[scan] Fatal error:', e.message);
}

await closeClient();
stats.errors = errors.join('; ');
runLog.update(runId, stats);

const now = new Date().toISOString();
appendFileSync(logPath, `${now},${stats.emails_scanned},${stats.records_updated},${stats.notes_created},${stats.tasks_created},${stats.bounces_detected},${stats.errors || 'none'}\n`);

console.log(`[scan] Done — scanned: ${stats.emails_scanned}, updated: ${stats.records_updated}, notes: ${stats.notes_created}, tasks: ${stats.tasks_created}, bounces: ${stats.bounces_detected}, errors: ${stats.errors || 'none'}`);
process.exit(errors.length ? 1 : 0);
