import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getModel } = require('../shared/models.cjs');
import { fileURLToPath } from 'url';
import { getActivity } from '../shared/activityLogger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, '..', 'config');
const POSITIONING_PATH = resolve(__dirname, '..', 'outreach-drafter', 'POSITIONING.md');

const app = express();
const PORT = process.env.PORT || 3030;

app.use(express.json());
app.use(express.static('public'));

const AGENTS = [
  { id: 'signal-scanner', name: 'Signal Scanner', port: 3033, path: '/', group: 'pipeline', description: 'Monitors job boards, fund sites and news for CPO/COO/OpPartner signals' },
  { id: 'research-hub', name: 'Research Hub',     port: 3035, path: '/',         group: 'pipeline', description: 'Interview Prep, Firm Research, Portfolio Scan' },
  { id: 'scorer', name: 'Scorer',           port: 3038, path: '/',         group: 'pipeline', description: 'ELNS+H scoring for companies and exec search firms' },
  { id: 'contact-research', name: 'Contact Research', port: 3036, path: '/',         group: 'pipeline', description: 'FullEnrich single-lookup contact finder' },
  { id: 'outreach-drafter', name: 'Outreach Drafter', port: 3037, path: '/',         group: 'pipeline', description: 'Draft and save to Gmail — split-screen with research context' },
  { id: 'email-scan', name: 'Email Scan',       port: 3034, path: '/api/health', group: 'pipeline', description: 'Daily Gmail scan — classifies replies, updates Attio' },
  { id: 'gmail-hygiene', name: 'Gmail Hygiene', port: 3039, path: '/api/health', group: 'standalone', description: 'Auto-labels emails, unsubscribe, spam blocking' },
  { id: 'podcast-monitor', name: 'Podcast Monitor', port: 3040, path: '/api/health', group: 'standalone', description: 'RSS polling, transcription, AI summarisation with interest-tag filtering' },
  { id: 'newsletter-monitor', name: 'Newsletter Monitor', port: 3041, path: '/api/health', group: 'standalone', description: 'Gmail newsletter extraction, AI summarisation with interest-tag filtering' },
];

app.get('/api/status', async (req, res) => {
  const results = await Promise.all(AGENTS.map(async agent => {
    try {
      await axios.get(`http://localhost:${agent.port}/api/health`, { timeout: 1500 });
      return { ...agent, running: true };
    } catch {
      return { ...agent, running: false };
    }
  }));
  res.json(results);
});

// Activity log
app.get('/api/activity', (req, res) => {
  const { limit = 50, agent, contact } = req.query;
  const rows = getActivity({ limit: parseInt(limit, 10), agent: agent || null, contact: contact || null });
  res.json(rows);
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', port: PORT, time: new Date().toISOString() }));

// Proxy: Signal Scanner results
app.get('/api/proxy/scanner-results', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query).toString();
    const url = `http://localhost:3033/api/signals${params ? '?' + params : ''}`;
    const response = await axios.get(url, { timeout: 5000 });
    res.json(response.data);
  } catch (e) {
    res.status(502).json({ error: 'Signal Scanner not reachable', detail: e.message });
  }
});

// Proxy: Signal Scanner metadata (filter options)
app.get('/api/proxy/scanner-meta', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:3033/api/signals/meta', { timeout: 5000 });
    res.json(response.data);
  } catch (e) {
    res.status(502).json({ error: 'Signal Scanner not reachable', detail: e.message });
  }
});

// Proxy: Forward signal to research pipeline
app.post('/api/proxy/scanner-forward/:id', async (req, res) => {
  try {
    const response = await axios.post(`http://localhost:3033/api/signals/${req.params.id}/forward`, {}, { timeout: 5000 });
    res.json(response.data);
  } catch (e) {
    res.status(502).json({ error: 'Signal Scanner not reachable', detail: e.message });
  }
});

// Proxy: Update signal status
app.patch('/api/proxy/scanner-signal/:id', async (req, res) => {
  try {
    const response = await axios.patch(`http://localhost:3033/api/signals/${req.params.id}`, req.body, { timeout: 5000 });
    res.json(response.data);
  } catch (e) {
    res.status(502).json({ error: 'Signal Scanner not reachable', detail: e.message });
  }
});

// ── Gmail Hygiene proxy routes (port 3039) ─────────────────────────
app.get('/api/proxy/gmail-hygiene/senders', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:3039/api/senders', { timeout: 5000 });
    res.json(response.data);
  } catch (e) { res.status(502).json({ error: 'Gmail Hygiene not reachable', detail: e.message }); }
});

