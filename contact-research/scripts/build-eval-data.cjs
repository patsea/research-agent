#!/usr/bin/env node
// build-eval-data.cjs — Fetch contacts from Attio, join with FullEnrich, write eval-contacts.json
// Usage: node build-eval-data.cjs <ATTIO_API_KEY>

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = process.argv[2];
if (!API_KEY) { console.error('Usage: node build-eval-data.cjs <ATTIO_API_KEY>'); process.exit(1); }

const DATA_DIR = path.join(__dirname, '..', 'data');
const FE_LOOKUP_PATH = path.join(DATA_DIR, 'fe-lookup.json');

function attioRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.attio.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function fetchAllPeople() {
  const allRecords = [];
  let offset = 0;
  let page = 0;

  while (true) {
    page++;
    const body = {
      filter: {
        created_at: { $gte: '2026-03-21T00:00:00.000Z' }
      },
      sorts: [{ attribute: 'created_at', direction: 'asc' }],
      limit: 50,
      offset,
    };

    console.log(`Fetching people page ${page} (offset ${offset})...`);
    const resp = await attioRequest('POST', '/v2/objects/people/records/query', body);

    if (!resp.data) {
      console.error('Unexpected response:', JSON.stringify(resp).slice(0, 300));
      break;
    }

    allRecords.push(...resp.data);
    console.log(`  Got ${resp.data.length} records (total: ${allRecords.length})`);

    if (resp.data.length < 50) break;
    offset += resp.data.length;
  }

  return allRecords;
}

function extractValue(values, key) {
  const arr = values?.[key];
  if (!arr || !arr.length) return '';
  const v = arr[0];
  // Handle different Attio value types
  if (v.full_name) return v.full_name;
  if (v.first_name && v.last_name) return `${v.first_name} ${v.last_name}`.trim();
  if (v.email_address) return v.email_address;
  if (v.value) return v.value;
  if (v.option?.title) return v.option.title;
  if (v.original_url) return v.original_url;
  if (typeof v === 'string') return v;
  return '';
}

function extractLinkedin(values) {
  // Check linkedin field or social links
  const linkedin = values?.linkedin || values?.linkedin_url || [];
  for (const v of linkedin) {
    if (v.original_url) return v.original_url;
    if (v.value) return v.value;
  }
  return '';
}

function normaliseLinkedin(url) {
  if (!url) return '';
  return url.toLowerCase().replace(/\/$/, '').replace(/\?.*$/, '');
}

async function fetchCompanyDetails(companyRecordId) {
  try {
    const resp = await attioRequest('GET', `/v2/objects/companies/records/${companyRecordId}`);
    if (!resp.data) return {};
    const v = resp.data.values || {};
    return {
      company_name: extractValue(v, 'name'),
      company_url: extractValue(v, 'domains') || extractValue(v, 'website'),
      company_description: extractValue(v, 'description'),
    };
  } catch (e) {
    console.warn(`  Company fetch failed for ${companyRecordId}: ${e.message}`);
    return {};
  }
}

async function main() {
  // Load FE lookup
  let feLookup = {};
  if (fs.existsSync(FE_LOOKUP_PATH)) {
    feLookup = JSON.parse(fs.readFileSync(FE_LOOKUP_PATH, 'utf8'));
    console.log(`Loaded ${Object.keys(feLookup).length} FullEnrich entries`);
  }

  // Fetch people from Attio
  const people = await fetchAllPeople();
  console.log(`Total people fetched: ${people.length}`);

  // Process each person
  const contacts = [];
  const companyCache = {};

  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const v = p.values || {};
    const recordId = p.id?.record_id || '';

    const name = extractValue(v, 'name');
    const email = extractValue(v, 'email_addresses');
    const jobTitle = extractValue(v, 'job_title');
    const linkedinUrl = extractLinkedin(v);
    const confidence = extractValue(v, 'match_confidence_7') || extractValue(v, 'match_confidence');
    const roleType = extractValue(v, 'talent_role') || extractValue(v, 'role_type');
    const description = extractValue(v, 'description') || '';

    // Get company info from linked company record
    let companyInfo = {};
    const companyRefs = v.company || [];
    if (companyRefs.length > 0) {
      const compRecId = companyRefs[0].target_record_id;
      if (compRecId) {
        if (companyCache[compRecId]) {
          companyInfo = companyCache[compRecId];
        } else {
          companyInfo = await fetchCompanyDetails(compRecId);
          companyCache[compRecId] = companyInfo;
          // Rate limit
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    // Join with FullEnrich
    const normUrl = normaliseLinkedin(linkedinUrl);
    const feData = feLookup[normUrl] || {};

    const contact = {
      record_id: recordId,
      name,
      company_name: companyInfo.company_name || '',
      company_url: companyInfo.company_url || '',
      job_title: jobTitle,
      email,
      linkedin_url: linkedinUrl,
      confidence,
      role_type: roleType,
      description,
      linkedin_summary: feData['summary (Linkedin)'] || feData['Summary (Linkedin)'] || '',
      linkedin_headline: feData['Headline (Linkedin)'] || '',
      linkedin_company: feData['Company Name (Linkedin)'] || '',
      company_description: companyInfo.company_description || feData['Company Description (Linkedin)'] || '',
    };

    contacts.push(contact);

    if ((i + 1) % 10 === 0) {
      console.log(`  Processed ${i + 1}/${people.length}`);
    }
  }

  // Sort by company then name
  contacts.sort((a, b) => {
    const cmp = (a.company_name || '').localeCompare(b.company_name || '');
    return cmp !== 0 ? cmp : (a.name || '').localeCompare(b.name || '');
  });

  // Write output
  const outPath = path.join(DATA_DIR, 'eval-contacts.json');
  fs.writeFileSync(outPath, JSON.stringify(contacts, null, 2));
  console.log(`\nWritten ${contacts.length} contacts to eval-contacts.json`);
  console.log(`Companies cached: ${Object.keys(companyCache).length}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
