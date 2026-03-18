import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getModel } = require('../../shared/models.cjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
import { search } from './websearch.js';
import { searchMeetingsByCompany, getMeetingTranscript } from './granola.js';
import { CV, formatProofPoints } from './cv.js';
import { researchRuns } from '../db.js';
import { buildSystemPrompt } from './prompt-builder.js';

export async function runInterviewPrep(input, stage = 'recruiter_screen') {
  const { companyName, roleTitle, jobDescriptionText, recruiterName, notes } = input;

  // 1. Run 8 parallel web searches
  const queries = [
    `${companyName} company overview funding employees`,
    `${companyName} product features customers`,
    `${companyName} investors PE VC ownership`,
    `${companyName} competitors market`,
    `${companyName} news 2024 2025`,
    `${companyName} CEO founder leadership`,
    `${companyName} CPO CTO product technology`
  ];
  if (!jobDescriptionText) {
    queries.push(`${roleTitle} ${companyName} job description requirements`);
  }

  console.log(`Running ${queries.length} parallel web searches for ${companyName}...`);
  const searchResults = await Promise.allSettled(queries.map(q => search(q, 10)));

  const allResults = searchResults
    .filter(r => r.status === 'fulfilled')
    .flatMap((r, i) => r.value.map(v => ({
      query: queries[i],
      title: v.title,
      url: v.url,
      snippet: (v.snippet || '').slice(0, 500)
    })));
  console.log(`Web search complete: ${allResults.length} results across ${queries.length} queries`);

  // 2. Check Granola for past meetings
  let granolaNotes = '';
  try {
    const meetings = await searchMeetingsByCompany(companyName);
    if (meetings.length > 0) {
      console.log(`Found ${meetings.length} Granola meetings mentioning ${companyName}`);
      const recent = meetings.slice(0, 3);
      const transcripts = await Promise.all(
        recent.map(m => getMeetingTranscript(m.id))
      );
      granolaNotes = recent.map((m, i) =>
        `## Meeting: ${m.title} (${m.date || 'date unknown'})\n${transcripts[i]}`
      ).join('\n\n---\n\n');
    }
  } catch (err) {
    console.log('Granola search skipped:', err.message);
  }

  // 3. Load template
  const templatePath = join(__dirname, '..', '..', 'config', 'prompts', 'research-interview-prep-template.md');
  let template = '';
  try {
    template = readFileSync(templatePath, 'utf8');
    // Replace template variables with profile values
    template = template.replace(/\{\{CANDIDATE_NAME\}\}/g, CV.name);
  } catch (err) {
    console.log('Template not found at', templatePath, '— using system prompt only');
  }

  // 4. Stage calibration
  let stageInstruction = '';
  if (stage === 'recruiter_screen') {
    stageInstruction = 'Populate Part 1 and Part 2 fully. For the Appendix, include only sections A, B, and F with brief content (3-5 bullets each). Skip other appendix sections.';
  } else if (stage === 'hiring_manager') {
    stageInstruction = 'Populate the full document: Part 1, Part 2, and all Appendix sections (A through H).';
  } else if (stage === 'final_round') {
    stageInstruction = 'Populate the full document: Part 1, Part 2, all Appendix sections, plus Appendix I with a detailed 30/60/90 day plan tailored to this specific role and company.';
  }

  // 5. Load system prompt from file and inject profile values
  const systemPromptPath = join(__dirname, '..', '..', 'config', 'prompts', 'research-interview-prep-system.md');
  let systemPrompt = '';
  try {
    const rawPrompt = readFileSync(systemPromptPath, 'utf8');
    systemPrompt = buildSystemPrompt(rawPrompt, CV);
  } catch {
    systemPrompt = `You are preparing a ${CV.roles[0]?.title || 'CPO/COO'} executive job search candidate for an interview. Produce a comprehensive, honest interview prep document in markdown format. Return ONLY the markdown, no preamble. Label every company fact as Verified / Inference / Unverified. Include at least one Weak rating in the Fit Assessment. Questions to ask must include at least one that could surface a dealbreaker. Writing rules: no compound adjective hyphens, no em-dashes, no Oxford commas. ${CV.proof_point_order_rule}`;
  }

  // 6. Build user message
  const searchBlock = allResults.map(r =>
    `[${r.query}] ${r.title}\n${r.url}\n${r.snippet}`
  ).join('\n\n');

  const userMessage = `
# Interview Prep Request

**Company:** ${companyName}
**Role:** ${roleTitle}
**Stage:** ${stage}
${recruiterName ? `**Recruiter:** ${recruiterName}` : ''}
${notes ? `**Notes:** ${notes}` : ''}

## Candidate Profile
${formatProofPoints()}
Education: ${CV.education}
Location: ${CV.location}
AI Experience: ${CV.ai_experience}
Positioning: ${CV.positioning}

## Stage Calibration
${stageInstruction}

${jobDescriptionText ? `## Job Description\n${jobDescriptionText}` : ''}

${template ? `## Interview Prep Template Structure\n${template}` : ''}

## Web Research Results
${searchBlock}

${granolaNotes ? `## Granola Meeting Notes\n${granolaNotes}` : ''}
`.trim();

  console.log(`Calling Claude claude-sonnet-4-6 for synthesis (${userMessage.length} chars input)...`);

  const r = await axios.post('https://api.anthropic.com/v1/messages',
    {
      model: getModel('synthesis'),
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      timeout: 360000  // 360s: Stage 1 (Perplexity, max 150s) + Stage 2 (Claude audit, max 180s) + 30s buffer
    }
  );

  const markdown = r.data.content?.[0]?.text || '';
  console.log(`Claude response: ${markdown.length} chars`);

  // 7. Save output
  const date = new Date().toISOString().split('T')[0];
  const safeName = `${companyName}-${roleTitle}-${date}`
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const outputDir = process.env.RESEARCH_OUTPUT_DIR || './research';
  const outputPath = join(outputDir, 'interview-prep', `${safeName}.md`);

  const { writeFileSync, mkdirSync } = await import('fs');
  mkdirSync(join(outputDir, 'interview-prep'), { recursive: true });
  writeFileSync(outputPath, markdown, 'utf8');
  console.log(`Saved to ${outputPath}`);

  // 8. Insert DB record
  const runId = researchRuns.insert({
    company_name: companyName,
    role_title: roleTitle,
    context_type: 'interview_prep',
    interview_stage: stage,
    output_path: outputPath
  });

  return { runId, outputPath, markdown };
}