app.get('/api/proxy/gmail-hygiene/digest', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:3039/api/digest', { timeout: 5000 });
    res.json(response.data);
  } catch (e) { res.status(502).json({ error: 'Gmail Hygiene not reachable', detail: e.message }); }
});

app.post('/api/proxy/gmail-hygiene/scan', async (req, res) => {
  try {
    const response = await axios.post('http://localhost:3039/api/scan', req.body, { timeout: 60000 });
    res.json(response.data);
  } catch (e) { res.status(502).json({ error: 'Gmail Hygiene not reachable', detail: e.message }); }
});

app.post('/api/proxy/gmail-hygiene/senders/:id/:action', async (req, res) => {
  try {
    const { id, action } = req.params;
    const response = await axios.post(`http://localhost:3039/api/senders/${id}/${action}`, req.body || {}, { timeout: 5000 });
    res.json(response.data);
  } catch (e) { res.status(502).json({ error: 'Gmail Hygiene not reachable', detail: e.message }); }
});

// ── Email Scan proxy routes (port 3034) ────────────────────────────
app.get('/api/proxy/email-scan/stats', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:3034/api/stats', { timeout: 5000 });
    res.json(response.data);
  } catch (e) { res.status(502).json({ error: 'Email Scan not reachable', detail: e.message }); }
});

app.get('/api/proxy/email-scan/results', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:3034/api/results', { timeout: 5000 });
    res.json(response.data);
  } catch (e) { res.status(502).json({ error: 'Email Scan not reachable', detail: e.message }); }
});

app.post('/api/proxy/email-scan/scan', async (req, res) => {
  try {
    const response = await axios.post('http://localhost:3034/scan', req.body || {}, { timeout: 120000 });
    res.json(response.data);
  } catch (e) { res.status(502).json({ error: 'Email Scan not reachable', detail: e.message }); }
});

// ── Newsletter Monitor proxy routes (port 3041) ────────────────────
app.get('/api/proxy/newsletter/newsletters', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:3041/api/newsletters', { timeout: 5000 });
    res.json(response.data);
  } catch (e) { res.status(502).json({ error: 'Newsletter Monitor not reachable', detail: e.message }); }
});

app.get('/api/proxy/newsletter/subscriptions', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:3041/api/subscriptions', { timeout: 5000 });
    res.json(response.data);
  } catch (e) { res.status(502).json({ error: 'Newsletter Monitor not reachable', detail: e.message }); }
});

app.post('/api/proxy/newsletter/run', async (req, res) => {
  try {
    const response = await axios.post('http://localhost:3041/api/run', req.body || {}, { timeout: 60000 });
    res.json(response.data);
  } catch (e) { res.status(502).json({ error: 'Newsletter Monitor not reachable', detail: e.message }); }
});

app.patch('/api/proxy/newsletter/status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const response = await axios.patch(`http://localhost:3041/api/newsletters/${id}/status`, req.body || {}, { timeout: 5000 });
    res.json(response.data);
  } catch (e) { res.status(502).json({ error: 'Newsletter Monitor not reachable', detail: e.message }); }
});

// ── Config API routes ──────────────────────────────────────────────

// Helper: JSON config read/write
function getJsonConfig(filePath, res, label) {
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: `${label} not found. Copy ${label}.example.json to ${label}.json to get started.` });
  }
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: `Failed to read ${label}`, detail: e.message });
  }
}

function putJsonConfig(filePath, req, res, label) {
  try {
    writeFileSync(filePath, JSON.stringify(req.body, null, 2) + '\n', 'utf-8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: `Failed to write ${label}`, detail: e.message });
  }
}

// user-profile
app.get('/api/config/user-profile', (req, res) => {
  getJsonConfig(resolve(CONFIG_DIR, 'user-profile.json'), res, 'user-profile');
});
app.post('/api/config/user-profile', (req, res) => {
  putJsonConfig(resolve(CONFIG_DIR, 'user-profile.json'), req, res, 'user-profile');
});

// attio-fields
app.get('/api/config/attio-fields', (req, res) => {
  getJsonConfig(resolve(CONFIG_DIR, 'attio-fields.json'), res, 'attio-fields');
});
app.post('/api/config/attio-fields', (req, res) => {
  putJsonConfig(resolve(CONFIG_DIR, 'attio-fields.json'), req, res, 'attio-fields');
});

// scoring-rubric
app.get('/api/config/scoring-rubric', (req, res) => {
  getJsonConfig(resolve(CONFIG_DIR, 'scoring-rubric.json'), res, 'scoring-rubric');
});
app.post('/api/config/scoring-rubric', (req, res) => {
  putJsonConfig(resolve(CONFIG_DIR, 'scoring-rubric.json'), req, res, 'scoring-rubric');
});

// positioning (markdown file)
app.get('/api/config/positioning', (req, res) => {
  if (!existsSync(POSITIONING_PATH)) {
    return res.status(404).json({ error: 'POSITIONING.md not found' });
  }
  try {
    const content = readFileSync(POSITIONING_PATH, 'utf-8');
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read POSITIONING.md', detail: e.message });
  }
});
app.post('/api/config/positioning', (req, res) => {
  try {
    writeFileSync(POSITIONING_PATH, req.body.content || '', 'utf-8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write POSITIONING.md', detail: e.message });
  }
});

