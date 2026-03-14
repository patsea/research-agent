#!/usr/bin/env node
// Standalone pipeline runner — invoke directly, does not require the server to be running.
// Usage: node pipeline/run.js
// Or with a specific source: node pipeline/run.js --source <source-id>
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runPipeline } = require('./trigger');

const args = process.argv.slice(2);
const srcIdx = args.indexOf('--source');
const sourceId = srcIdx !== -1 ? args[srcIdx + 1] : undefined;

console.log(`[run] Signal Scanner pipeline — ${new Date().toISOString()}`);
if (sourceId) console.log(`[run] Single source mode: ${sourceId}`);

runPipeline({ sourceId })
  .then(({ stats }) => {
    console.log(`[run] Done — written: ${stats.signals_written}, suppressed: ${stats.signals_suppressed}, errors: ${stats.errors || 'none'}`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[run] Fatal error:', err.message);
    process.exit(1);
  });
