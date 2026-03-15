import axios from 'axios';
import 'dotenv/config';

const API_URL = 'https://api.fullenrich.com/v1/enrich';

export async function enrichContact({ name, company, linkedinUrl, companyDomain }) {
  const apiKey = process.env.FULLENRICH_API_KEY;

  // Mock mode if key not configured
  if (!apiKey || apiKey.startsWith('REPLACE')) {
    console.log('[enricher] FullEnrich API key not configured — returning mock data');
    return {
      found: true,
      mock: true,
      email: `mock-${(name || 'contact').toLowerCase().replace(/\s+/g, '.')}@${(company || 'example').toLowerCase().replace(/\s+/g, '')}.com`,
      emailStatus: 'Unverified',
      linkedinUrl: linkedinUrl || null,
      fullName: name || 'Mock Contact',
      jobTitle: 'Mock Title',
      companyName: company || 'Mock Company',
      confidenceScore: 0
    };
  }

  // Build request body based on available data
  let body;
  if (linkedinUrl) {
    body = { linkedin_url: linkedinUrl };
  } else if (name) {
    const parts = name.trim().split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ') || '';
    const domain = companyDomain || (company ? company.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '') + '.com' : null);
    if (!domain) return { found: false, error: 'No company domain derivable' };
    body = { first_name: firstName, last_name: lastName, company_domain: domain };
  } else {
    return { found: false, error: 'No name or LinkedIn URL provided' };
  }

  try {
    const r = await axios.post(API_URL, body, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const data = r.data;
    return {
      found: true,
      email: data.email || null,
      emailStatus: data.email_status || 'Unverified',
      linkedinUrl: data.linkedin_url || linkedinUrl || null,
      fullName: data.full_name || name,
      jobTitle: data.job_title || null,
      companyName: data.company_name || company,
      confidenceScore: data.confidence_score || 0
    };
  } catch (err) {
    if (err.response?.status === 404) {
      return { found: false, email: null, error: 'not_found' };
    }
    if (err.response?.status === 429) {
      console.error('[enricher] FullEnrich rate limited');
      return { found: false, email: null, error: 'rate_limited' };
    }
    console.error('[enricher] FullEnrich error:', err.message);
    return { found: false, email: null, error: err.message };
  }
}
