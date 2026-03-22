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
  const { companyName, geography, sector, interviewers, today,
          additionalMaterials, namedPeople, explicitQuestions } = auditVars;

  const templatePath = join(__dirname, '../../config/prompts/research-company-audit.md');
  const template = await readFile(templatePath, 'utf-8');

  // System prompt: only {COMPANY_NAME} exists in the audit template
  const systemPrompt = template.replace(/{COMPANY_NAME}/g, companyName);

  // Build interviewer list string for user message
  let interviewerList = '';
  if (interviewers && interviewers.length > 0) {
    interviewerList = '\n## Interviewers\n' + interviewers
      .map((iv, i) => {
        const label = iv.title ? `${iv.name} (${iv.title})` : iv.name;
        return `${i + 1}. ${label}`;
      })
      .join('\n');
  }

  // User message: all supplied materials passed as content
  const userMessage = [
    `Company: ${companyName}`,
    geography ? `Geography: ${geography}` : '',
    sector ? `Sector: ${sector}` : '',
    `Date: ${today}`,
    '',
    '## Prior Research',
    stage1Output || 'No prior research provided.',
    interviewerList,
    additionalMaterials ? `\n## Additional Materials\n${additionalMaterials}` : '',
    namedPeople ? `\n## Named People\n${namedPeople}` : '',
    explicitQuestions ? `\n## Explicit Questions\n${explicitQuestions}` : ''
  ].filter(Boolean).join('\n');

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
        system: systemPrompt,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: userMessage }]
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

  // Build research context from all available inputs
  const researchContextParts = [];
  if (interviewerNames && interviewerNames !== 'None provided') {
    researchContextParts.push(`Interviewers: ${interviewerNames}`);
  }
  if (interviewers.length > 0) {
    const interviewerNamesStr = interviewers.map(iv => iv.title ? `${iv.name} (${iv.title})` : iv.name).join(', ');
    researchContextParts.push(`Interviewers: ${interviewerNamesStr}`);
  }
  if (recruiterNotes && recruiterNotes !== 'None provided') {
    researchContextParts.push(`Recruiter notes: ${recruiterNotes}`);
  }
  if (emailInviteText && emailInviteText !== 'None provided') {
    researchContextParts.push(`Email invite: ${emailInviteText}`);
  }
  if (jobPostUrl && jobPostUrl !== 'None provided') {
    researchContextParts.push(`Job post URL: ${jobPostUrl}`);
  }
  if (peSponsors && peSponsors !== 'None provided') {
    researchContextParts.push(`PE sponsors: ${peSponsors}`);
  }
  if (panelTitles && panelTitles !== 'None provided') {
    researchContextParts.push(`Panel titles: ${panelTitles}`);
  }
  if (attachments.length > 0) {
    researchContextParts.push('ATTACHED DOCUMENTS:');
    for (const att of attachments) {
      researchContextParts.push(`--- ${att.filename} ---\n${att.content}`);
    }
  }
  const researchContext = researchContextParts.join('\n\n') || 'No additional context provided.';

  const stage1Prompt = template
    .replace(/{TODAY}/g, today)
    .replace(/{COMPANY_NAME}/g, companyName)
    .replace(/{COMPANY_WEBSITE}/g, website)
    .replace(/{GEOGRAPHY}/g, geography)
    .replace(/{SECTOR}/g, sector)
    .replace(/{RESEARCH_CONTEXT}/g, researchContext);

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