// models config
const MODELS_PATH = resolve(CONFIG_DIR, 'models.json');

app.get('/api/config/models', (req, res) => {
  getJsonConfig(MODELS_PATH, res, 'models');
});

app.post('/api/config/models', (req, res) => {
  // Read existing to preserve _available and _descriptions
  let existing = {};
  try { existing = JSON.parse(readFileSync(MODELS_PATH, 'utf-8')); } catch {}
  const merged = {
    synthesis: req.body.synthesis || existing.synthesis,
    classification: req.body.classification || existing.classification,
    podcast_summary: req.body.podcast_summary || existing.podcast_summary,
    podcast_section: req.body.podcast_section || existing.podcast_section,
    _available: existing._available || [],
    _descriptions: existing._descriptions || {}
  };
  try {
    writeFileSync(MODELS_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write models config', detail: e.message });
  }
});

// AI-suggest scoring rubric dimensions
app.post('/api/config/scoring-rubric/suggest', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in environment' });
  }

  const { rubricType } = req.body || {};
  if (!rubricType || !['company', 'firm'].includes(rubricType)) {
    return res.status(400).json({ error: 'rubricType must be "company" or "firm"' });
  }

  // Read user profile for context
  let userProfile = {};
  const profilePath = resolve(CONFIG_DIR, 'user-profile.json');
  if (existsSync(profilePath)) {
    try { userProfile = JSON.parse(readFileSync(profilePath, 'utf-8')); } catch {}
  }

  const profileContext = [
    userProfile.title ? `Current title: ${userProfile.title}` : '',
    userProfile.targetRoles?.length ? `Target roles: ${userProfile.targetRoles.join(', ')}` : '',
    userProfile.targetSectors?.length ? `Target sectors: ${userProfile.targetSectors.join(', ')}` : '',
    userProfile.positioning ? `Positioning: ${userProfile.positioning}` : ''
  ].filter(Boolean).join('\n');

  // Load prompt from config/prompts/dashboard-rubric-suggest.md
  const suggestPromptRaw = readFileSync(resolve(__dirname, '..', 'config', 'prompts', 'dashboard-rubric-suggest.md'), 'utf-8');
  const firmSection = suggestPromptRaw.split('## Firm Rubric')[1] || '';
  const companySection = (suggestPromptRaw.split('## Company Rubric')[1] || '').split('## Firm Rubric')[0] || '';
  const firmPrompt = firmSection.trim().replace('{{PROFILE_CONTEXT}}', profileContext);
  const companyPrompt = companySection.trim().replace('{{PROFILE_CONTEXT}}', profileContext);

  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: getModel('synthesis'),
      max_tokens: 2000,
      messages: [{ role: 'user', content: rubricType === 'firm' ? firmPrompt : companyPrompt }]
    }, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 60000
    });

    const text = response.data?.content?.map(b => b.text || '').join('') || '';
    res.json({ markdown: text });
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    res.status(500).json({ error: 'AI suggest failed', detail });
  }
});

// ── Prompt Editor API routes ─────────────────────────────────────

const PROMPTS_DIR = resolve(__dirname, '..', 'config', 'prompts');

