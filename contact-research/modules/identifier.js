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
    return {
      name: null,
      title: null,
      company: companyName,
      linkedinUrl,
      confidence: 'High',
      source: 'provided'
    };
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

    // Try to extract structured data from the text
    const nameMatch = textContent.match(/(?:name|Name)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
    const titleMatch = textContent.match(/(?:title|Title|role|Role|position)[:\s]+([^\n,]+)/i);
    const linkedinMatch = textContent.match(/(?:linkedin\.com\/in\/[^\s)"\]]+)/i);

    const name = nameMatch?.[1]?.trim() || null;
    const title = titleMatch?.[1]?.trim() || null;
    const foundLinkedin = linkedinMatch ? `https://www.${linkedinMatch[0]}` : null;

    return {
      name,
      title,
      company: companyName,
      linkedinUrl: foundLinkedin,
      confidence: name ? (title ? 'High' : 'Medium') : 'Low',
      source: 'web_search',
      targetTitlesSearched: titleList
    };
  } catch (err) {
    console.error('[identifier] web search error:', err.message);
    return { name: null, title: null, company: companyName, linkedinUrl: null, confidence: 'Low', source: 'web_search_error' };
  }
}
