import axios from 'axios';
import { readFileSync } from 'fs';
import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getModel } = require('../../shared/models.cjs');

function _getContactIdPrompt() {
  return readFileSync(
    new URL('../../config/prompts/contact-identification.md', import.meta.url), 'utf8'
  ).replace(/^#[^\n]*\n/gm, '').trim();
}

/**
 * Parse the LLM's identify response text into an array of contact objects.
 * Tries JSON.parse first; falls back to regex extraction with Low confidence.
 * @param {string} text - raw LLM response text
 * @param {string} companyName - the company being researched
 * @returns {Array<{name, title, company, linkedinUrl, confidence, source, role_rationale, targetTitlesSearched}>}
 */
export function parseIdentifyResponse(text, companyName) {
  if (!text || !text.trim()) return [];

  // Try JSON parse on the full text
  try {
    // Strip markdown code fences if present
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(cleaned);
    const contactsArr = parsed.contacts || [];
    if (Array.isArray(contactsArr) && contactsArr.length > 0) {
      return contactsArr.slice(0, 3).map(c => ({
        name: c.name || null,
        title: c.title || null,
        company: c.company_or_firm || companyName,
        linkedinUrl: c.linkedin_url || null,
        confidence: c.confidence || 'Medium',
        source: 'web_search',
        role_rationale: c.why_selected || '',
        targetTitlesSearched: ''
      }));
    }
    // Parsed OK but empty contacts array
    return [];
  } catch (_jsonErr) {
    // JSON parse failed — fall back to regex extraction
    const nameMatch = text.match(/(?:name|Name)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
    const titleMatch = text.match(/(?:title|Title|role|Role|position)[:\s]+([^\n,]+)/i);
    const linkedinMatch = text.match(/(?:linkedin\.com\/in\/[^\s)"\]]+)/i);

    const name = nameMatch?.[1]?.trim() || null;
    const title = titleMatch?.[1]?.trim() || null;
    const foundLinkedin = linkedinMatch ? `https://www.${linkedinMatch[0]}` : null;

    if (!name && !title && !foundLinkedin) return [];

    return [{
      name,
      title,
      company: companyName,
      linkedinUrl: foundLinkedin,
      confidence: 'Low',
      source: 'web_search',
      role_rationale: '',
      targetTitlesSearched: ''
    }];
  }
}

const TITLE_PRIORITY = {
  portfolio_cpo: ['CPO', 'VP Product', 'Head of Product', 'Chief Digital Officer'],
  portfolio_coo: ['COO', 'CEO', 'Founder'],
  pe_vc: ['Operating Partner', 'Managing Partner', 'Partner'],
  exec_search: ['Partner', 'Managing Director'],
  interim_provider: ['Managing Director', 'Practice Lead']
};

export async function identifyContact({ companyName, campaignType, linkedinUrl, researchContext = '' }) {
  const CONTACT_ID_PROMPT = _getContactIdPrompt();
  // Path B — LinkedIn URL already known
  if (linkedinUrl) {
    return [{
      name: null,
      title: null,
      company: companyName,
      linkedinUrl,
      confidence: 'High',
      source: 'provided',
      role_rationale: ''
    }];
  }

  // Path A — LLM web search
  const targetTitles = TITLE_PRIORITY[campaignType] || TITLE_PRIORITY.pe_vc;
  const titleList = targetTitles.join(', ');

  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages',
      {
        model: getModel('synthesis'),
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        tool_choice: { type: 'any' },
        messages: [{
          role: 'user',
          content: CONTACT_ID_PROMPT
            .replace(/\{COMPANY_NAME\}/g, companyName)
            .replace('{CAMPAIGN_TYPE}', campaignType)
            .replace('{TITLE_LIST}', titleList)
            .replace(/\{RESEARCH_CONTEXT\}/g, researchContext
              ? '## Research Hub Brief\n\n' + researchContext
              : '')
        }]
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        timeout: 60000
      }
    );

    // Extract text content from response
    let textContent = '';
    for (const block of r.data.content || []) {
      if (block.type === 'text') textContent += block.text;
    }

    // Parse structured JSON response (with regex fallback)
    const contacts = parseIdentifyResponse(textContent, companyName);

    // Add titleList to each contact
    for (const c of contacts) {
      c.targetTitlesSearched = titleList;
    }

    // Return array of contacts; if empty, return single fallback
    if (contacts.length > 0) return contacts;

    return [{
      name: null,
      title: null,
      company: companyName,
      linkedinUrl: null,
      confidence: 'Low',
      source: 'web_search',
      role_rationale: '',
      targetTitlesSearched: titleList
    }];
  } catch (err) {
    console.error('[identifier] web search error:', err.message);
    return [{ name: null, title: null, company: companyName, linkedinUrl: null, confidence: 'Low', source: 'web_search_error', role_rationale: '' }];
  }
}
