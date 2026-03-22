'use strict';

const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const { parse } = require('csv-parse/sync');

function deriveGeo(location) {
  if (!location) return 'Other';
  const l = location.toLowerCase();
  if (/spain|madrid|barcelona|catalon|valenc|bilbao/.test(l)) return 'Spain';
  if (/united kingdom|london|england/.test(l)) return 'UK';
  if (/germany|munich|frankfurt|austria|switzerland|italy|milan|luxembourg/.test(l)) return 'DACH';
  if (/netherlands|amsterdam|amstelveen|belgium|brussels/.test(l)) return 'Benelux';
  if (/sweden|stockholm|denmark|copenhagen|norway|oslo|finland|helsinki/.test(l)) return 'Nordics';
  return 'Other';
}

function deriveRole(title) {
  const t = (title || '').toLowerCase();
  if (/operating partner|operating director|value creation|portfolio operations|coo|chief operating|transformation|director of operations|director, operations|head of technology|head of digital|cto|cio|operating manager/.test(t)) return 'Operating';
  return 'General Partner';
}

function deriveConfidence(title) {
  const t = (title || '').toLowerCase();
  if (/operating partner|operating director|value creation|coo|chief operating|transformation officer|operating manager|portfolio operations/.test(t)) return 'High';
  return 'Medium';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchAttioCompany(companyName, apiKey) {
  if (!apiKey) return null;
  try {
    const resp = await fetch('https://api.attio.com/v2/objects/companies/records/query', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: { name: { '$contains': companyName } },
        limit: 3,
      }),
    });
    if (!resp.ok) {
      console.warn(`[pipeline-import] Attio search failed for "${companyName}": ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    const records = data?.data || [];
    if (records.length === 0) return null;

    const first = records[0];
    const recordId = first.id?.record_id || null;
    const domains = first.values?.domains || [];
    const domain = domains[0]?.domain || null;
    // Try to extract firm_type from various possible field names
    const firmType = first.values?.firm_type?.[0]?.option?.title
      || first.values?.type?.[0]?.option?.title
      || null;

    return { recordId, domain, firmType };
  } catch (err) {
    console.warn(`[pipeline-import] Attio search error for "${companyName}": ${err.message}`);
    return null;
  }
}

async function importCSV(csvBuffer, batchMeta, attioApiKey) {
  // Handle BOM
  let csvString = csvBuffer.toString('utf8');
  if (csvString.charCodeAt(0) === 0xFEFF) {
    csvString = csvString.slice(1);
  }

  // Parse CSV
  const records = parse(csvString, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  if (records.length === 0) {
    throw new Error('CSV is empty or has no data rows');
  }

  // Validate required columns
  const firstRow = records[0];
  const requiredCols = ['first_name', 'last_name', 'company_name', 'job_title'];
  const missingCols = requiredCols.filter(c => !(c in firstRow));
  if (missingCols.length > 0) {
    throw new Error(`Missing required columns: ${missingCols.join(', ')}`);
  }

  // Deduplicate company names
  const uniqueCompanies = [...new Set(records.map(r => r.company_name).filter(Boolean))];

  // Lookup each company in Attio
  const companyLookup = {};
  for (const company of uniqueCompanies) {
    const result = await searchAttioCompany(company, attioApiKey);
    companyLookup[company] = result;
    await sleep(150); // Rate limit
  }

  // Generate batch_id
  const batchId = batchMeta.batch_id || `batch-${Date.now()}`;
  const label = batchMeta.label || `Import ${new Date().toISOString().split('T')[0]}`;
  const batchSource = batchMeta.source || 'Manual';

  // Open DB
  const dbPath = path.join(__dirname, '..', 'data', 'agent4.db');
  const db = new Database(dbPath);

  try {
    // Insert batch
    db.prepare(
      `INSERT INTO pipeline_batches (batch_id, label, source, total_contacts)
       VALUES (?, ?, ?, 0)`
    ).run(batchId, label, batchSource);

    // Insert contacts
    const insertStmt = db.prepare(
      `INSERT INTO pipeline_contacts (
        id, batch_id, first_name, last_name, company_name, job_title,
        geography, source, network_tag, sales_nav_url, input_linkedin_url, notes,
        attio_company_id, company_domain, company_status, company_firm_type,
        attio_status, draft_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const rows = [];
    let companiesFoundSet = new Set();
    let companiesNotFoundSet = new Set();
    let contactsWithLinkedin = 0;
    let contactsWithoutLinkedin = 0;

    const insertMany = db.transaction((records) => {
      for (const row of records) {
        const companyResult = companyLookup[row.company_name] || null;
        const companyStatus = companyResult ? 'found' : 'not_found';

        if (companyResult) {
          companiesFoundSet.add(row.company_name);
        } else {
          companiesNotFoundSet.add(row.company_name);
        }

        // Parse linkedin_url - only accept /in/ URLs
        let linkedinUrl = (row.linkedin_url || '').trim();
        if (linkedinUrl && !linkedinUrl.includes('/in/')) {
          linkedinUrl = ''; // Not a valid profile URL
        }

        if (linkedinUrl) {
          contactsWithLinkedin++;
        } else {
          contactsWithoutLinkedin++;
        }

        const id = crypto.randomUUID();
        const geo = deriveGeo(row.geography || '');

        insertStmt.run(
          id,
          batchId,
          row.first_name,
          row.last_name,
          row.company_name,
          row.job_title,
          geo,
          row.source || batchSource,
          row.network_tag || null,
          row.sales_nav_url || null,
          linkedinUrl || null,
          row.notes || null,
          companyResult?.recordId || null,
          companyResult?.domain || null,
          companyStatus,
          companyResult?.firmType || null,
          'pending',
          'pending'
        );

        rows.push({
          id,
          name: `${row.first_name} ${row.last_name}`,
          company_name: row.company_name,
          company_status: companyStatus,
          attio_company_id: companyResult?.recordId || null,
        });
      }
    });

    insertMany(records);

    // Update total_contacts
    db.prepare('UPDATE pipeline_batches SET total_contacts = ? WHERE batch_id = ?')
      .run(rows.length, batchId);

    return {
      batch_id: batchId,
      label,
      total: rows.length,
      companies_found: companiesFoundSet.size,
      companies_not_found: companiesNotFoundSet.size,
      companies_not_found_list: [...companiesNotFoundSet],
      contacts_with_linkedin: contactsWithLinkedin,
      contacts_without_linkedin: contactsWithoutLinkedin,
      rows,
    };
  } finally {
    db.close();
  }
}

module.exports = { importCSV, deriveGeo, deriveRole, deriveConfidence };
