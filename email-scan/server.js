import 'dotenv/config';
import express from 'express';
import { runLog, processed } from './db.js';
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
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Email Scan</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#f9fafb;--surface:#fff;--border:#e5e7eb;--accent:#1d4ed8;--text:#111827;--dim:#6b7280;--green:#16a34a;--yellow:#ca8a04;--red:#dc2626}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.5;padding:24px}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid var(--border)}
.header h1{font-size:18px;font-weight:600}
.header p{font-size:12px;color:var(--dim);margin-top:2px}
.run-btn{background:var(--accent);color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px}
.run-btn:disabled{opacity:.5;cursor:not-allowed}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px}
.stat .label{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
.stat .value{font-size:22px;font-weight:700}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px}
.card h3{font-size:14px;font-weight:600;margin-bottom:12px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);color:var(--dim);font-weight:500}
td{padding:8px 10px;border-bottom:1px solid #f3f4f6}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.badge-ok{background:rgba(34,197,94,.15);color:#22c55e}
.badge-warn{background:rgba(234,179,8,.15);color:#eab308}
.badge-err{background:rgba(239,68,68,.15);color:#ef4444}
.spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(0,0,0,.15);border-top-color:#1d4ed8;border-radius:50%;animation:sp .7s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.toast{position:fixed;bottom:24px;right:24px;background:#fff;border:1px solid var(--border);border-radius:8px;padding:12px 16px;font-size:13px;z-index:999;box-shadow:0 4px 16px rgba(0,0,0,.1);animation:ti .2s ease}
@keyframes ti{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
</style></head><body>
<div class="header"><div><h1>Email Scan</h1><p id="last-run">Loading...</p></div>
<button class="run-btn" id="run-btn" onclick="runScan()">Run Scan</button></div>
<div class="stats" id="stats-row">
  <div class="stat"><div class="label">Emails Scanned</div><div class="value" id="s-scanned">--</div></div>
  <div class="stat"><div class="label">Attio Updated</div><div class="value" id="s-updated">--</div></div>
  <div class="stat"><div class="label">Bounces</div><div class="value" id="s-bounces">--</div></div>
  <div class="stat"><div class="label">Last 7 Days</div><div class="value" id="s-week">--</div></div>
</div>
<div class="card"><h3>Action Breakdown</h3><table><thead><tr><th>Action</th><th>Count</th></tr></thead><tbody id="actions-body"></tbody></table></div>
<div class="card"><h3>Run Log</h3><table><thead><tr><th>Started</th><th>Completed</th><th>Scanned</th><th>Updated</th><th>Bounces</th><th>Flags</th></tr></thead><tbody id="log-body"></tbody></table></div>
<div id="toasts"></div>
<script>
async function loadStats(){
  try{
    const s=await fetch('/api/stats').then(r=>r.json());
    const lr=s.latestRun;
    if(lr){
      document.getElementById('s-scanned').textContent=lr.emails_scanned||0;
      document.getElementById('s-updated').textContent=lr.records_updated||0;
      document.getElementById('s-bounces').textContent=lr.bounces_detected||0;
      document.getElementById('last-run').textContent='Last run: '+(lr.completed_at||lr.started_at||'never');
    }
    document.getElementById('s-week').textContent=s.lastWeekCount||0;
    const ab=document.getElementById('actions-body');
    ab.innerHTML=(s.actionCounts||[]).map(a=>'<tr><td>'+esc(a.action)+'</td><td>'+a.count+'</td></tr>').join('');
  }catch(e){console.error(e);}
}
async function loadLog(){
  try{
    const logs=await fetch('/api/log').then(r=>r.json());
    document.getElementById('log-body').innerHTML=logs.map(r=>'<tr><td>'+esc(r.started_at)+'</td><td>'+(r.completed_at||'--')+'</td><td>'+r.emails_scanned+'</td><td>'+r.records_updated+'</td><td>'+r.bounces_detected+'</td><td>'+(r.flags||'--')+'</td></tr>').join('');
  }catch(e){console.error(e);}
}
async function runScan(){
  const btn=document.getElementById('run-btn');
  btn.disabled=true;btn.innerHTML='<span class="spin"></span> Scanning...';
  try{
    const r=await fetch('/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lookbackHours:24})});
    const d=await r.json();
    if(d.success)toast('Scan complete: '+d.summary.scanned+' emails scanned');
    else toast('Scan failed: '+(d.error||'unknown'));
  }catch(e){toast('Error: '+e.message);}
  finally{btn.disabled=false;btn.textContent='Run Scan';loadStats();loadLog();}
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function toast(msg){const e=document.createElement('div');e.className='toast';e.textContent=msg;document.getElementById('toasts').appendChild(e);setTimeout(()=>e.remove(),3000);}
loadStats();loadLog();
</script></body></html>`);
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
  const runId = runLog.start();
  let summary = null;
  try {
    summary = await runScan({ lookbackHours, dryRun });
    logActivity({ agent: 'email-scan', action: 'email_scan_completed', result: 'success', detail: `scanned=${summary.scanned}, attioUpdates=${summary.attioUpdates}, bounces=${summary.classified?.bounce || 0}` });
    res.json({ success: true, summary });
  } catch (err) {
    console.error('[server] scan error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    // Always mark the run as completed — even on error
    try {
      runLog.update(runId, {
        emails_scanned: summary?.scanned || 0,
        records_updated: summary?.attioUpdates || 0,
        notes_created: 0,
        tasks_created: 0,
        bounces_detected: summary?.classified?.bounce || 0,
        flags: dryRun ? 'dry_run' : '',
        errors: summary?.errors ? (Array.isArray(summary.errors) ? summary.errors.join('; ') : String(summary.errors)) : ''
      });
    } catch (e) { console.error('[server] failed to update run_log:', e.message); }
    scanInProgress = false;
  }
});

// Processed emails — filtered query
app.get('/api/results', (req, res) => {
  const { action, classification_type, attio_updated, since, limit } = req.query;
  const filters = {};
  if (action) filters.action = action;
  if (classification_type) filters.classification_type = classification_type;
  if (attio_updated !== undefined) filters.attio_updated = Number(attio_updated);
  if (since) filters.since = since;
  filters.limit = limit ? Number(limit) : 100;
  res.json(processed.query(filters));
});

// Stats summary
app.get('/api/stats', (req, res) => {
  res.json(processed.stats());
});

// Clean up MCP client on shutdown
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    console.log(`[server] ${sig} received, closing MCP clients...`);
    try { await closeClient(); } catch {}
    process.exit(0);
  });
}

app.listen(PORT, () => {
  console.log(`\n  Email Scan status at http://localhost:${PORT}`);
  console.log(`  Daily scan runs independently — check launchd or run manually:`);
  console.log(`  node scan.js\n`);
});
