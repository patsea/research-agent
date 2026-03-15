import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
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
  { id: 'signal-scanner', name: 'Signal Scanner', port: 3033, path: '/', description: 'Monitors job boards, fund sites and news for CPO/COO/OpPartner signals' },
  { id: 'agent2', name: 'Research Hub',     port: 3035, path: '/',         description: 'Interview Prep, Firm Research, Portfolio Scan' },
  { id: 'agent3', name: 'Scorer',           port: 3038, path: '/',         description: 'ELNS+H scoring for companies and exec search firms' },
  { id: 'agent4', name: 'Contact Research', port: 3036, path: '/',         description: 'FullEnrich single-lookup contact finder' },
  { id: 'agent5', name: 'Outreach Drafter', port: 3037, path: '/',         description: 'Draft and save to Gmail — split-screen with research context' },
  { id: 'agent6', name: 'Email Scan',       port: 3034, path: '/api/health', description: 'Daily Gmail scan — classifies replies, updates Attio' },
  { id: 'gmail-hygiene', name: 'Gmail Hygiene', port: 3039, path: '/api/health', description: 'Auto-labels emails, unsubscribe, spam blocking' },
  { id: 'podcast-monitor', name: 'Podcast Monitor', port: 3040, path: '/api/health', description: 'RSS polling, transcription, AI summarisation with interest-tag filtering' },
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

app.listen(PORT, () => {
  console.log(`\n  Agent Dashboard at http://localhost:${PORT}\n`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
