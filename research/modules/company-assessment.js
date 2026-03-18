import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getModel } = require('../../shared/models.cjs');
import { deepResearch } from './perplexity.js';
import { logActivity } from '../../shared/activityLogger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Stage 2: audit the Stage 1 claim ledger via Claude Sonnet + web_search
async function auditAssessment(stage1Output, auditVars) {
  const { companyName, geography, sector, interviewers, today } = auditVars;

  const templatePath = join(__dirname, '../../config/prompts/research-company-audit.md');
  const template = await readFile(templatePath, 'utf-8');

  // Build interviewer list string
  let interviewerList = 'None provided';
  if (interviewers && interviewers.length > 0) {
    interviewerList = interviewers
      .map((iv, i) => {
        const label = iv.title ? `${iv.name} (${iv.title})` : iv.name;
        return `${i + 1}. ${label}`;
      })
      .join('\n');
  }

  const auditPrompt = template
    .replace(/{TODAY}/g, today)
    .replace(/{COMPANY_NAME}/g, companyName)
    .replace(/{GEOGRAPHY}/g, geography || 'Unknown')
    .replace(/{SECTOR}/g, sector || 'Unknown')
    .replace(/{INTERVIEWER_LIST}/g, interviewerList)
    .replace(/{STAGE_1_OUTPUT}/g, stage1Output);

  // Direct Claude API call with web_search tool
  // 180s timeout: audit may run 6-10 targeted web searches
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'interleaved-thinking-2025-05-14'
      },
      body: JSON.stringify({
        model: getModel('synthesis'),
        max_tokens: 8000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: auditPrompt }]
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Audit API error ${response.status}: ${errText}`);
  }

  const data = await response.json();

  // Extract text blocks only (ignore tool_use/tool_result blocks)
  const auditOutput = (data.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  return auditOutput;
}

export async function runCompanyAssessment(input) {
  const {
    companyName,
    website = 'Unknown',
    geography = 'Unknown',
    sector = 'Unknown',
    interviewerNames = 'None provided',
    recruiterNotes = 'None provided',
    emailInviteText = 'None provided',
    jobPostUrl = 'None provided',
    peSponsors = 'None provided',
    panelTitles = 'None provided',
    attachments = [],   // array of { filename: string, content: string }
    interviewers = []   // array of { name: string, title?: string }
  } = input;

  const today = new Date().toISOString().split('T')[0];

  // --- STAGE 1: Perplexity deep research ---
  const templatePath = join(__dirname, '../../config/prompts/research-company-assessment.md');
  let template = await readFile(templatePath, 'utf-8');

  // Build attachments section
  let attachmentsSection = '';
  if (attachments.length > 0) {
    attachmentsSection = '\nATTACHED DOCUMENTS (use these as primary context):\n';
    for (const att of attachments) {
      attachmentsSection += `\n--- ${att.filename} ---\n${att.content}\n`;
    }
  }

  // Build legacy interviewerNames string for Stage 1 template compatibility
  const interviewerNamesStr = interviewers.length > 0
    ? interviewers.map(iv => iv.title ? `${iv.name} (${iv.title})` : iv.name).join(', ')
    : (interviewerNames || 'None provided');

  const stage1Prompt = template
    .replace(/{TODAY}/g, today)
    .replace(/{COMPANY_NAME}/g, companyName)
    .replace(/{COMPANY_WEBSITE}/g, website)
    .replace(/{GEOGRAPHY}/g, geography)
    .replace(/{SECTOR}/g, sector)
    .replace(/{INTERVIEWER_NAMES}/g, interviewerNamesStr)
    .replace(/{RECRUITER_NOTES}/g, recruiterNotes)
    .replace(/{EMAIL_INVITE}/g, emailInviteText)
    .replace(/{JOB_POST_URL}/g, jobPostUrl)
    .replace(/{PE_SPONSORS}/g, peSponsors)
    .replace(/{PANEL_TITLES}/g, panelTitles)
    .replace(/{ATTACHMENTS_SECTION}/g, attachmentsSection);

  const stage1Output = await deepResearch(stage1Prompt, 8000);

  await logActivity({
    agent: 'research-hub',
    action: 'company_assessment_stage1_completed',
    company: companyName,
    result: 'success',
    detail: `Stage 1 deep research completed for ${companyName}`
  });

  // --- STAGE 2: Claude Sonnet audit + interviewer profiling ---
  let auditOutput = '';
  try {
    auditOutput = await auditAssessment(stage1Output, {
      companyName, geography, sector, interviewers, today
    });

    await logActivity({
      agent: 'research-hub',
      action: 'company_assessment_stage2_completed',
      company: companyName,
      result: 'success',
      detail: `Stage 2 audit completed for ${companyName}`
    });
  } catch (err) {
    console.error('Stage 2 audit failed (non-fatal):', err.message);
    auditOutput = `## Audit Stage Error\n\nStage 2 audit could not be completed: ${err.message}\n\nThe Stage 1 assessment above is still valid.`;
  }

  // Combine both stages into final output
  const combinedOutput = [
    `# Company Assessment: ${companyName}`,
    `*Generated: ${today}*`,
    '',
    '---',
    '',
    '## STAGE 1 — Deep Research Assessment',
    '',
    stage1Output,
    '',
    '---',
    '',
    '## STAGE 2 — Claim Audit and Interviewer Profiles',
    '',
    auditOutput
  ].join('\n');

  return { stage1Output, auditOutput, combinedOutput };
}
