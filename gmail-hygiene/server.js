import 'dotenv/config';
import express from 'express';
import { scanInbox } from './modules/scanner.js';
import { attemptUnsubscribe, extractUnsubUrl } from './modules/unsubscriber.js';
import { callGmail, parseSearchResults } from './modules/gmail.js';
import { getDb } from './db.js';
import { logActivity } from '../shared/activityLogger.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3039;

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Gmail Hygiene</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#f9fafb;--surface:#fff;--border:#e5e7eb;--accent:#1d4ed8;--text:#111827;--dim:#6b7280;--green:#16a34a;--yellow:#ca8a04;--red:#dc2626}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.5;padding:24px}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid var(--border)}
.header h1{font-size:18px;font-weight:600}
.header p{font-size:12px;color:var(--dim);margin-top:2px}
.actions{display:flex;gap:8px}
.run-btn{background:var(--accent);color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px}
.run-btn:disabled{opacity:.5;cursor:not-allowed}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px}
.stat .label{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
.stat .value{font-size:22px;font-weight:700}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px}
.card h3{font-size:14px;font-weight:600;margin-bottom:12px}
.filters{display:flex;gap:8px;margin-bottom:12px}
.fsel{background:var(--surface);border:1px solid var(--border);color:var(--text);padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);color:var(--dim);font-weight:500}
td{padding:8px 10px;border-bottom:1px solid #f3f4f6}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.badge-active{background:rgba(34,197,94,.15);color:#22c55e}
.badge-blocked{background:rgba(239,68,68,.15);color:#ef4444}
.badge-unsubscribed{background:rgba(234,179,8,.15);color:#eab308}
.badge-kept{background:rgba(79,124,255,.15);color:#7da3ff}
.btn{padding:4px 10px;border-radius:5px;font-size:11px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--dim)}
.btn:hover{color:var(--text);border-color:var(--dim)}
.btn-unsub{border-color:rgba(234,179,8,.4);color:#eab308}.btn-unsub:hover{background:rgba(234,179,8,.1)}
.btn-block{border-color:rgba(239,68,68,.3);color:#ef4444}.btn-block:hover{background:rgba(239,68,68,.1)}
.btn-keep{border-color:rgba(34,197,94,.3);color:#22c55e}.btn-keep:hover{background:rgba(34,197,94,.1)}
.spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(0,0,0,.15);border-top-color:#1d4ed8;border-radius:50%;animation:sp .7s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.toast{position:fixed;bottom:24px;right:24px;background:#fff;border:1px solid var(--border);border-radius:8px;padding:12px 16px;font-size:13px;z-index:999;box-shadow:0 4px 16px rgba(0,0,0,.1);animation:ti .2s ease}
@keyframes ti{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
</style></head><body>
<div class="header"><div><h1>Gmail Hygiene</h1><p id="digest-info">Loading...</p></div>
<div class="actions">
<button class="run-btn" onclick="scan(7)">Scan 7 Days</button>
<button class="run-btn" onclick="scan(30)">Scan 30 Days</button>
</div></div>
<div class="stats" id="stats-row"></div>
<div class="card"><h3>Senders</h3>
<div class="filters"><select class="fsel" id="f-status" onchange="loadSenders()"><option value="">All statuses</option><option value="active">Active</option><option value="kept">Kept</option><option value="unsubscribed">Unsubscribed</option><option value="blocked">Blocked</option></select></div>
<table><thead><tr><th>Sender</th><th>Domain</th><th>Label</th><th>Freq/mo</th><th>Status</th><th>Last Seen</th><th>Actions</th></tr></thead><tbody id="senders-body"></tbody></table></div>
<div id="toasts"></div>
<script>
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function toast(msg){const e=document.createElement('div');e.className='toast';e.textContent=msg;document.getElementById('toasts').appendChild(e);setTimeout(()=>e.remove(),3000);}
async function loadDigest(){
  try{
    const d=await fetch('/api/digest').then(r=>r.json());
    document.getElementById('digest-info').textContent='Generated: '+new Date(d.generated).toLocaleString();
    const sr=document.getElementById('stats-row');
    sr.innerHTML=(d.senders||[]).map(s=>'<div class="stat"><div class="label">'+esc(s.status)+'</div><div class="value">'+s.count+'</div></div>').join('');
  }catch(e){console.error(e);}
}
async function loadSenders(){
  try{
    const status=document.getElementById('f-status').value;
    const q=status?'?status='+status:'';
    const senders=await fetch('/api/senders'+q).then(r=>r.json());
    document.getElementById('senders-body').innerHTML=senders.map(s=>'<tr><td>'+esc(s.display_name||s.email_address)+'</td><td>'+esc(s.domain)+'</td><td>'+esc(s.label_name||'--')+'</td><td>'+s.frequency_per_month+'</td><td><span class="badge badge-'+(s.status||'active')+'">'+esc(s.status||'active')+'</span></td><td>'+esc(s.last_seen?new Date(s.last_seen).toLocaleDateString():'--')+'</td><td><button class="btn btn-keep" onclick="act('+s.id+',\\'keep\\')">Keep</button> <button class="btn btn-unsub" onclick="act('+s.id+',\\'unsubscribe\\')">Unsub</button> <button class="btn btn-block" onclick="act('+s.id+',\\'block\\')">Block</button></td></tr>').join('')||'<tr><td colspan="7" style="color:var(--dim)">No senders found</td></tr>';
  }catch(e){console.error(e);}
}
async function scan(days){
  const btns=document.querySelectorAll('.run-btn');
  btns.forEach(b=>{b.disabled=true;});
  try{
    const r=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({daysBack:days})});
    const d=await r.json();
    toast('Scan complete: '+d.newSenders+' new, '+d.knownSenders+' known');
  }catch(e){toast('Error: '+e.message);}
  finally{btns.forEach(b=>{b.disabled=false;});loadDigest();loadSenders();}
}
async function act(id,action){
  try{
    const r=await fetch('/api/senders/'+id+'/'+action,{method:'POST',headers:{'Content-Type':'application/json'}});
    const d=await r.json();
    if(d.success)toast(action+' successful');
    else toast(action+' failed: '+(d.detail||d.error||''));
    loadSenders();loadDigest();
  }catch(e){toast('Error: '+e.message);}
}
loadDigest();loadSenders();
</script></body></html>`);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'gmail-hygiene-gmail-hygiene', port: PORT });
});

app.post('/api/scan', async (req, res) => {
  const { daysBack = 7, account } = req.body;
  // If a specific account is requested, scan just that one
  // Otherwise scan all active accounts
  // NOTE: 'gmail-growthworks' excluded until OAuth credentials.json is created
  const accounts = account ? [account] : ['gmail', 'gmail-aloma'];
  const allResults = [];
  const errors = [];

  for (const acct of accounts) {
    try {
      const result = await scanInbox(daysBack, acct);
      allResults.push(result);
      logActivity({ agent: 'gmail-hygiene', action: 'scan_complete', result: 'success',
        detail: `[${acct}] new=${result.newSenders}, known=${result.knownSenders}` });
    } catch (err) {
      errors.push({ account: acct, error: err.message });
      logActivity({ agent: 'gmail-hygiene', action: 'scan_complete', result: 'error', detail: `[${acct}] ${err.message}` });
    }
  }

  const combined = {
    success: errors.length === 0,
    accounts: allResults,
    newSenders: allResults.reduce((s, r) => s + r.newSenders, 0),
    knownSenders: allResults.reduce((s, r) => s + r.knownSenders, 0),
    ...(errors.length > 0 ? { errors } : {})
  };
  res.json(combined);
});

app.get('/api/senders', (req, res) => {
  const db = getDb();
  const { status, label } = req.query;
  let query = 'SELECT * FROM senders WHERE 1=1';
  const params = [];
  if (status) { query += ' AND status = ?'; params.push(status); }
  if (label) { query += ' AND label_name = ?'; params.push(label); }
  query += ' ORDER BY last_seen DESC LIMIT 200';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/senders/:id/unsubscribe', async (req, res) => {
  const db = getDb();
  const sender = db.prepare('SELECT * FROM senders WHERE id = ?').get(req.params.id);
  if (!sender) return res.status(404).json({ error: 'Sender not found' });
  try {
    let url = sender.unsub_url;
    if (!url) {
      // Search Gmail for most recent message from this sender to get message ID
      const searchRaw = await callGmail('search_emails', {
        query: `from:${sender.email_address}`,
        max_results: 1
      });
      const msgs = parseSearchResults(searchRaw);
      if (msgs.length > 0) {
        const unsubInfo = await extractUnsubUrl(msgs[0].id || msgs[0].messageId);
        url = unsubInfo?.url;
      }
    }
    if (!url) {
      return res.json({ success: false, result: 'no_url', detail: 'No unsubscribe URL found' });
    }
    const outcome = await attemptUnsubscribe(url);
    const now = new Date().toISOString();
    db.prepare('UPDATE senders SET unsub_url = ?, unsub_result = ?, updated_at = ? WHERE id = ?')
      .run(url, outcome.result, now, sender.id);
    if (outcome.result === 'success') {
      db.prepare("UPDATE senders SET status = 'unsubscribed', updated_at = ? WHERE id = ?")
        .run(now, sender.id);
    }
    db.prepare('INSERT INTO actions (sender_id, action_type, detail, result) VALUES (?, ?, ?, ?)')
      .run(sender.id, 'unsubscribe', outcome.detail, outcome.result);
    logActivity({ agent: 'gmail-hygiene', action: 'unsubscribe', company: sender.domain, result: outcome.result, detail: outcome.detail });
    res.json({ success: true, ...outcome });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/senders/:id/block', async (req, res) => {
  const db = getDb();
  const sender = db.prepare('SELECT * FROM senders WHERE id = ?').get(req.params.id);
  if (!sender) return res.status(404).json({ error: 'Sender not found' });
  try {
    await callGmail('modify_email', {
      query: `from:${sender.email_address}`,
      add_labels: ['SPAM'],
      remove_labels: ['INBOX']
    });
    const now = new Date().toISOString();
    db.prepare("UPDATE senders SET status = 'blocked', updated_at = ? WHERE id = ?")
      .run(now, sender.id);
    db.prepare('INSERT INTO actions (sender_id, action_type, detail, result) VALUES (?, ?, ?, ?)')
      .run(sender.id, 'block', `Marked SPAM: ${sender.email_address}`, 'success');
    logActivity({ agent: 'gmail-hygiene', action: 'block', company: sender.domain, result: 'success' });
    res.json({ success: true, detail: `${sender.email_address} marked as SPAM` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/senders/:id/keep', (req, res) => {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE senders SET status = 'kept', updated_at = ? WHERE id = ?")
    .run(now, req.params.id);
  res.json({ success: true });
});

app.post('/api/senders/:id/classify', (req, res) => {
  const db = getDb();
  const { label_name } = req.body;
  if (!label_name) return res.status(400).json({ error: 'label_name required' });
  const now = new Date().toISOString();
  db.prepare('UPDATE senders SET label_name = ?, updated_at = ? WHERE id = ?')
    .run(label_name, now, req.params.id);
  res.json({ success: true });
});

app.get('/api/digest', (req, res) => {
  const db = getDb();
  const senders = db.prepare("SELECT status, COUNT(*) as count FROM senders GROUP BY status").all();
  const actions = db.prepare("SELECT action_type, result, COUNT(*) as count FROM actions GROUP BY action_type, result").all();
  res.json({ senders, actions, generated: new Date().toISOString() });
});

process.on('SIGTERM', () => { process.exit(0); });
process.on('SIGINT', () => { process.exit(0); });

app.listen(PORT, () => console.log(`Gmail Hygiene running on port ${PORT}`));
