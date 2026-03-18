import { logActivity } from '../shared/activityLogger.js';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';
import { identifyContact } from './modules/identifier.js';
import { enrichContact } from './modules/enricher.js';
import { assembleContactCard } from './modules/contactCard.js';
import { contacts, agent5Queue } from './db.js';
import Database from 'better-sqlite3';
import axios from 'axios';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3036;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Schema migration: add new columns if not present
try {
  const migDb = new Database(join(__dirname, 'data', 'agent4.db'));
  try { migDb.prepare('ALTER TABLE contacts ADD COLUMN sales_nav_url TEXT DEFAULT ""').run(); console.log('sales_nav_url column added'); } catch(e) { /* already exists */ }
  try { migDb.prepare('ALTER TABLE contacts ADD COLUMN fund_name TEXT DEFAULT ""').run(); } catch(e) {}
  try { migDb.prepare('ALTER TABLE contacts ADD COLUMN gp_name TEXT DEFAULT ""').run(); } catch(e) {}
  try { migDb.prepare('ALTER TABLE contacts ADD COLUMN operating_partner TEXT DEFAULT ""').run(); console.log('portfolio columns added'); } catch(e) {}
  migDb.close();
} catch(e) { console.error('Migration error:', e.message); }

// Helper: get direct DB handle for raw queries
function getDb() {
  return new Database(join(__dirname, 'data', 'agent4.db'));
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Full research pipeline
app.post('/api/research', async (req, res) => {
  const { companyName, campaignType, linkedinUrl, context, companyDomain, researchRunId } = req.body;

  if (!companyName && !linkedinUrl) {
    return res.status(400).json({ error: 'companyName or linkedinUrl required' });
  }

  try {
    console.log(`[research] Starting pipeline for ${companyName || linkedinUrl} (${campaignType})`);

    // Fetch Research Hub brief if a valid run ID is provided
    let researchContext = '';
    const isValidRunId = researchRunId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(researchRunId);
    if (isValidRunId) {
      try {
        const briefRes = await fetch(`http://localhost:3035/api/research/${researchRunId}/file`);
        if (briefRes.ok) {
          researchContext = await briefRes.text();
        }
      } catch (e) {
        console.warn('[contact-research] Could not fetch research brief:', e.message);
      }
    } else if (researchRunId) {
      console.warn(`[contact-research] Ignoring non-UUID researchRunId: ${researchRunId}`);
    }

    // Step 1: Identify contact
    const identified = await identifyContact({
      companyName: companyName || null,
      campaignType: campaignType || 'pe_vc',
      linkedinUrl: linkedinUrl || null,
      researchContext
    });
    console.log(`[research] Identified: ${identified.name || 'N/A'} (${identified.confidence})`);

    // Step 2: Enrich via FullEnrich
    const enriched = await enrichContact({
      name: identified.name,
      company: identified.company || companyName,
      linkedinUrl: identified.linkedinUrl || linkedinUrl,
      companyDomain: companyDomain || null
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
    logActivity({ agent: "contact-research", action: "contact_found", company: req.body.companyName || "", result: "success" }).catch(()=>{});

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

// Enrich contact (call enricher for existing contact)
app.post('/api/contacts/:id/enrich', async (req, res) => {
  const { id } = req.params;
  const contact = contacts.get(id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  try {
    const enriched = await enrichContact({
      name: contact.name,
      company: contact.company,
      linkedinUrl: contact.linkedin_url || null,
      companyDomain: null
    });

    if (enriched.email) {
      const db = getDb();
      db.prepare('UPDATE contacts SET email = ?, email_verified = ? WHERE id = ?')
        .run(enriched.email, enriched.emailStatus || 'Unverified', id);
      db.close();
    }

    res.json({ success: true, email: enriched.email || null, status: enriched.emailStatus || null });
  } catch (err) {
    console.error('[enrich] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
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

// GET /api/research-library — all research runs from research agent DB
app.get('/api/research-library', async (req, res) => {
  try {
    const researchDb = new Database(
      join(__dirname, '../research/data/agent2.db'),
      { readonly: true }
    );
    let rows = [];
    try {
      rows = researchDb.prepare(
        'SELECT id, company_name, context_type, output_path, created_at FROM research_runs ORDER BY created_at DESC'
      ).all();
    } catch(e) {
      rows = researchDb.prepare('SELECT * FROM research_runs ORDER BY rowid DESC').all();
    }
    researchDb.close();

    // Get scores from scorer DB if available
    let scores = {};
    try {
      const scorerDb = new Database(
        join(__dirname, '../scorer/data/agent3.db'), { readonly: true }
      );
      const scoreRows = scorerDb.prepare('SELECT * FROM scores').all();
      scoreRows.forEach(s => { scores[s.name] = s; });
      scorerDb.close();
    } catch(e) {}

    const enriched = rows.map(r => ({
      ...r,
      score: scores[r.company_name] || null
    }));
    res.json(enriched);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/attio-check?name=CompanyName — check if person exists in Attio for this company
app.get('/api/attio-check', async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.json({ found: false });
    const apiKey = process.env.ATTIO_API_KEY;
    if (!apiKey) return res.json({ found: false, reason: 'no_key' });

    const resp = await axios.post('https://api.attio.com/v2/objects/people/records/query', {
      filter: { company: { name: { '$contains': name } } },
      limit: 5
    }, { headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' } });

    const records = resp.data?.data || [];
    res.json({ found: records.length > 0, count: records.length, records: records.map(r => ({
      id: r.id?.record_id,
      name: r.values?.name?.[0]?.full_name,
      email: r.values?.email_addresses?.[0]?.email_address,
      status: r.values?.status_8?.[0]?.option?.title
    }))});
  } catch(e) {
    res.json({ found: false, error: e.message });
  }
});

// GET /api/salesnav-url — construct Sales Navigator search URL for a company + role
app.get('/api/salesnav-url', (req, res) => {
  const { company, role } = req.query;
  if (!company) return res.status(400).json({ error: 'company required' });

  const roleTitleMap = {
    'founder_ceo': 'CEO OR Founder OR "Co-Founder"',
    'operating_partner': '"Operating Partner" OR "Value Creation"',
    'talent_partner': '"Talent Partner" OR "People Partner" OR "Head of Talent"',
    'gp': '"General Partner" OR "Managing Partner" OR Partner',
    'portfolio_contact': 'CPO OR COO OR "Chief Product" OR "Chief Operating"'
  };

  const titleQuery = roleTitleMap[role] || role || '';
  const companyEncoded = encodeURIComponent(company);
  const titleEncoded = encodeURIComponent(titleQuery);

  const url = `https://www.linkedin.com/sales/search/people?query=(filters:List((type:CURRENT_COMPANY,values:List((text:${companyEncoded},selectionType:INCLUDED)))${titleQuery ? `,(type:TITLE,values:List((text:${titleEncoded},selectionType:INCLUDED)))` : ''}))`;

  res.json({ url, company, role, titleQuery });
});

// PATCH /api/contacts/:id/salesnav — save Sales Navigator URL to contact
app.patch('/api/contacts/:id/salesnav', (req, res) => {
  const { salesNavUrl } = req.body;
  if (!salesNavUrl) return res.status(400).json({ error: 'salesNavUrl required' });
  try {
    const db = getDb();
    db.prepare('UPDATE contacts SET sales_nav_url = ? WHERE id = ?')
      .run(salesNavUrl, req.params.id);
    db.close();
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/closely-import — accept Closely CSV output, merge LinkedIn URLs back to contacts
app.post('/api/closely-import', express.text({ type: 'text/csv', limit: '3mb' }), (req, res) => {
  try {
    const lines = req.body.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g,'').toLowerCase());
    let updated = 0;
    const db = getDb();
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',').map(v => v.trim().replace(/"/g,''));
      const row = {};
      headers.forEach((h, j) => row[h] = vals[j]);
      const linkedinUrl = row['linkedin url'] || row['linkedin_url'] || row['profile url'] || row['profileurl'];
      const firstName = row['first name'] || row['firstname'];
      if (linkedinUrl && firstName) {
        const result = db.prepare(
          'UPDATE contacts SET linkedin_url = ? WHERE name LIKE ? AND (linkedin_url IS NULL OR linkedin_url = "")'
        ).run(linkedinUrl, '%' + firstName + '%');
        updated += result.changes;
      }
    }
    db.close();
    res.json({ ok: true, updated });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/fullenrich-export — CSV for FullEnrich upload (contacts with LinkedIn URL, no email yet)
app.get('/api/fullenrich-export', (req, res) => {
  const db = getDb();
  const contactsList = db.prepare(
    'SELECT * FROM contacts WHERE linkedin_url IS NOT NULL AND linkedin_url != "" AND (email IS NULL OR email = "") AND status != "dismissed"'
  ).all();
  db.close();

  const csv = ['first_name,last_name,linkedin_url,company'].concat(
    contactsList.map(c => {
      const parts = (c.name || '').split(' ');
      const first = parts[0] || '';
      const last = parts.slice(1).join(' ') || '';
      return [`"${first}"`, `"${last}"`, `"${c.linkedin_url || ''}"`, `"${c.company || ''}"`].join(',');
    })
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="fullenrich-export.csv"');
  res.send(csv);
});

// POST /api/fullenrich-import — merge emails from FullEnrich CSV output back to contacts
app.post('/api/fullenrich-import', express.text({ type: 'text/csv', limit: '3mb' }), (req, res) => {
  try {
    const lines = req.body.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g,'').toLowerCase());
    let updated = 0;
    const db = getDb();
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',').map(v => v.trim().replace(/"/g,''));
      const row = {};
      headers.forEach((h, j) => row[h] = vals[j]);
      const email = row['email'] || row['email_address'];
      const linkedin = row['linkedin_url'] || row['linkedin url'];
      if (email && linkedin) {
        const result = db.prepare(
          'UPDATE contacts SET email = ?, email_verified = "Verified" WHERE linkedin_url = ?'
        ).run(email, linkedin);
        updated += result.changes;
      }
    }
    db.close();
    res.json({ ok: true, updated });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/closely-export — Closely-format CSV (First Name, Last Name, LinkedIn/SalesNav URL)
app.get('/api/closely-export', (req, res) => {
  const db = getDb();
  const contactsList = db.prepare(
    `SELECT * FROM contacts
     WHERE ((sales_nav_url IS NOT NULL AND sales_nav_url != '')
        OR (linkedin_url IS NOT NULL AND linkedin_url != ''))
     AND status != 'dismissed'`
  ).all();
  db.close();

  const header = 'First Name,Last Name,LinkedIn or SalesNavigator Profile URL,Company,Title';
  const rows = contactsList.map(c => {
    const parts = (c.name || '').split(' ');
    const first = (parts[0] || '').replace(/,/g, '');
    const last = (parts.slice(1).join(' ') || '').replace(/,/g, '');
    const url = c.sales_nav_url || c.linkedin_url || '';
    const company = (c.company || '').replace(/,/g, '');
    const title = (c.title || '').replace(/,/g, '');
    return [`"${first}"`,`"${last}"`,`"${url}"`,`"${company}"`,`"${title}"`].join(',');
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="closely-export.csv"');
  res.send([header, ...rows].join('\n'));
});

// Shutdown handlers
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

app.listen(PORT, () => {
  console.log(`Contact Research running on http://localhost:${PORT}`);
});
