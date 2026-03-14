import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { deepResearch } from './perplexity.js';
import { researchRuns } from '../db.js';

const __dirname_fr = dirname(fileURLToPath(import.meta.url));
function _getProfile() {
  return JSON.parse(readFileSync(join(__dirname_fr, '../../config/user-profile.json'), 'utf8'));
}

export async function runFirmResearch(input) {
  const { firmName, firmType, contactName, contactRole, notes } = input;
  if (!firmName || !firmType) throw new Error('firmName and firmType required');

  const today = new Date().toISOString().split('T')[0];

  let prompt = '';
  if (firmType === 'PE/VC') {
    prompt = `Research the private equity / venture capital firm "${firmName}" comprehensively. Today is ${today}. Focus on information from 2024-2026.

Please provide a structured research report in markdown with the following sections:

## Fund Overview
AUM, vintage year of current fund, investment thesis, geographic focus, stage focus (buyout, growth, venture), sector preferences.

## Portfolio
Current active portfolio companies (not exited). For each: company name, sector, approximate size, year acquired/invested. Also list recent acquisitions (last 2 years) and recent exits.

## Operating Partner / Value Creation Team
Who they are, their backgrounds, what they do for portfolio companies, how they add value post-acquisition. Names and roles.

## Investment Thesis Detail
Why they buy what they buy. What transformation they drive post-acquisition. Operating playbook themes (digitisation, AI, product-led growth, consolidation).

## CPO/COO Opportunity Angle
Which current portfolio companies might have a gap for a CPO or COO role? Look for:
- Companies with technical founders but no senior product hire
- Companies going through digital transformation or AI adoption
- Companies 6-18 months post-acquisition where operating improvements are being implemented
- Companies with recent leadership changes
Provide specific company names with reasoning.

## Key People
Managing partners, operating partners, talent partners, portfolio operations leads. Names, roles, and LinkedIn profiles if known.

${contactName ? `\n## Contact Context\nThe candidate is in contact with ${contactName}${contactRole ? ` (${contactRole})` : ''} at this firm.${notes ? ` Context: ${notes}` : ''}` : ''}`;
  } else {
    prompt = `Research the executive search firm "${firmName}" comprehensively. Today is ${today}. Focus on information from 2024-2026.

Please provide a structured research report in markdown with the following sections:

## Firm Overview
Size (number of partners/consultants), geographic coverage, sector specialisms, fee structure (retained/contingent), notable clients.

## Relevant Mandates
Any publicly known CPO, COO, Chief Product Officer, or AI leadership mandates in the last 12 months. Technology sector focus.

## Key Contacts
Who runs the digital, product, technology, or AI practice? Names, roles, office locations.

## Placement Record
Known placements in PE-backed tech companies, SaaS companies, or AI companies. Senior product and operations roles specifically.

## Candidate Fit Angle
How would a candidate with this profile map to their typical mandates?
${(() => { const p = _getProfile(); return `- ${p.roles[0]?.title || 'CPO/COO'} with ${p.ai_experience}\n- PE-backed transformation track record (${p.roles[0]?.company}: ${p.roles[0]?.highlight})\n- ${p.education}, ${p.location.split(' —')[0]}, open to relocation\n- Sweet spot: ${p.positioning}`; })()}

${contactName ? `\n## Contact Context\nThe candidate is in contact with ${contactName}${contactRole ? ` (${contactRole})` : ''} at this firm.${notes ? ` Context: ${notes}` : ''}` : ''}`;
  }

  console.log(`Running Perplexity deep research on ${firmName} (${firmType})...`);
  const markdown = await deepResearch(prompt, 4000);
  console.log(`Deep research complete: ${markdown.length} chars`);

  // Save output
  const safeName = `${firmName}-${today}`
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const outputDir = process.env.RESEARCH_OUTPUT_DIR || './research';
  const outputPath = join(outputDir, 'firm-research', `${safeName}.md`);

  mkdirSync(join(outputDir, 'firm-research'), { recursive: true });
  writeFileSync(outputPath, `# Firm Research: ${firmName}\n\n**Type**: ${firmType}\n**Date**: ${today}\n${contactName ? `**Contact**: ${contactName}${contactRole ? ` (${contactRole})` : ''}\n` : ''}\n---\n\n${markdown}`, 'utf8');
  console.log(`Saved to ${outputPath}`);

  const runId = researchRuns.insert({
    company_name: firmName,
    role_title: firmType,
    context_type: 'firm_research',
    interview_stage: 'n/a',
    output_path: outputPath
  });

  return { runId, outputPath, markdown };
}
