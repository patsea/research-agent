import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import axios from 'axios';
import 'dotenv/config';
import { generateDraft, regenerateSection } from './modules/drafter.js';
import { saveDraft, closeClient } from './modules/gmail-draft.js';
import { drafts, templates, agent5Queue } from './db.js';
import { logActivity } from '../shared/activityLogger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3037;
const POSITIONING_PATH = process.env.POSITIONING_DOC_PATH || join(__dirname, 'POSITIONING.md');

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => {
  const positioningLoaded = existsSync(POSITIONING_PATH);
  res.json({ status: 'ok', positioningLoaded });
});

// Positioning document
app.get('/api/positioning', (req, res) => {
  try {
    const content = readFileSync(POSITIONING_PATH, 'utf-8');
    res.json({ content });
  } catch {
    res.status(404).json({ error: 'POSITIONING.md not found' });
  }
});

app.post('/api/positioning', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  writeFileSync(POSITIONING_PATH, content, 'utf-8');
  res.json({ success: true });
});

// Templates
app.get('/api/templates', (req, res) => {
  res.json(templates.list());
});

app.post('/api/templates', (req, res) => {
  const { name, description, structurePrompt, wordCountTarget } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = templates.insert({ name, description, structurePrompt, wordCountTarget });
  res.json({ success: true, id });
});

// Generate draft
app.post('/api/draft', async (req, res) => {
  const { contact, research, templateName } = req.body;
  if (!contact) return res.status(400).json({ error: 'contact required' });

  try {
    const template = templates.get(templateName || 'default');
    const templatePrompt = template?.structure_prompt || null;
    const wordCountTarget = template?.word_count_target || 200;

    console.log(`[draft] Generating for ${contact.name} at ${contact.company}`);
    const result = await generateDraft({
      contact,
      research: research || null,
      templatePrompt,
      wordCountTarget
    });

    const draft = {
      id: randomUUID(),
      contactId: contact.id || null,
      contactName: contact.name,
      contactEmail: contact.email,
      contactTitle: contact.title,
      company: contact.company,
      subject: result.subject,
      body: result.body,
      wordCount: result.wordCount,
      campaignType: contact.campaignType || 'pe_vc',
      templateName: templateName || 'default',
      researchContext: research ? JSON.stringify(research) : null
    };

    drafts.insert(draft);
    logActivity({ agent: 'outreach-drafter', action: 'draft_generated', contact: contact.name, company: contact.company, result: 'success', detail: `${result.wordCount} words, template=${templateName || 'default'}` });
    console.log(`[draft] Generated: ${draft.id} (${result.wordCount} words)`);

    res.json({
      id: draft.id,
      subject: result.subject,
      body: result.body,
      wordCount: result.wordCount,
      warnings: result.warnings,
      contactName: contact.name,
      contactEmail: contact.email,
      company: contact.company,
      campaignType: contact.campaignType
    });
  } catch (err) {
    console.error('[draft] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Regenerate section
app.post('/api/draft/regenerate', async (req, res) => {
  const { draftId, section, instruction } = req.body;
  if (!draftId || !section) return res.status(400).json({ error: 'draftId and section required' });

  const draft = drafts.get(draftId);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });

  try {
    const result = await regenerateSection({
      currentBody: draft.body,
      section,
      instruction,
      contact: { name: draft.contact_name, company: draft.company, title: draft.contact_title },
      wordCountTarget: 200
    });

    drafts.update(draftId, { body: result.body, word_count: result.wordCount });
    res.json({ id: draftId, body: result.body, wordCount: result.wordCount });
  } catch (err) {
    console.error('[regenerate] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Approve draft and save to Gmail
app.post('/api/draft/:id/approve', async (req, res) => {
  const { id } = req.params;
  const draft = drafts.get(id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });

  try {
    const gmailResult = await saveDraft({
      to: draft.contact_email,
      subject: draft.subject,
      body: draft.body
    });

    drafts.updateStatus(id, 'approved');
    agent5Queue.add(id, gmailResult.draftId || null);
    logActivity({ agent: 'outreach-drafter', action: 'draft_approved', contact: draft.contact_name, company: draft.company, result: gmailResult.success ? 'gmail_saved' : 'approved_no_gmail', detail: `gmailDraftId=${gmailResult.draftId || 'none'}` });

    // Notify Contact Research (best effort)
    if (draft.contact_id) {
      try {
        await axios.post(`${process.env.AGENT4_URL}/api/contacts/${draft.contact_id}/confirm`, {
          status: 'Outreach drafted'
        }, { timeout: 5000 });
      } catch (err) {
        console.log(`[approve] Contact Research notification failed (non-critical): ${err.message}`);
      }
    }

    res.json({
      success: true,
      gmailDraftId: gmailResult.draftId || null,
      savedToGmail: gmailResult.success
    });
  } catch (err) {
    console.error('[approve] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Dismiss draft
app.post('/api/draft/:id/dismiss', (req, res) => {
  const { id } = req.params;
  const draft = drafts.get(id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  drafts.updateStatus(id, 'dismissed');
  res.json({ success: true });
});

// List drafts
app.get('/api/drafts', (req, res) => {
  const { status } = req.query;
  res.json(drafts.list(status || null));
});

// Shutdown
process.on('SIGTERM', async () => { await closeClient(); process.exit(0); });
process.on('SIGINT', async () => { await closeClient(); process.exit(0); });

// GET /api/contacts-to-draft — confirmed contacts from contact-research with no draft yet
app.get('/api/contacts-to-draft', async (req, res) => {
  try {
    const agent4Url = process.env.AGENT4_URL || 'http://localhost:3036';
    const r = await axios.get(agent4Url + '/api/contacts?status=confirmed', { timeout: 5000 });
    const contacts = r.data || [];

    // Filter out contacts that already have a non-dismissed draft
    const existingDrafts = drafts.list(null);
    const draftedIds = new Set(existingDrafts.filter(d => d.status !== 'dismissed').map(d => d.contact_id));

    const toDraft = contacts.filter(c => !draftedIds.has(c.id));
    res.json(toDraft);
  } catch(e) {
    // If contact-research is down, return empty array gracefully
    res.json([]);
  }
});

// GET /api/research-context/:company — fetch research output for a company from research hub
app.get('/api/research-context/:company', async (req, res) => {
  try {
    const agent2Url = process.env.AGENT2_URL || 'http://localhost:3035';
    // Try research library endpoint
    const r = await axios.get(agent2Url + '/api/research-library', { timeout: 5000 });
    const items = r.data || [];
    const company = decodeURIComponent(req.params.company).toLowerCase();
    const match = items.find(i => (i.company_name || '').toLowerCase().includes(company));
    if (match && match.output_path) {
      // Try to read the markdown output file
      const filePath = match.output_path.startsWith('/') ? match.output_path :
        join(__dirname, '..', match.output_path);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf8');
        return res.json({ found: true, content: content.substring(0, 3000), company: match.company_name, date: match.created_at });
      }
    }
    res.json({ found: false });
  } catch(e) {
    res.json({ found: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Outreach Drafter running on http://localhost:${PORT}`);
});
