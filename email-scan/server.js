import 'dotenv/config';
import express from 'express';
import { runLog } from './db.js';
import { runScan } from './modules/scan.js';
import { closeClient } from './modules/gmail.js';
import { logActivity } from '../shared/activityLogger.js';

// Email Scan — status server + manual scan trigger.
// The daily scan runs independently via: node scan.js
// Start this server to check scan status or trigger a scan manually.

const app = express();
const PORT = process.env.PORT || 3034;
let scanInProgress = false;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'email-scan', port: 3034 });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/api/status', (req, res) => res.json(runLog.latest() || { message: 'No runs yet' }));
app.get('/api/log', (req, res) => res.json(runLog.list(20)));

app.post('/scan', async (req, res) => {
  if (scanInProgress) {
    return res.status(429).json({ success: false, error: 'Scan already in progress' });
  }
  const { lookbackHours = 24, dryRun = false } = req.body || {};
  req.setTimeout(120000);
  scanInProgress = true;
  try {
    const runId = runLog.start();
    const summary = await runScan({ lookbackHours, dryRun });
    if (!dryRun) {
      runLog.update(runId, {
        emails_scanned: summary.scanned,
        records_updated: summary.attioUpdates,
        notes_created: 0,
        tasks_created: 0,
        bounces_detected: summary.classified.bounce || 0,
        flags: dryRun ? 'dry_run' : '',
        errors: (summary.errors || []).join('; ')
      });
    }
    logActivity({ agent: 'email-scan', action: 'email_scan_completed', result: 'success', detail: `scanned=${summary.scanned}, attioUpdates=${summary.attioUpdates}, bounces=${summary.classified?.bounce || 0}` });
    res.json({ success: true, summary });
  } catch (err) {
    console.error('[server] scan error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    scanInProgress = false;
  }
});

// Clean up MCP client on shutdown
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    console.log(`[server] ${sig} received, closing MCP client...`);
    try { await closeClient(); } catch {}
    process.exit(0);
  });
}

app.listen(PORT, () => {
  console.log(`\n  Email Scan status at http://localhost:${PORT}`);
  console.log(`  Daily scan runs independently — check launchd or run manually:`);
  console.log(`  node scan.js\n`);
});
