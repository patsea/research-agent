import express from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { runAudit } from './modules/audit.js';
import { lookupByEmail, appendNote } from './modules/attio.js';
import { researchRuns } from './db.js';
import { logActivity } from '../shared/activityLogger.js';
import { fetchAllSources } from './modules/sigint-fetcher.js';
import { synthesizeBriefing } from './modules/sigint-synthesizer.js';
import { getSigintDb } from './modules/sigint-db.js';
import { buildSystemPrompt } from './modules/prompt-builder.js';

const __dirname_server = dirname(fileURLToPath(import.meta.url));
function getUserProfile() {
  return JSON.parse(readFileSync(join(__dirname_server, '..', 'config', 'user-profile.json'), 'utf8'));
}

const app = express();
const PORT = process.env.PORT || 3035;

app.use(express.json({ limit: '2mb' }));

// GET / — Trigger UI
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agent 2 — Interview Prep Research</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 2rem; max-width: 900px; margin: 0 auto; }
  h1 { color: #60a5fa; margin-bottom: 1.5rem; font-size: 1.5rem; }
  label { display: block; margin-top: 1rem; font-size: 0.85rem; color: #999; }
  input, textarea, select { width: 100%; padding: 0.6rem; margin-top: 0.3rem; background: #1a1a1a; border: 1px solid #333; color: #e0e0e0; border-radius: 4px; font-size: 0.95rem; }
  textarea { min-height: 80px; resize: vertical; }
  select { cursor: pointer; }
  button { margin-top: 1.5rem; padding: 0.7rem 2rem; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
  button:hover { background: #1d4ed8; }
  button:disabled { background: #333; cursor: not-allowed; }
  .tabs { display: flex; gap: 0; margin-bottom: 1.5rem; border-bottom: 2px solid #333; }
  .tab { padding: 0.7rem 1.5rem; cursor: pointer; color: #999; border-bottom: 2px solid transparent; margin-bottom: -2px; font-size: 0.95rem; }
  .tab:hover { color: #e0e0e0; }
  .tab.active { color: #60a5fa; border-bottom-color: #60a5fa; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  #loading { display: none; margin-top: 1rem; color: #60a5fa; }
  #loading.show { display: block; }
  #results { display: none; margin-top: 2rem; padding: 1.5rem; background: #111; border: 1px solid #333; border-radius: 6px; }
  #results.show { display: block; }
  #results h2 { color: #60a5fa; margin-bottom: 1rem; }
  #markdown-output { line-height: 1.6; }
  #markdown-output h1 { font-size: 1.4rem; color: #60a5fa; margin: 1.5rem 0 0.5rem; }
  #markdown-output h2 { font-size: 1.2rem; color: #93c5fd; margin: 1.2rem 0 0.5rem; }
  #markdown-output h3 { font-size: 1.05rem; color: #bfdbfe; margin: 1rem 0 0.4rem; }
  #markdown-output ul, #markdown-output ol { padding-left: 1.5rem; margin: 0.5rem 0; }
  #markdown-output li { margin: 0.3rem 0; }
  #markdown-output p { margin: 0.5rem 0; }
  #markdown-output table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  #markdown-output th, #markdown-output td { border: 1px solid #333; padding: 0.4rem 0.8rem; text-align: left; }
  #markdown-output th { background: #1a1a1a; }
  #markdown-output strong { color: #fbbf24; }
  #markdown-output blockquote { border-left: 3px solid #60a5fa; padding-left: 1rem; color: #999; margin: 0.5rem 0; }
  #attio-section { display: none; margin-top: 1.5rem; padding: 1rem; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; }
  #attio-section.show { display: block; }
  #attio-section label { color: #999; }
  .meta { font-size: 0.8rem; color: #666; margin-top: 0.5rem; }
</style>
<style id="light-mode-universal">
  :root { color-scheme: light !important; }
  body { background: #f5f5f5 !important; color: #333 !important; padding: 2rem !important; }
  h1 { color: #1a1a2e !important; }
  label { color: #555 !important; }
  input, textarea, select { background: #fff !important; border: 1px solid #ddd !important; color: #333 !important; }
  input:focus, textarea:focus, select:focus { border-color: #4a90d9 !important; outline: none !important; }
  button { background: #4a90d9 !important; color: #fff !important; }
  button:hover { background: #357abd !important; }
  button:disabled { background: #ccc !important; color: #999 !important; }
  .tabs { border-bottom: 2px solid #e0e0e0 !important; }
  .tab { color: #777 !important; }
  .tab:hover { color: #333 !important; }
  .tab.active { color: #4a90d9 !important; border-bottom-color: #4a90d9 !important; }
  #loading { color: #4a90d9 !important; }
  #results { background: #fff !important; border: 1px solid #e0e0e0 !important; box-shadow: 0 1px 3px rgba(0,0,0,0.08) !important; }
  #results h2 { color: #1a1a2e !important; }
  #markdown-output h1 { color: #1a1a2e !important; }
  #markdown-output h2 { color: #333 !important; }
  #markdown-output h3 { color: #444 !important; }
  #markdown-output p, #markdown-output li { color: #555 !important; }
  #markdown-output th, #markdown-output td { border-color: #e0e0e0 !important; color: #333 !important; }
  #markdown-output th { background: #f8f8fa !important; }
  #markdown-output strong { color: #b45309 !important; }
  #markdown-output blockquote { border-left-color: #4a90d9 !important; color: #777 !important; }
  #attio-section { background: #fff !important; border: 1px solid #e0e0e0 !important; }
  #attio-section label { color: #555 !important; }
  .meta { color: #999 !important; }
</style>
</head>
<body>
<h1>Agent 2 — Research Hub</h1>

<div class="tabs">
  <div class="tab active" onclick="switchTab('interview')">Company/Role</div>
  <div class="tab" onclick="switchTab('firm')">PE/VC Firm</div>
  <div class="tab" onclick="switchTab('portfolio')">Portfolio Scan</div>
  <div class="tab" onclick="switchTab('company')">Company Assessment</div>
</div>

<!-- Company/Role Research Tab -->
<div id="tab-interview" class="tab-panel active">
  <label>Company Name *
    <input type="text" id="companyName" required placeholder="e.g. Factorial HR">
  </label>
  <label>Role Title *
    <input type="text" id="roleTitle" required placeholder="e.g. Chief Product Officer">
  </label>
  <label>Recruiter Name (optional)
    <input type="text" id="recruiterName" placeholder="e.g. Sarah Johnson">
  </label>
  <label>Interview Stage
    <select id="stage">
      <option value="recruiter_screen" selected>Recruiter Screen</option>
      <option value="hiring_manager">Hiring Manager</option>
      <option value="final_round">Final Round</option>
    </select>
  </label>
  <label>Notes (optional)
    <textarea id="interviewNotes" placeholder="Any extra context, JD text, etc..."></textarea>
  </label>
  <label>Explicit Questions (optional)
    <textarea id="interviewQuestions" placeholder="Questions you want answered..."></textarea>
  </label>
  <button onclick="generatePrompt('interview')">Generate Perplexity Prompt</button>
  <div id="prompt-interview" style="display:none; margin-top:1rem;">
    <label>Generated Prompt (copy to Perplexity)
      <textarea id="promptText-interview" rows="10" readonly style="font-size:0.85rem;"></textarea>
    </label>
    <div style="display:flex; gap:8px; margin-top:0.5rem;">
      <button onclick="copyPrompt('interview')" style="background:#333;">Copy Prompt</button>
      <a href="https://www.perplexity.ai" target="_blank" rel="noopener"
         style="display:inline-block; padding:7px 14px; font-size:13px;
                border:0.5px solid var(--color-border-secondary,#ccc);
                border-radius:8px; text-decoration:none; color:inherit; margin-top:0;">
        Open Perplexity &#x2197;
      </a>
    </div>
    <label style="margin-top:1rem;">Paste Perplexity Output Here
      <textarea id="pasteArea-interview" rows="8" placeholder="Paste the full Perplexity response here..."></textarea>
    </label>
    <button onclick="runAuditFromTab('interview')">Run Audit (Stage 2)</button>
  </div>
</div>

<!-- PE/VC Firm Research Tab -->
<div id="tab-firm" class="tab-panel">
  <label>Firm Name *
    <input type="text" id="firmName" required placeholder="e.g. Verdane">
  </label>
  <label>Firm Type *
    <select id="firmType">
      <option value="PE/VC" selected>PE/VC</option>
      <option value="Exec Search">Exec Search</option>
      <option value="Interim">Interim</option>
    </select>
  </label>
  <label>Contact Name (optional)
    <input type="text" id="firmContactName" placeholder="e.g. Tim Wiklund">
  </label>
  <label>Context (optional)
    <textarea id="firmNotes" placeholder="Any extra context..."></textarea>
  </label>
  <label>Explicit Questions (optional)
    <textarea id="firmQuestions" placeholder="Questions you want answered..."></textarea>
  </label>
  <button onclick="generatePrompt('firm')">Generate Perplexity Prompt</button>
  <div id="prompt-firm" style="display:none; margin-top:1rem;">
    <label>Generated Prompt (copy to Perplexity)
      <textarea id="promptText-firm" rows="10" readonly style="font-size:0.85rem;"></textarea>
    </label>
    <div style="display:flex; gap:8px; margin-top:0.5rem;">
      <button onclick="copyPrompt('firm')" style="background:#333;">Copy Prompt</button>
      <a href="https://www.perplexity.ai" target="_blank" rel="noopener"
         style="display:inline-block; padding:7px 14px; font-size:13px;
                border:0.5px solid var(--color-border-secondary,#ccc);
                border-radius:8px; text-decoration:none; color:inherit; margin-top:0;">
        Open Perplexity &#x2197;
      </a>
    </div>
    <label style="margin-top:1rem;">Paste Perplexity Output Here
      <textarea id="pasteArea-firm" rows="8" placeholder="Paste the full Perplexity response here..."></textarea>
    </label>
    <button onclick="runAuditFromTab('firm')">Run Audit (Stage 2)</button>
  </div>
</div>

<!-- Portfolio Scan Tab -->
<div id="tab-portfolio" class="tab-panel">
  <label>Fund Name *
    <input type="text" id="fundName" required placeholder="e.g. Creandum">
  </label>
  <label>Contact Name at Fund (optional)
    <input type="text" id="portfolioContactName" placeholder="e.g. Dan Coventry">
  </label>
  <label>Context (optional)
    <textarea id="portfolioContext" placeholder="What was discussed, any companies mentioned..."></textarea>
  </label>
  <label>Top N companies to assess
    <input type="number" id="topN" value="5" min="1" max="20">
  </label>
  <label>Explicit Questions (optional)
    <textarea id="portfolioQuestions" placeholder="Questions you want answered..."></textarea>
  </label>
  <button onclick="generatePrompt('portfolio')">Generate Perplexity Prompt</button>
  <div id="prompt-portfolio" style="display:none; margin-top:1rem;">
    <label>Generated Prompt (copy to Perplexity)
      <textarea id="promptText-portfolio" rows="10" readonly style="font-size:0.85rem;"></textarea>
    </label>
    <div style="display:flex; gap:8px; margin-top:0.5rem;">
      <button onclick="copyPrompt('portfolio')" style="background:#333;">Copy Prompt</button>
      <a href="https://www.perplexity.ai" target="_blank" rel="noopener"
         style="display:inline-block; padding:7px 14px; font-size:13px;
                border:0.5px solid var(--color-border-secondary,#ccc);
                border-radius:8px; text-decoration:none; color:inherit; margin-top:0;">
        Open Perplexity &#x2197;
      </a>
    </div>
    <label style="margin-top:1rem;">Paste Perplexity Output Here
      <textarea id="pasteArea-portfolio" rows="8" placeholder="Paste the full Perplexity response here..."></textarea>
    </label>
    <button onclick="runAuditFromTab('portfolio')">Run Audit (Stage 2)</button>
  </div>
</div>

<!-- Company Assessment Tab (manual workflow) -->
<div id="tab-company" class="tab-panel">
  <div>
    <label>Company Name *
      <input type="text" id="ca-company" required placeholder="e.g. Ctaima">
    </label>
    <label>Website
      <input type="text" id="ca-website" placeholder="e.g. www.ctaima.com">
    </label>
    <label>Geography
      <input type="text" id="ca-geography" placeholder="e.g. Spain / DACH">
    </label>
    <label>Sector
      <input type="text" id="ca-sector" placeholder="e.g. SaaS / Compliance / PropTech">
    </label>
    <label>PE / Investor Names (optional)
      <input type="text" id="ca-pe-sponsors" placeholder="e.g. Hg Capital, Insight Partners">
    </label>
    <label>Job Post URL (optional)
      <input type="text" id="ca-job-url" placeholder="LinkedIn job post URL">
    </label>
    <label>Recruiter Notes (optional)
      <textarea id="ca-recruiter-notes" rows="3" placeholder="Any notes from the recruiter..."></textarea>
    </label>
    <label>Explicit Questions (optional)
      <textarea id="ca-questions" rows="3" placeholder="Questions you want answered..."></textarea>
    </label>
    <button onclick="generatePrompt('company')">Generate Perplexity Prompt</button>
    <div id="prompt-company" style="display:none; margin-top:1rem;">
      <label>Generated Prompt (copy to Perplexity)
        <textarea id="promptText-company" rows="10" readonly style="font-size:0.85rem;"></textarea>
      </label>
      <div style="display:flex; gap:8px; margin-top:0.5rem;">
        <button onclick="copyPrompt('company')" style="background:#333;">Copy Prompt</button>
        <a href="https://www.perplexity.ai" target="_blank" rel="noopener"
           style="display:inline-block; padding:7px 14px; font-size:13px;
                  border:0.5px solid var(--color-border-secondary,#ccc);
                  border-radius:8px; text-decoration:none; color:inherit; margin-top:0;">
          Open Perplexity &#x2197;
        </a>
      </div>
      <label style="margin-top:1rem;">Paste Perplexity Output Here
        <textarea id="pasteArea-company" rows="8" placeholder="Paste the full Perplexity response here..."></textarea>
      </label>
      <button onclick="runAuditFromTab('company')">Run Audit (Stage 2)</button>
    </div>
  </div>
</div>

<div id="loading">Running Claude audit... this takes 30-60 seconds.</div>

<div id="results">
  <h2>Research Output</h2>
  <div class="meta" id="resultsMeta"></div>
  <hr style="border-color:#333; margin: 1rem 0;">
  <div id="markdown-output"></div>
</div>

<div id="attio-section">
  <label>Email (to find person in Attio, optional)
    <input type="text" id="attioEmail" placeholder="recruiter@company.com">
  </label>
  <button id="attioBtn" onclick="writeToAttio()">Write to Attio</button>
  <div id="attioResult" class="meta"></div>
</div>

<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<script>
  window.__userProfile = ${JSON.stringify(getUserProfile())};
  let currentRunId = null;

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('.tab[onclick*="' + name + '"]').classList.add('active');
    document.getElementById('tab-' + name).classList.add('active');
  }

  function showResults(data) {
    currentRunId = data.runId || null;
    document.getElementById('resultsMeta').textContent = data.runId
      ? 'Run ID: ' + data.runId + ' | Output: ' + (data.outputPath || '')
      : 'Audit complete';
    document.getElementById('markdown-output').innerHTML = marked.parse(data.result || data.markdown || data.output || '');
    document.getElementById('results').classList.add('show');
    document.getElementById('attio-section').classList.add('show');
  }

  function startLoading() {
    document.getElementById('loading').classList.add('show');
    document.getElementById('results').classList.remove('show');
    document.getElementById('attio-section').classList.remove('show');
  }

  function stopLoading() {
    document.getElementById('loading').classList.remove('show');
  }

  function generatePrompt(tab) {
    let prompt = '';
    const today = new Date().toISOString().split('T')[0];
    if (tab === 'interview') {
      const company = document.getElementById('companyName').value;
      const role = document.getElementById('roleTitle').value;
      const recruiter = document.getElementById('recruiterName').value;
      const stage = document.getElementById('stage').value;
      const notes = document.getElementById('interviewNotes').value;
      const questions = document.getElementById('interviewQuestions').value;
      prompt = 'Research "' + company + '" for a ' + role + ' interview. Today is ' + today + '.\\n\\n';
      prompt += 'Context: ' + window.__userProfile.positioning + '\\n\\n';
      prompt += 'Interview stage: ' + stage + (recruiter ? '. Recruiter: ' + recruiter : '') + '\\n\\n';
      if (notes) prompt += 'Notes: ' + notes + '\\n\\n';
      prompt += 'Provide:\\n1. Company overview (funding, revenue, headcount, product, competitors)\\n2. Leadership team backgrounds and likely interview dynamics\\n3. Recent news and strategic direction\\n4. Why they might need this role now\\n5. Key risks and red flags\\n6. Conversation angles and positioning advice';
      if (questions) prompt += '\\n7. Answer these questions: ' + questions;
    } else if (tab === 'firm') {
      const firm = document.getElementById('firmName').value;
      const type = document.getElementById('firmType').value;
      const contact = document.getElementById('firmContactName').value;
      const notes = document.getElementById('firmNotes').value;
      const questions = document.getElementById('firmQuestions').value;
      prompt = 'Research "' + firm + '" (' + type + '). Today is ' + today + '.\\n\\n';
      prompt += 'Context: ' + window.__userProfile.name + ' is a CPO/COO exploring relationships with ' + type + ' firms for portfolio operating roles.\\n\\n';
      if (contact) prompt += 'Contact: ' + contact + '\\n\\n';
      if (notes) prompt += 'Notes: ' + notes + '\\n\\n';
      prompt += 'Provide:\\n1. Firm overview (AUM, fund stage, investment thesis, geography)\\n2. Portfolio companies (especially tech/SaaS)\\n3. Operating team and talent partners\\n4. Recent investments and exits\\n5. How they work with operating executives\\n6. Positioning advice for initial conversation';
      if (questions) prompt += '\\n7. Answer these questions: ' + questions;
    } else if (tab === 'portfolio') {
      const fund = document.getElementById('fundName').value;
      const contact = document.getElementById('portfolioContactName').value;
      const context = document.getElementById('portfolioContext').value;
      const topN = document.getElementById('topN').value;
      const questions = document.getElementById('portfolioQuestions').value;
      prompt = 'Research the portfolio of "' + fund + '". Today is ' + today + '. Focus on 2024-2026.\\n\\n';
      prompt += 'Context: A CPO/COO with 7 years AI experience reviewing this fund\\'s portfolio for companies that might need senior product/operations leadership.\\n\\n';
      if (contact) prompt += 'Fund contact: ' + contact + '\\n';
      if (context) prompt += 'Discussion context: ' + context + '\\n\\n';
      prompt += 'Tasks:\\n1. List ALL known active portfolio companies (not exited)\\n2. Identify top ' + topN + ' SaaS/software/AI/tech companies\\n3. For each, assess leadership gaps and growth signals\\n4. Rank by need for CPO/COO\\n5. Provide conversation angles';
      if (questions) prompt += '\\n6. Answer these questions: ' + questions;
    } else if (tab === 'company') {
      const company = document.getElementById('ca-company').value;
      const website = document.getElementById('ca-website').value;
      const geography = document.getElementById('ca-geography').value;
      const sector = document.getElementById('ca-sector').value;
      const peSponsors = document.getElementById('ca-pe-sponsors').value;
      const jobUrl = document.getElementById('ca-job-url').value;
      const recruiterNotes = document.getElementById('ca-recruiter-notes').value;
      const questions = document.getElementById('ca-questions').value;
      prompt = 'Deep research on "' + company + '" for a senior executive role assessment. Today is ' + today + '.\\n\\n';
      prompt += 'Context: ' + window.__userProfile.positioning + '\\n\\n';
      if (website) prompt += 'Website: ' + website + '\\n';
      if (geography) prompt += 'Geography: ' + geography + '\\n';
      if (sector) prompt += 'Sector: ' + sector + '\\n';
      if (peSponsors) prompt += 'PE/Investors: ' + peSponsors + '\\n';
      if (jobUrl) prompt += 'Job posting: ' + jobUrl + '\\n';
      if (recruiterNotes) prompt += 'Recruiter notes: ' + recruiterNotes + '\\n';
      prompt += '\\nProvide:\\n1. Company overview (founding, funding rounds, revenue estimates, headcount, product/market)\\n2. PE/VC ownership structure and investment thesis\\n3. Leadership team and any recent executive changes\\n4. Product and technology stack assessment\\n5. Market position, competitors, and differentiation\\n6. Recent news, press, and strategic moves\\n7. Why they might need this role now\\n8. Key risks and red flags\\n9. Positioning advice for ' + window.__userProfile.name + '';
      if (questions) prompt += '\\n10. Answer these questions: ' + questions;
    }
    document.getElementById('promptText-' + tab).value = prompt;
    document.getElementById('prompt-' + tab).style.display = 'block';
  }

  function copyPrompt(tab) {
    const el = document.getElementById('promptText-' + tab);
    el.select();
    document.execCommand('copy');
    alert('Prompt copied to clipboard');
  }

  async function runAuditFromTab(tab) {
    const pasteArea = document.getElementById('pasteArea-' + tab);
    const priorResearch = pasteArea.value.trim();
    if (priorResearch.length < 50) {
      alert('Please paste the Perplexity output first (minimum 50 characters)');
      return;
    }
    let taskContext = '', researchType = tab, explicitQuestions = '';
    if (tab === 'interview') {
      taskContext = document.getElementById('companyName').value + ' - ' + document.getElementById('roleTitle').value;
      explicitQuestions = document.getElementById('interviewQuestions').value;
    } else if (tab === 'firm') {
      taskContext = document.getElementById('firmName').value + ' (' + document.getElementById('firmType').value + ')';
      explicitQuestions = document.getElementById('firmQuestions').value;
    } else if (tab === 'portfolio') {
      taskContext = document.getElementById('fundName').value + ' portfolio scan';
      explicitQuestions = document.getElementById('portfolioQuestions').value;
    } else if (tab === 'company') {
      taskContext = document.getElementById('ca-company').value + ' company assessment';
      explicitQuestions = document.getElementById('ca-questions') ? document.getElementById('ca-questions').value : '';
    }
    startLoading();
    try {
      const r = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priorResearch, taskContext, explicitQuestions, researchType })
      });
      const data = await r.json();
      data.success ? showResults(data) : alert('Error: ' + (data.error || 'Unknown'));
    } catch (err) { alert('Request failed: ' + err.message); }
    finally { stopLoading(); }
  }

  async function writeToAttio() {
    const email = document.getElementById('attioEmail').value;
    const resultEl = document.getElementById('attioResult');
    resultEl.textContent = 'Writing to Attio...';
    try {
      const r = await fetch('/api/write-attio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: currentRunId, email: email || undefined })
      });
      const data = await r.json();
      resultEl.textContent = data.success
        ? (data.noteWritten ? 'Note written to Attio.' : 'No email provided or person not found.')
        : 'Error: ' + (data.error || 'Unknown');
    } catch (err) { resultEl.textContent = 'Failed: ' + err.message; }
  }

<\/script>
</body>
</html>`);
});

// Perplexity API removed — use the Manual Research tab to generate a prompt,
// run it in Perplexity browser, then paste the output into /api/audit
app.post('/api/research', (req, res) => {
  res.status(410).json({
    success: false,
    error: 'Automatic Perplexity research has been removed. Use the Manual Research tab to generate a prompt, run it at perplexity.ai, then paste the output to /api/audit.',
    manualWorkflow: true
  });
});

app.post('/api/research/firm', (req, res) => {
  res.status(410).json({
    success: false,
    error: 'Automatic Perplexity firm research has been removed. Use the Manual Research tab to generate a prompt, run it at perplexity.ai, then paste the output to /api/audit.',
    manualWorkflow: true
  });
});

app.post('/api/research/portfolio', (req, res) => {
  res.status(410).json({
    success: false,
    error: 'Automatic Perplexity portfolio research has been removed. Use the Manual Research tab to generate a prompt, run it at perplexity.ai, then paste the output to /api/audit.',
    manualWorkflow: true
  });
});

// POST /api/audit — Stage 2 only. Receives priorResearch from manual Perplexity paste.
app.post('/api/audit', async (req, res) => {
  const { priorResearch, taskContext, explicitQuestions, namedPeople, researchType } = req.body;
  if (!priorResearch || priorResearch.trim().length < 50) {
    return res.status(400).json({ success: false, error: 'priorResearch is required (paste Perplexity output, min 50 chars)' });
  }
  try {
    const result = await runAudit({ priorResearch, taskContext, explicitQuestions, namedPeople, researchType });
    logActivity({ agent: 'agent2', action: 'audit_complete', company: taskContext || 'unknown', result: 'success', detail: `type=${researchType || 'manual'}, chars=${priorResearch.length}` });
    res.json({ success: true, result });
  } catch (err) {
    logActivity({ agent: 'agent2', action: 'audit_complete', company: taskContext || 'unknown', result: 'error', detail: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// Perplexity API removed — use the Manual Research tab (Company/Role type)
// to generate a prompt, run it at perplexity.ai, then paste output to /api/audit
app.post('/api/research/company-assessment', (req, res) => {
  res.status(410).json({
    success: false,
    error: 'Automatic Perplexity research has been removed. Use the Manual Research tab — Company/Role type — to generate a prompt, run it at perplexity.ai, then paste the output to /api/audit.',
    manualWorkflow: true
  });
});

// POST /api/write-attio
app.post('/api/write-attio', async (req, res) => {
  try {
    const { runId, email } = req.body;
    if (!runId) return res.status(400).json({ success: false, error: 'runId required' });

    const run = researchRuns.get(runId);
    if (!run) return res.status(404).json({ success: false, error: 'Run not found' });

    let noteWritten = false;
    if (email) {
      const person = await lookupByEmail(email);
      if (person && person.id) {
        const markdown = readFileSync(run.output_path, 'utf8');
        noteWritten = await appendNote(
          person.id,
          `Research: ${run.company_name} — ${run.role_title}`,
          markdown
        );
        if (noteWritten) {
          researchRuns.markAttioWritten(runId);
        }
      }
    }
    res.json({ success: true, noteWritten });
  } catch (err) {
    console.error('Attio write error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/status
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), port: PORT });
});

// GET /api/history
app.get('/api/history', (req, res) => {
  res.json(researchRuns.list(20));
});

// GET /api/research/:runId/file
app.get('/api/research/:runId/file', (req, res) => {
  try {
    const run = researchRuns.get(req.params.runId);
    if (!run) return res.status(404).send('Run not found');
    const md = readFileSync(run.output_path, 'utf8');
    res.type('text/markdown').send(md);
  } catch (err) {
    res.status(500).send('Error reading file: ' + err.message);
  }
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', port: PORT, time: new Date().toISOString() }));

// ── Sigint routes ─────────────────────────────────────────────────────────────

app.get('/api/sigint/sources', (req, res) => {
  const db = getSigintDb();
  res.json(db.prepare('SELECT * FROM sources ORDER BY priority DESC').all());
});

app.post('/api/sigint/sources', (req, res) => {
  const { name, category, url, priority = 5 } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  const db = getSigintDb();
  try {
    db.prepare('INSERT OR IGNORE INTO sources (name, category, url, priority) VALUES (?, ?, ?, ?)')
      .run(name, category || 'general', url, priority);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sigint/fetch', async (req, res) => {
  try {
    const result = await fetchAllSources();
    logActivity({ agent: 'agent2', action: 'sigint_fetch', result: 'success',
      detail: `fetched=${result.fetched}, new=${result.new}, errors=${result.errors.length}` });
    res.json({ success: true, ...result });
  } catch (err) {
    logActivity({ agent: 'agent2', action: 'sigint_fetch', result: 'error', detail: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sigint/synthesize', async (req, res) => {
  const { daysBack = 7 } = req.body;
  try {
    const result = await synthesizeBriefing(daysBack);
    logActivity({ agent: 'agent2', action: 'sigint_synthesize',
      result: result.success ? 'success' : 'error',
      detail: result.success ? `words=${result.wordCount}, week=${result.weekStart}` : result.error });
    res.json(result);
  } catch (err) {
    logActivity({ agent: 'agent2', action: 'sigint_synthesize', result: 'error', detail: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/sigint/briefings', (req, res) => {
  const db = getSigintDb();
  res.json(db.prepare(
    'SELECT id, title, week_start, week_end, created_at FROM briefings ORDER BY created_at DESC LIMIT 20'
  ).all());
});

app.get('/api/sigint/briefings/:id', (req, res) => {
  const db = getSigintDb();
  const b = db.prepare('SELECT * FROM briefings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json(b);
});

app.post('/api/sigint/pipeline', async (req, res) => {
  const { daysBack = 7 } = req.body;
  try {
    const fetchResult = await fetchAllSources();
    const synthResult = await synthesizeBriefing(daysBack);
    logActivity({ agent: 'agent2', action: 'sigint_pipeline', result: 'success',
      detail: `new_items=${fetchResult.new}, words=${synthResult.wordCount || 0}` });
    res.json({ success: true, fetch: fetchResult, synth: synthResult });
  } catch (err) {
    logActivity({ agent: 'agent2', action: 'sigint_pipeline', result: 'error', detail: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Agent 2 Research Hub at http://localhost:${PORT}`);
  console.log('Manual trigger only — open browser to run research');
});
