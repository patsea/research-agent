// contact-research/modules/attio.js
// Attio upsert for confirmed PE/VC contacts (Track 2A/2B)
// Pitfall 440: ESM agents use createRequire
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');

const ATTIO_API = 'https://api.attio.com/v2';

function getApiKey() {
  return process.env.ATTIO_API_KEY;
}

function getFields() {
  const fieldsPath = path.join(process.cwd(), 'config', 'attio-fields.json');
  return JSON.parse(fs.readFileSync(fieldsPath, 'utf8')); // call-time read (Pitfall 445)
}

async function upsertCompany({ name, domain, firmType, geography }) {
  const key = getApiKey();
  if (!key || !domain) return null;
  const body = {
    matching_attribute: 'domains',
    data: {
      values: {
        name,
        domains: [domain],
        firm_type: firmType || 'VC/PE',
        ...(geography && { geography })
      }
    }
  };
  const res = await fetch(`${ATTIO_API}/objects/companies/records`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Attio company upsert failed: ${res.status}`);
  const data = await res.json();
  return data.data?.id?.record_id ?? null;
}

async function upsertPerson({ firstName, lastName, title, linkedinUrl,
  companyRecordId, geography, talentRole, matchConfidence, roleRationale,
  campaignType }) {
  const key = getApiKey();
  if (!key || !firstName) return null;
  const values = {
    name: [{ first_name: firstName, last_name: lastName,
              full_name: `${firstName} ${lastName}` }],
    job_title: title,
    talent_role: talentRole || 'Operating',
    status_8: 'Not contacted',
    source_8: 'Perplexity',
    ...(linkedinUrl && { linkedin: linkedinUrl }),
    ...(matchConfidence && { match_confidence: matchConfidence }),
    ...(geography && { geography }),
    ...(roleRationale && { description: roleRationale }),
    ...(companyRecordId && { company: [{ target_object: 'companies',
      target_record_id: companyRecordId }] })
  };
  const body = { matching_attribute: 'linkedin', data: { values } };
  // Fall back to name-based upsert if no LinkedIn
  const matchAttr = linkedinUrl ? 'linkedin' : 'name';
  body.matching_attribute = matchAttr;
  const res = await fetch(`${ATTIO_API}/objects/people/records`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Attio person upsert failed: ${res.status}`);
  const data = await res.json();
  return data.data?.id?.record_id ?? null;
}

export { upsertCompany, upsertPerson };
