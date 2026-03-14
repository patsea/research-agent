import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';
import { identifyContact } from './modules/identifier.js';
import { enrichContact } from './modules/enricher.js';
import { assembleContactCard } from './modules/contactCard.js';
import { contacts, agent5Queue } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3036;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Full research pipeline
app.post('/api/research', async (req, res) => {
  const { companyName, campaignType, linkedinUrl, context } = req.body;

  if (!companyName && !linkedinUrl) {
    return res.status(400).json({ error: 'companyName or linkedinUrl required' });
  }

  try {
    console.log(`[research] Starting pipeline for ${companyName || linkedinUrl} (${campaignType})`);

    // Step 1: Identify contact
    const identified = await identifyContact({
      companyName: companyName || null,
      campaignType: campaignType || 'pe_vc',
      linkedinUrl: linkedinUrl || null
    });
    console.log(`[research] Identified: ${identified.name || 'N/A'} (${identified.confidence})`);

    // Step 2: Enrich via FullEnrich
    const enriched = await enrichContact({
      name: identified.name,
      company: identified.company || companyName,
      linkedinUrl: identified.linkedinUrl || linkedinUrl
    });
    console.log(`[research] Enriched: ${enriched.email || 'no email'} (${enriched.emailStatus || 'N/A'})`);

    // Step 3: Assemble contact card
    const card = assembleContactCard({
      identified,
      enriched,
      campaignType: campaignType || 'pe_vc',
      context: context || ''
    });
    console.log(`[research] Card assembled: ${card.id}`);

    res.json(card);
  } catch (err) {
    console.error('[research] Pipeline error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// List contacts
app.get('/api/contacts', (req, res) => {
  const { status } = req.query;
  res.json(contacts.list(status || null));
});

// Confirm contact
app.post('/api/contacts/:id/confirm', (req, res) => {
  const { id } = req.params;
  const contact = contacts.get(id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  contacts.updateStatus(id, 'confirmed');
  agent5Queue.add(id, contact.campaign_type, req.body.companyContext || '');
  res.json({ success: true, queuedForAgent5: true });
});

// Dismiss contact
app.post('/api/contacts/:id/dismiss', (req, res) => {
  const { id } = req.params;
  const contact = contacts.get(id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  contacts.updateStatus(id, 'dismissed');
  res.json({ success: true });
});

// Agent 5 queue
app.get('/api/queue', (req, res) => {
  res.json(agent5Queue.list());
});

// Closely CSV export
app.get('/api/closely-export', (req, res) => {
  const all = contacts.list();
  const exportable = all.filter(c =>
    c.email_verified !== 'Verified' && c.linkedin_url
  );

  let csv = 'First Name,Last Name,LinkedIn link\n';
  for (const c of exportable) {
    const parts = (c.name || '').trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';
    csv += `${firstName},${lastName},${c.linkedin_url}\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=closely-export.csv');
  res.send(csv);
});

// Shutdown handlers
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

app.listen(PORT, () => {
  console.log(`Agent 4 — Contact Research running on http://localhost:${PORT}`);
});
