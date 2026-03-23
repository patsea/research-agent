import fs from 'fs';
import { logActivity } from '../shared/activityLogger.js';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';
import { identifyContact } from './modules/identifier.js';
import { enrichContact } from './modules/enricher.js';
import { assembleContactCard } from './modules/contactCard.js';
import { contacts, agent5Queue } from './db.js';
import { upsertCompany, upsertPerson } from './modules/attio.js';
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
  try { migDb.prepare('ALTER TABLE contacts ADD COLUMN role_rationale TEXT DEFAULT ""').run(); } catch(e) {}
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

    // Step 1: Identify contacts (returns array of up to 3)
    const identifiedArr = await identifyContact({
      companyName: companyName || null,
      campaignType: campaignType || 'pe_vc',
      linkedinUrl: linkedinUrl || null,
      researchContext
    });
    console.log(`[research] Identified ${identifiedArr.length} contact(s): ${identifiedArr.map(c => c.name || 'N/A').join(', ')}`);

    // Step 2 & 3: Enrich and assemble card for each contact
    const cards = [];
    for (const identified of identifiedArr) {
      const enriched = await enrichContact({
        name: identified.name,
        company: identified.company || companyName,
        linkedinUrl: identified.linkedinUrl || linkedinUrl,
        companyDomain: companyDomain || null
      });
      console.log(`[research] Enriched: ${enriched.email || 'no email'} (${enriched.emailStatus || 'N/A'})`);

      const card = assembleContactCard({
        identified,
        enriched,
        campaignType: campaignType || 'pe_vc',
        context: context || ''
      });
      console.log(`[research] Card assembled: ${card.id}`);
      cards.push(card);
    }
    logActivity({ agent: "contact-research", action: "contact_found", company: req.body.companyName || "", result: "success", count: cards.length }).catch(()=>{});

    // Return single card for backward compat if 1, otherwise array
    res.json(cards.length === 1 ? cards[0] : cards);
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
app.post('/api/contacts/:id/confirm', async (req, res) => {
  const { id } = req.params;
  const contact = contacts.get(id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  contacts.updateStatus(id, 'confirmed');
  agent5Queue.add(id, contact.campaign_type, req.body.companyContext || '');

  // Attio upsert — non-blocking, errors logged not thrown
  try {
    const nameParts = (contact.name || '').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    const domain = contact.company ? contact.company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com' : null;

    let companyRecordId = null;
    if (domain) {
      companyRecordId = await upsertCompany({
        name: contact.company,
        domain,
        firmType: 'VC/PE'
      });
    }

    await upsertPerson({
      firstName,
      lastName,
      title: contact.title,
      linkedinUrl: contact.linkedin_url,
      companyRecordId,
      talentRole: 'Operating',
      matchConfidence: contact.confidence || null,
      roleRationale: contact.role_rationale || '',
      campaignType: contact.campaign_type
    });
    console.log(`[confirm] Attio upsert complete for ${contact.name}`);
  } catch (attioErr) {
    console.error(`[confirm] Attio upsert error (non-fatal): ${attioErr.message}`);
  }

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

// GET /api/contacts/export — CSV export with optional status filter
app.get('/api/contacts/export', (req, res) => {
  const status = req.query.status || null;
  const db = getDb();
  const query = status
    ? "SELECT * FROM contacts WHERE status = ? ORDER BY created_at DESC"
    : "SELECT * FROM contacts ORDER BY created_at DESC";
  const rows = status ? db.prepare(query).all(status) : db.prepare(query).all();
  db.close();
  const headers = ['id','name','email','title','company','linkedin_url',
    'email_verified','confidence','role_rationale','source','campaign_type',
    'status','fund_name','gp_name','operating_partner','research_run_id','created_at'];
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="contacts-export.csv"');
  res.send(csv);
});

// PIPELINE IMPORT — GAP-2 — added 22 Mar 2026
import { createRequire } from 'module';
const _reqPipeline = createRequire(import.meta.url);
const multer = _reqPipeline('multer');
const pipelineImport = _reqPipeline('./modules/pipeline-import.cjs');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const ATTIO_KEY = process.env.ATTIO_API_KEY ||
  (() => {
    const fs = _reqPipeline('fs');
    const envPaths = ['.env', '../dashboard/.env', '../research/.env', '../email-scan/.env'];
    for (const p of envPaths) {
      try {
        const match = fs.readFileSync(join(__dirname, p), 'utf8').match(/ATTIO_API_KEY=(.+)/);
        if (match?.[1]?.trim()) return match[1].trim();
      } catch {}
    }
    return '';
  })();

app.post('/api/pipeline/import', upload.single('csv'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded. Use field name: csv' });
    const batchMeta = {
      label: req.body.label || `Import ${new Date().toISOString().split('T')[0]}`,
      source: req.body.source || 'Manual',
      batch_id: req.body.batch_id || null,
    };
    const result = await pipelineImport.importCSV(req.file.buffer, batchMeta, ATTIO_KEY);
    res.json(result);
  } catch (err) {
    console.error('Pipeline import error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pipeline/batches', (req, res) => {
  try {
    const db = new Database(join(__dirname, 'data', 'agent4.db'));
    const batches = db.prepare('SELECT * FROM pipeline_batches ORDER BY created_at DESC').all();
    db.close();
    res.json({ batches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pipeline/batch/:batch_id', (req, res) => {
  try {
    const db = new Database(join(__dirname, 'data', 'agent4.db'));
    const batch = db.prepare('SELECT * FROM pipeline_batches WHERE batch_id = ?').get(req.params.batch_id);
    if (!batch) { db.close(); return res.status(404).json({ error: 'Batch not found' }); }
    const contacts = db.prepare('SELECT * FROM pipeline_contacts WHERE batch_id = ? ORDER BY company_name, last_name').all(req.params.batch_id);
    db.close();
    res.json({ batch, contacts, total: contacts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE BATCH — added 22 Mar 2026
app.delete('/api/pipeline/batch/:batch_id', (req, res) => {
  try {
    const { batch_id } = req.params;
    if (!batch_id) return res.status(400).json({ error: 'batch_id required' });
    const db = new Database(join(__dirname, 'data', 'agent4.db'));
    const batch = db.prepare('SELECT * FROM pipeline_batches WHERE batch_id = ?').get(batch_id);
    if (!batch) { db.close(); return res.status(404).json({ error: 'Batch not found' }); }
    const contactCount = db.prepare('SELECT COUNT(*) as n FROM pipeline_contacts WHERE batch_id = ?').get(batch_id).n;
    db.prepare('DELETE FROM pipeline_contacts WHERE batch_id = ?').run(batch_id);
    db.prepare('DELETE FROM pipeline_batches WHERE batch_id = ?').run(batch_id);
    db.close();
    res.json({ ok: true, contacts_deleted: contactCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CLOSELY EXPORT — GAP-3 — added 22 Mar 2026
app.get('/api/pipeline/closely-export', (req, res) => {
  try {
    const { batch_id } = req.query;
    if (!batch_id) return res.status(400).json({ error: 'batch_id required' });

    const db = _reqPipeline('better-sqlite3')('./data/agent4.db');

    // Verify batch exists
    const batch = db.prepare('SELECT * FROM pipeline_batches WHERE batch_id = ?').get(batch_id);
    if (!batch) { db.close(); return res.status(404).json({ error: 'Batch not found' }); }

    // Get contacts not yet sent to Closely (no closely_linkedin_url and not previously exported)
    const contacts = db.prepare(`
      SELECT id, first_name, last_name, sales_nav_url, input_linkedin_url, closely_status
      FROM pipeline_contacts
      WHERE batch_id = ?
        AND (closely_status IS NULL OR closely_status = '')
        AND closely_linkedin_url IS NULL
      ORDER BY company_name, last_name, first_name
    `).all(batch_id);

    if (contacts.length === 0) {
      db.close();
      return res.json({ message: 'No contacts pending Closely export', count: 0 });
    }

    // Build CSV rows
    const lines = ['First Name,Last Name,LinkedIn URL'];
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      UPDATE pipeline_contacts
      SET closely_status = 'exported', closely_processed_at = ?
      WHERE id = ?
    `);

    for (const c of contacts) {
      // Prefer input_linkedin_url if it's a vanity /in/ URL, else fall back to sales_nav_url
      const linkedinCol = (c.input_linkedin_url && c.input_linkedin_url.includes('/in/'))
        ? c.input_linkedin_url
        : (c.sales_nav_url || '');

      const row = [
        `"${(c.first_name || '').replace(/"/g, '""')}"`,
        `"${(c.last_name || '').replace(/"/g, '""')}"`,
        `"${linkedinCol.replace(/"/g, '""')}"`,
      ];
      lines.push(row.join(','));
      stmt.run(now, c.id);
    }

    // Update batch timestamp
    db.prepare(`UPDATE pipeline_batches SET closely_exported_at = ?, updated_at = ? WHERE batch_id = ?`)
      .run(now, now, batch_id);

    db.close();

    const filename = `closely-import-${batch_id}-${now.split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\n'));

  } catch (err) {
    console.error('Closely export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// CLOSELY IMPORT — GAP-4 — added 22 Mar 2026
app.post('/api/pipeline/closely-import', upload.single('csv'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded. Use field name: csv' });
    const { batch_id } = req.body;
    if (!batch_id) return res.status(400).json({ error: 'batch_id required in form data' });

    const db = _reqPipeline('better-sqlite3')('./data/agent4.db');

    const batch = db.prepare('SELECT * FROM pipeline_batches WHERE batch_id = ?').get(batch_id);
    if (!batch) { db.close(); return res.status(404).json({ error: 'Batch not found' }); }

    // Parse Closely CSV
    function parseCSV(buf) {
      const text = buf.toString('utf8').replace(/^\uFEFF/, '');
      const lines = text.split('\n').filter(l => l.trim());
      const headers = parseRow(lines[0]).map(h => h.trim().toLowerCase());
      return lines.slice(1).map(l => {
        const vals = parseRow(l);
        const obj = {};
        headers.forEach((h, i) => obj[h] = (vals[i] || '').trim());
        return obj;
      });
    }

    function parseRow(line) {
      const result = []; let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') { inQ = !inQ; }
        else if (line[i] === ',' && !inQ) { result.push(cur); cur = ''; }
        else cur += line[i];
      }
      result.push(cur);
      return result;
    }

    const rows = parseCSV(req.file.buffer);

    // Get all pipeline contacts for this batch
    const contacts = db.prepare(
      'SELECT id, first_name, last_name FROM pipeline_contacts WHERE batch_id = ?'
    ).all(batch_id);

    // Build lookup: "firstname lastname" → contact id
    const contactMap = {};
    for (const c of contacts) {
      const key = `${c.first_name.toLowerCase().trim()} ${c.last_name.toLowerCase().trim()}`;
      contactMap[key] = c.id;
    }

    const now = new Date().toISOString();
    const updateStmt = db.prepare(`
      UPDATE pipeline_contacts
      SET closely_linkedin_url = ?,
          closely_status = ?,
          closely_processed_at = ?
      WHERE id = ?
    `);

    const results = { matched: 0, error_status: 0, not_in_batch: 0 };
    const matchedIds = new Set();

    for (const row of rows) {
      const firstName = (row['first_name'] || row['custom_first_name_original'] || '').toLowerCase().trim();
      const lastName  = (row['last_name']  || row['custom_last_name_original']  || '').toLowerCase().trim();
      const key = `${firstName} ${lastName}`;
      const contactId = contactMap[key];

      if (!contactId) { results.not_in_batch++; continue; }

      const linkedinUrl = row['linkedin_url'] || '';
      const status = row['status'] || '';
      const isError = status.toLowerCase().includes('error');

      // Only store if it's a /in/ URL (encoded or vanity — both valid)
      const cleanUrl = linkedinUrl.replace(/\/$/, '');
      const closelySts = isError ? 'error' : (cleanUrl.includes('/in/') ? 'matched' : 'not_found');

      updateStmt.run(
        cleanUrl.includes('/in/') ? cleanUrl : null,
        closelySts,
        now,
        contactId
      );

      matchedIds.add(contactId);
      if (isError) results.error_status++;
      else results.matched++;
    }

    // Mark contacts not present in Closely export as not_found
    for (const c of contacts) {
      if (!matchedIds.has(c.id)) {
        db.prepare(`UPDATE pipeline_contacts SET closely_status = 'not_found', closely_processed_at = ? WHERE id = ?`)
          .run(now, c.id);
      }
    }

    db.prepare(`UPDATE pipeline_batches SET closely_imported_at = ?, updated_at = ? WHERE batch_id = ?`)
      .run(now, now, batch_id);

    db.close();

    res.json({
      batch_id,
      rows_in_csv: rows.length,
      matched: results.matched,
      error_status: results.error_status,
      not_in_batch: results.not_in_batch,
      not_found: contacts.length - matchedIds.size,
    });

  } catch (err) {
    console.error('Closely import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// FULLENRICH EXPORT — GAP-5 — added 22 Mar 2026
app.get('/api/pipeline/fullenrich-export', (req, res) => {
  try {
    const { batch_id } = req.query;
    if (!batch_id) return res.status(400).json({ error: 'batch_id required' });

    const db = _reqPipeline('better-sqlite3')('./data/agent4.db');
    const batch = db.prepare('SELECT * FROM pipeline_batches WHERE batch_id = ?').get(batch_id);
    if (!batch) { db.close(); return res.status(404).json({ error: 'Batch not found' }); }

    // Get contacts not yet sent to FullEnrich
    const contacts = db.prepare(`
      SELECT id, first_name, last_name, company_name,
             fullenrich_linkedin_url, closely_linkedin_url, input_linkedin_url, sales_nav_url,
             fullenrich_status
      FROM pipeline_contacts
      WHERE batch_id = ?
        AND (fullenrich_status IS NULL OR fullenrich_status = '' OR fullenrich_status = 'exported')
      ORDER BY company_name, last_name, first_name
    `).all(batch_id);

    if (contacts.length === 0) {
      db.close();
      return res.json({ message: 'No contacts pending FullEnrich export', count: 0 });
    }

    const lines = ['first_name,last_name,company_name,linkedin_url'];
    const now = new Date().toISOString();
    const noLinkedinList = [];

    const stmt = db.prepare(
      `UPDATE pipeline_contacts SET fullenrich_status = 'exported', fullenrich_processed_at = ? WHERE id = ?`
    );

    for (const c of contacts) {
      // LinkedIn URL priority: fullenrich vanity > closely > input — never sales_nav
      const linkedinUrl =
        c.fullenrich_linkedin_url ||
        c.closely_linkedin_url ||
        c.input_linkedin_url ||
        '';

      if (!linkedinUrl) noLinkedinList.push({ name: `${c.first_name} ${c.last_name}`, company: c.company_name });

      const row = [
        `"${(c.first_name || '').replace(/"/g, '""')}"`,
        `"${(c.last_name || '').replace(/"/g, '""')}"`,
        `"${(c.company_name || '').replace(/"/g, '""')}"`,
        `"${linkedinUrl.replace(/"/g, '""')}"`,
      ];
      lines.push(row.join(','));
      stmt.run(now, c.id);
    }

    db.prepare(
      `UPDATE pipeline_batches SET fullenrich_exported_at = ?, updated_at = ? WHERE batch_id = ?`
    ).run(now, now, batch_id);

    db.close();

    // If there are no-LinkedIn contacts, return JSON report instead of CSV
    // so Patrick can decide whether to proceed or resolve them first
    if (noLinkedinList.length > 0) {
      const csvContent = lines.join('\n');
      return res.json({
        warning: 'GAP-13: Some contacts have no LinkedIn URL — FullEnrich match rate will be lower',
        no_linkedin_count: noLinkedinList.length,
        no_linkedin_contacts: noLinkedinList,
        total_in_export: contacts.length,
        csv: csvContent,
        message: 'CSV content returned in "csv" field. Save to file to upload to FullEnrich.',
      });
    }

    const filename = `fullenrich-import-${batch_id}-${now.split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\n'));

  } catch (err) {
    console.error('FullEnrich export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// FULLENRICH IMPORT — GAP-6 — added 22 Mar 2026
app.post('/api/pipeline/fullenrich-import', upload.single('csv'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded. Use field name: csv' });
    const { batch_id } = req.body;
    if (!batch_id) return res.status(400).json({ error: 'batch_id required in form data' });

    const db = _reqPipeline('better-sqlite3')('./data/agent4.db');
    const batch = db.prepare('SELECT * FROM pipeline_batches WHERE batch_id = ?').get(batch_id);
    if (!batch) { db.close(); return res.status(404).json({ error: 'Batch not found' }); }

    function parseCSV(buf) {
      const text = buf.toString('utf8').replace(/^\uFEFF/, '');
      const lines = text.split('\n').filter(l => l.trim());
      const headers = parseRow(lines[0]).map(h => h.trim());
      return lines.slice(1).map(l => {
        const vals = parseRow(l);
        const obj = {};
        headers.forEach((h, i) => obj[h] = (vals[i] || '').trim());
        return obj;
      });
    }

    function parseRow(line) {
      const result = []; let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') { inQ = !inQ; }
        else if (line[i] === ',' && !inQ) { result.push(cur); cur = ''; }
        else cur += line[i];
      }
      result.push(cur);
      return result;
    }

    function mapEmailQuality(bounceStatus) {
      if (!bounceStatus) return null;
      const s = bounceStatus.toLowerCase();
      if (s.includes('valid & safe')) return 'Verified';
      if (s.includes('probably valid')) return 'Probably Valid';
      if (s.includes('catch-all') || s.includes('catch all')) return 'Catch-All';
      return null;
    }

    const rows = parseCSV(req.file.buffer);
    const contacts = db.prepare(
      'SELECT id, first_name, last_name FROM pipeline_contacts WHERE batch_id = ?'
    ).all(batch_id);

    // Build lookup by "firstname lastname" normalised
    const contactMap = {};
    for (const c of contacts) {
      const key = `${c.first_name.toLowerCase().trim()} ${c.last_name.toLowerCase().trim()}`;
      contactMap[key] = c.id;
    }

    const now = new Date().toISOString();
    const updateStmt = db.prepare(`
      UPDATE pipeline_contacts SET
        fullenrich_status       = ?,
        fullenrich_processed_at = ?,
        email                   = ?,
        email_quality           = ?,
        fullenrich_linkedin_url = ?,
        fullenrich_headline     = ?,
        fullenrich_job_title    = ?,
        fullenrich_location     = ?,
        fullenrich_summary      = ?,
        fe_company_name         = ?,
        fe_company_description  = ?,
        fe_company_website      = ?,
        fe_company_headcount    = ?,
        fe_company_linkedin     = ?
      WHERE id = ?
    `);

    const results = { matched: 0, not_found: 0, not_in_batch: 0 };
    const notFoundList = [];
    const matchedIds = new Set();

    for (const row of rows) {
      const firstName = (row['first_name'] || row['First Name'] || '').toLowerCase().trim();
      const lastName  = (row['last_name']  || row['Last Name']  || '').toLowerCase().trim();
      const key = `${firstName} ${lastName}`;
      const contactId = contactMap[key];

      if (!contactId) { results.not_in_batch++; continue; }

      const isFound = (row['Row Status (FullEnrich)'] || '').toLowerCase() === 'success';
      const status = isFound ? 'matched' : 'not_found';

      const vanityUrl = row['Linkedin Url(FullEnrich)'] || row['LinkedIn Profile Url'] || '';

      updateStmt.run(
        status,
        now,
        isFound ? (row['Email (FullEnrich)'] || null) : null,
        isFound ? mapEmailQuality(row['Bounce Status (FullEnrich)']) : null,
        vanityUrl || null,
        row['Headline (Linkedin)'] || null,
        row['Job Title (Linkedin)'] || null,
        row['Location (Linkedin)'] || null,
        row['summary (Linkedin)'] || row['Summary (Linkedin)'] || null,
        row['Company Name (Linkedin)'] || null,
        row['Company Description (Linkedin)'] || null,
        row['Company Website (Linkedin)'] || null,
        row['Company Headcount Range (Linkedin)'] || null,
        row['Company LinkedIn Url'] || null,
        contactId
      );

      matchedIds.add(contactId);
      if (isFound) results.matched++;
      else {
        results.not_found++;
        notFoundList.push({ name: `${row['first_name'] || row['First Name']} ${row['last_name'] || row['Last Name']}`, company: row['company_name'] || row['Company Name'] || '' });
      }
    }

    // Contacts in pipeline but absent from FullEnrich export entirely
    for (const c of contacts) {
      if (!matchedIds.has(c.id)) results.not_in_batch++;
    }

    db.prepare(
      `UPDATE pipeline_batches SET fullenrich_imported_at = ?, updated_at = ? WHERE batch_id = ?`
    ).run(now, now, batch_id);

    db.close();

    res.json({
      batch_id,
      rows_in_csv: rows.length,
      matched: results.matched,
      not_found: results.not_found,
      not_in_batch: results.not_in_batch,
      not_found_list: notFoundList,
    });

  } catch (err) {
    console.error('FullEnrich import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// FULLENRICH STATUS — GAP-13 — added 22 Mar 2026
app.get('/api/pipeline/fullenrich-status', (req, res) => {
  try {
    const { batch_id } = req.query;
    if (!batch_id) return res.status(400).json({ error: 'batch_id required' });

    const db = _reqPipeline('better-sqlite3')('./data/agent4.db');
    const batch = db.prepare('SELECT * FROM pipeline_batches WHERE batch_id = ?').get(batch_id);
    if (!batch) { db.close(); return res.status(404).json({ error: 'Batch not found' }); }

    const counts = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN fullenrich_status = 'matched' THEN 1 ELSE 0 END) as matched,
        SUM(CASE WHEN fullenrich_status = 'not_found' THEN 1 ELSE 0 END) as not_found,
        SUM(CASE WHEN fullenrich_status = 'exported' THEN 1 ELSE 0 END) as exported,
        SUM(CASE WHEN (fullenrich_linkedin_url IS NULL AND closely_linkedin_url IS NULL AND input_linkedin_url IS NULL) THEN 1 ELSE 0 END) as no_linkedin,
        SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) as has_email,
        SUM(CASE WHEN email_quality = 'Verified' THEN 1 ELSE 0 END) as email_verified,
        SUM(CASE WHEN email_quality = 'Probably Valid' THEN 1 ELSE 0 END) as email_probably_valid,
        SUM(CASE WHEN email_quality = 'Catch-All' THEN 1 ELSE 0 END) as email_catch_all
      FROM pipeline_contacts WHERE batch_id = ?
    `).get(batch_id);

    const notFoundContacts = db.prepare(`
      SELECT first_name, last_name, company_name
      FROM pipeline_contacts
      WHERE batch_id = ? AND fullenrich_status = 'not_found'
      ORDER BY company_name, last_name
    `).all(batch_id);

    db.close();

    res.json({
      batch_id,
      summary: counts,
      not_found_contacts: notFoundContacts,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PIPELINE SOURCE — Sales Navigator search — added 22 Mar 2026
app.post('/api/pipeline/source/start', express.json(), async (req, res) => {
  try {
    const { companies, title_keywords, geography, label, max_per_company, mode, filters, max_results } = req.body;

    // Validate based on mode
    if (mode === 'filter_search') {
      if (!filters || !Array.isArray(filters.title_keywords) || filters.title_keywords.length === 0)
        return res.status(400).json({ error: 'filters.title_keywords required for filter_search mode' });
    } else {
      // company_list mode (default)
      if (!Array.isArray(companies) || companies.length === 0)
        return res.status(400).json({ error: 'companies array required for company_list mode' });
      if (!Array.isArray(title_keywords) || title_keywords.length === 0)
        return res.status(400).json({ error: 'title_keywords array required' });
    }

    // Pre-flight: check Chrome is running with CDP on port 9222
    const net = _reqPipeline('net');
    const cdpAvailable = await new Promise(resolve => {
      const socket = net.createConnection(9222, '127.0.0.1');
      socket.setTimeout(1500);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
    });

    if (!cdpAvailable) {
      return res.status(503).json({
        error: 'chrome_not_ready',
        message: 'Chrome is not running with remote debugging enabled.',
        fix: 'Quit Chrome, then run this command in Terminal:\n/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --profile-directory="Default"',
      });
    }

    const { spawn } = _reqPipeline('child_process');
    const path = _reqPipeline('path');

    const jobId = `job-${Date.now()}`;
    const jobFile = '/tmp/salesnav-job.json';
    const resultsFile = '/tmp/salesnav-results.json';

    const jobSpec = {
      job_id: jobId,
      label: label || `Search ${new Date().toISOString().split('T')[0]}`,
      mode: mode || 'company_list',
      companies: companies || [],
      title_keywords: title_keywords || [],
      geography: geography || '',
      max_results_per_company: max_per_company || 5,
      filters: filters || {},
      max_results: max_results || 200,
      created_at: new Date().toISOString(),
    };

    const totalForProgress = mode === 'filter_search' ? (max_results || 200) : (companies || []).length;

    fs.writeFileSync(jobFile, JSON.stringify(jobSpec, null, 2));
    fs.writeFileSync(resultsFile, JSON.stringify({
      job_id: jobId,
      status: 'starting',
      progress: { current: 0, total: totalForProgress, current_company: '' },
      results: [],
      not_found: [],
      errors: [],
    }));

    const scriptPath = path.join(__dirname, '..', 'tests', 'ui', 'salesnav-search.spec.js');
    const proc = spawn('node', [scriptPath], {
      env: { ...process.env, JOB_FILE: jobFile, RESULTS_FILE: resultsFile, HEADLESS: 'false' },
      cwd: path.join(__dirname, '..'),
      detached: true,
      stdio: 'ignore',
    });
    proc.unref();

    res.json({ ok: true, job_id: jobId, company_count: totalForProgress, mode: mode || 'company_list' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/pipeline/source/status', (req, res) => {
  try {
    if (!fs.existsSync('/tmp/salesnav-results.json'))
      return res.json({ status: 'idle', results: [], progress: null });
    const data = JSON.parse(fs.readFileSync('/tmp/salesnav-results.json', 'utf8'));
    res.json(data);
  } catch (e) {
    res.json({ status: 'idle', results: [], error: e.message });
  }
});

app.get('/api/pipeline/source/chrome-status', async (req, res) => {
  const net = _reqPipeline('net');
  const available = await new Promise(resolve => {
    const socket = net.createConnection(9222, '127.0.0.1');
    socket.setTimeout(1500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
  res.json({ chrome_ready: available });
});

// PIPELINE UI — added 22 Mar 2026
app.get('/pipeline', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'pipeline.html'));
});

// EVAL ROUTES — added 22 Mar 2026
app.get('/eval', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'eval.html'));
});

app.get('/api/eval/contacts', (req, res) => {
  try {
    const contacts = JSON.parse(fs.readFileSync(join(__dirname, 'data', 'eval-contacts.json'), 'utf8'));
    res.json({ contacts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/eval/verdict', (req, res) => {
  try {
    const { record_id, name, verdict, correct_company, notes, corrections } = req.body;
    if (!record_id) return res.status(400).json({ error: 'record_id required' });
    const db = new Database(join(__dirname, 'data', 'agent4.db'));
    db.prepare(`INSERT OR REPLACE INTO eval_verdicts
      (record_id, name, verdict, correct_company, notes, corrections, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run(record_id, name||null, verdict||null, correct_company||null, notes||null, JSON.stringify(corrections||{}));
    db.close();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/eval/verdict-batch', express.json(), (req, res) => {
  try {
    const { verdicts } = req.body;
    if (!Array.isArray(verdicts) || verdicts.length === 0) {
      return res.status(400).json({ error: 'verdicts array required' });
    }
    const db = new Database(join(__dirname, 'data', 'agent4.db'));
    const stmt = db.prepare(`INSERT OR REPLACE INTO eval_verdicts
      (record_id, name, verdict, correct_company, notes, corrections, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
    for (const v of verdicts) {
      stmt.run(v.record_id, v.name||null, v.verdict||null, v.correct_company||null, v.notes||null, JSON.stringify(v.corrections||{}));
    }
    db.close();
    res.json({ ok: true, saved: verdicts.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/eval/verdicts', (req, res) => {
  try {
    const db = new Database(join(__dirname, 'data', 'agent4.db'));
    const rows = db.prepare('SELECT * FROM eval_verdicts ORDER BY reviewed_at DESC').all();
    db.close();
    res.json({ verdicts: rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/eval/export.csv', (req, res) => {
  try {
    const db = new Database(join(__dirname, 'data', 'agent4.db'));
    const rows = db.prepare('SELECT * FROM eval_verdicts ORDER BY name ASC').all();
    db.close();
    const header = 'record_id,name,verdict,correct_company,notes,job_title_correction,email_correction,company_correction,reviewed_at\n';
    const body = rows.map(r => {
      let corr = {};
      try { corr = JSON.parse(r.corrections || '{}'); } catch {}
      return [r.record_id, r.name, r.verdict, r.correct_company||'', r.notes||'', corr.job_title||'', corr.email||'', corr.company||'', r.reviewed_at]
        .map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',');
    }).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="eval-verdicts.csv"');
    res.send(header + body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// EVAL AI SYNTHESIS — added 22 Mar 2026
app.post('/api/eval/synthesise', async (req, res) => {
  try {
    const { linkedin_summary, company_description, company_name, job_title, name } = req.body;

    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ||
      (() => {
        const fs = _reqPipeline('fs');
        for (const f of ['../.env', '.env', '../dashboard/.env']) {
          try {
            const m = fs.readFileSync(f, 'utf8').match(/ANTHROPIC_API_KEY=(.+)/);
            if (m) return m[1].trim();
          } catch {}
        }
        return '';
      })();

    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not found' });

    const prompt = `You are helping review PE/VC contacts for executive outreach.

Contact: ${name}
Title: ${job_title}
Company: ${company_name}

LinkedIn About:
${linkedin_summary || '(not available)'}

Company Description:
${company_description || '(not available)'}

Return ONLY a JSON object with exactly two fields:
{
  "person_synthesis": "One sentence (max 20 words) describing what this person actually does day-to-day",
  "company_focus": "One sentence (max 20 words) describing what sectors or types of companies this firm invests in or works with"
}

No preamble. No markdown. Raw JSON only.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);

  } catch (err) {
    console.error('Synthesis error:', err);
    // Fail gracefully — return empty strings, don't break the UI
    res.json({ person_synthesis: '', company_focus: '' });
  }
});

// SESSION MANAGEMENT — added 22 Mar 2026
app.get('/api/eval/session', (req, res) => {
  try {
    const db = new Database(join(__dirname, 'data', 'agent4.db'));
    const session = db.prepare('SELECT * FROM eval_sessions WHERE session_id = ?').get('pevc-mar2026');
    const verdictCount = db.prepare('SELECT COUNT(*) as n FROM eval_verdicts WHERE verdict IS NOT NULL').get().n;
    db.close();
    res.json({ ...session, verdict_count: verdictCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/eval/session/reset', (req, res) => {
  try {
    const db = new Database(join(__dirname, 'data', 'agent4.db'));
    db.prepare('DELETE FROM eval_verdicts').run();
    db.prepare("UPDATE eval_sessions SET state='active', completed_at=NULL WHERE session_id='pevc-mar2026'").run();
    db.close();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/eval/session/complete', (req, res) => {
  try {
    const db = new Database(join(__dirname, 'data', 'agent4.db'));
    const verdictCount = db.prepare('SELECT COUNT(*) as n FROM eval_verdicts WHERE verdict IS NOT NULL').get().n;
    if (verdictCount === 0) {
      db.close();
      return res.status(400).json({ error: 'No verdicts saved — nothing to complete' });
    }
    db.prepare("UPDATE eval_sessions SET state='complete', completed_at=datetime('now') WHERE session_id='pevc-mar2026'").run();
    db.close();
    res.json({ ok: true, verdict_count: verdictCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/eval/reload-contacts', async (req, res) => {
  try {
    const { execFile } = await import('child_process');
    const scriptPath = join(__dirname, 'scripts', 'build-eval-data.cjs');
    execFile('node', [scriptPath, ATTIO_KEY], { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) return res.status(500).json({ error: 'Reload failed', detail: stderr });
      res.json({ ok: true });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ATTIO PULL — queue_for_eval = true — added 22 Mar 2026
app.get('/api/pipeline/attio/pull-queued', async (req, res) => {
  try {
    const response = await fetch('https://api.attio.com/v2/objects/people/records/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ATTIO_KEY}`,
      },
      body: JSON.stringify({
        filter: { queue_for_eval: true },
        limit: 100,
      }),
    });

    const data = await response.json();
    if (!data.data) return res.status(500).json({ error: 'Attio query failed', detail: data });

    const records = data.data.map(r => {
      const v = r.values;
      const nameArr = v.name?.[0];
      const companyRef = v.company?.[0];
      return {
        attio_record_id: r.id?.record_id,
        first_name: nameArr?.first_name || '',
        last_name: nameArr?.last_name || '',
        job_title: v.job_title?.[0]?.value || '',
        company_name: companyRef?.referenced_record?.name ||
                      companyRef?.target_record_id || '',
        email: v.email_addresses?.[0]?.email_address || '',
        linkedin: v.linkedin?.[0]?.value || '',
        geography: v.geography?.[0]?.option?.title || '',
      };
    });

    res.json({ count: records.length, records });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reset queue_for_eval for a list of record_ids after import
app.post('/api/pipeline/attio/reset-queue', express.json(), async (req, res) => {
  try {
    const { record_ids } = req.body;
    if (!Array.isArray(record_ids) || record_ids.length === 0)
      return res.status(400).json({ error: 'record_ids array required' });

    const results = [];
    for (const id of record_ids) {
      const r = await fetch(`https://api.attio.com/v2/objects/people/records/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ATTIO_KEY}` },
        body: JSON.stringify({ data: { values: { queue_for_eval: false } } }),
      });
      results.push({ id, ok: r.ok });
      await new Promise(res => setTimeout(res, 150)); // rate limit
    }

    res.json({ ok: true, reset: results.filter(r => r.ok).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Shutdown handlers
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

app.listen(PORT, () => {
  console.log(`Contact Research running on http://localhost:${PORT}`);
});