const PROMPT_METADATA = [
  // All prompts loaded from config/prompts/
  { name: 'research-interview-prep-system', label: 'Interview Prep System Prompt', agent: 'Research Hub', group: 'Research' },
  { name: 'research-interview-prep-template', label: 'Interview Prep Template', agent: 'Research Hub', group: 'Research' },
  { name: 'research-company-assessment', label: 'Company Assessment Template', agent: 'Research Hub', group: 'Research' },
  { name: 'research-company-audit', label: 'Company Assessment Audit', agent: 'Research Hub', group: 'Research' },
  { name: 'research-sigint-briefing', label: 'SIGINT Weekly Briefing', agent: 'Research Hub', group: 'Research' },
  // Phase 2 — extracted from source
  { name: 'signal-extraction', label: 'Signal Extraction', agent: 'Signal Scanner', group: 'Signal Scanner' },
  { name: 'signal-research-generator', label: 'Research Prompt Generator', agent: 'Signal Scanner', group: 'Signal Scanner' },
  { name: 'signal-audit', label: 'Signal Audit', agent: 'Signal Scanner', group: 'Signal Scanner' },
  { name: 'research-general-audit', label: 'General Audit System Prompt', agent: 'Research Hub', group: 'Research' },
  { name: 'contact-identification', label: 'Contact Identification', agent: 'Contact Research', group: 'Outreach' },
  { name: 'outreach-email-drafting', label: 'Email Drafting System Prompt', agent: 'Outreach Drafter', group: 'Outreach' },
  { name: 'email-reply-classification', label: 'Reply Classification', agent: 'Email Scan', group: 'Email' },
  { name: 'gmail-sender-classification', label: 'Sender Classification', agent: 'Gmail Hygiene', group: 'Email' },
  { name: 'podcast-summarisation', label: 'Podcast Summarisation', agent: 'Podcast Monitor', group: 'Monitoring' },
  { name: 'newsletter-summarisation', label: 'Newsletter Summarisation', agent: 'Newsletter Monitor', group: 'Monitoring' },
  { name: 'dashboard-rubric-suggest', label: 'Rubric AI Suggest', agent: 'Dashboard', group: 'Dashboard' },
  { name: 'scorer-rubric', label: 'Scorer Rubric Prompt', agent: 'Scorer', group: 'Scoring' },
  { name: 'podcast-digest-scoring', label: 'Podcast Digest Scoring', agent: 'Podcast Monitor', group: 'Monitoring' },
  { name: 'newsletter-digest-scoring', label: 'Newsletter Digest Scoring', agent: 'Newsletter Monitor', group: 'Monitoring' },
  { name: 'portfolio-researcher', label: 'Portfolio Researcher', agent: 'Research Hub', group: 'Research' },
];

// GET /api/config/prompts — list all prompts with metadata
app.get('/api/config/prompts', (req, res) => {
  const result = PROMPT_METADATA.map(p => {
    const filePath = resolve(PROMPTS_DIR, `${p.name}.md`);
    let content = '';
    if (existsSync(filePath)) {
      try { content = readFileSync(filePath, 'utf-8'); } catch (_) {}
    }
    return { ...p, exists: existsSync(filePath), content };
  });
  res.json(result);
});

// GET /api/config/prompts/:name — get single prompt content
app.get('/api/config/prompts/:name', (req, res) => {
  const meta = PROMPT_METADATA.find(p => p.name === req.params.name);
  if (!meta) return res.status(404).json({ error: 'Unknown prompt name' });

  const filePath = resolve(PROMPTS_DIR, `${meta.name}.md`);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'Prompt file not found' });

  try {
    const content = readFileSync(filePath, 'utf-8');
    res.json({ ...meta, content });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read prompt', detail: e.message });
  }
});

// POST /api/config/prompts/:name — save prompt content
app.post('/api/config/prompts/:name', (req, res) => {
  const meta = PROMPT_METADATA.find(p => p.name === req.params.name);
  if (!meta) return res.status(404).json({ error: 'Unknown prompt name' });

  const filePath = resolve(PROMPTS_DIR, `${meta.name}.md`);
  try {
    writeFileSync(filePath, req.body.content || '', 'utf-8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write prompt', detail: e.message });
  }
});

// Attio attributes proxy
app.get('/api/attio/attributes', async (req, res) => {
  const attioKey = process.env.ATTIO_API_KEY;
  if (!attioKey) {
    return res.status(500).json({ error: 'No ATTIO_API_KEY set in environment' });
  }
  try {
    const response = await axios.get('https://api.attio.com/v2/objects/people/attributes', {
      headers: { Authorization: `Bearer ${attioKey}` },
      timeout: 10000
    });
    const attributes = (response.data?.data || []).map(a => ({
      slug: a.api_slug || a.slug,
      title: a.title,
      type: a.type
    }));
    res.json({ attributes });
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    res.status(502).json({ error: 'Failed to fetch Attio attributes', detail });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Agent Dashboard at http://localhost:${PORT}\n`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
