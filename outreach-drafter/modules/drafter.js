import axios from 'axios';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __dirname_drafter = dirname(fileURLToPath(import.meta.url));
function _getDrafterProfile() {
  return JSON.parse(readFileSync(join(__dirname_drafter, '..', '..', 'config', 'user-profile.json'), 'utf8'));
}

const SYSTEM_PROMPT = `You are drafting outreach emails for ${_getDrafterProfile().name}. You must follow these rules exactly:
- ${_getDrafterProfile().proof_point_order_rule || 'Follow the proof point ordering from the positioning document'}
- Under {wordCountTarget} words total (subject line not counted)
- Problem-led opening — reference something real and specific about the company or contact
- No em-dashes (use commas or full stops instead)
- No Oxford commas
- No compound adjective hyphens
- No "I am reaching out" or "I hope this finds you well" openers
- End with a low-friction ask: "Would a brief call make sense?" or similar
- Never invent facts — only reference what is in the provided research context
- If no research is provided, write a positioning-only email and flag it as generic

Return ONLY a JSON object: { "subject": "...", "body": "..." }
No preamble, no explanation, no markdown fences.`;

export async function generateDraft({ contact, research, templatePrompt, wordCountTarget = 200 }) {
  const positioningPath = process.env.POSITIONING_DOC_PATH;
  let positioning = '';
  try {
    positioning = readFileSync(positioningPath, 'utf-8');
  } catch (err) {
    console.error('[drafter] Could not read POSITIONING.md:', err.message);
    positioning = 'No positioning document available.';
  }

  const systemPrompt = SYSTEM_PROMPT.replace('{wordCountTarget}', wordCountTarget);

  const researchSection = research
    ? `## Research context
Company description: ${research.companyDescription || 'N/A'}
Signal: ${research.signal || 'N/A'}
Scoring rationale: ${research.scoringRationale || 'N/A'}
Key facts: ${research.keyFacts || 'N/A'}
Interview prep summary: ${research.interviewPrepSummary || 'N/A'}`
    : '## Research context\nNo research provided. Write a positioning-only email. Add a note that this is generic.';

  const userPrompt = `## Positioning document
${positioning}

## Contact
Name: ${contact.name || 'Unknown'}
Title: ${contact.title || 'Unknown'}
Company: ${contact.company || 'Unknown'}
Campaign type: ${contact.campaignType || 'pe_vc'}

${researchSection}

## Template structure
${templatePrompt || 'Opening: 1-2 sentences referencing a specific challenge or moment at the company. Proof points: 2-3 bullets, strongest proof point first. Ask: one sentence, low friction.'}

## Word count target: ${wordCountTarget} words

Generate the outreach email now.`;

  const r = await axios.post('https://api.anthropic.com/v1/messages',
    {
      model: process.env.SONNET_MODEL || 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      timeout: 30000
    }
  );

  let textContent = '';
  for (const block of r.data.content || []) {
    if (block.type === 'text') textContent += block.text;
  }

  // Parse JSON response
  let parsed;
  try {
    // Strip markdown fences if present
    const cleaned = textContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse draft response as JSON: ${textContent.substring(0, 200)}`);
  }

  const body = parsed.body || '';
  const wordCount = body.split(/\s+/).filter(w => w.length > 0).length;
  const warnings = [];

  if (wordCount > wordCountTarget) {
    warnings.push(`Word count (${wordCount}) exceeds target (${wordCountTarget})`);
  }
  if (!research) {
    warnings.push('No research provided — positioning-only draft');
  }

  return {
    subject: parsed.subject || 'No subject',
    body,
    wordCount,
    warnings
  };
}

export async function regenerateSection({ currentBody, section, instruction, contact, wordCountTarget = 200 }) {
  const positioningPath = process.env.POSITIONING_DOC_PATH;
  let positioning = '';
  try {
    positioning = readFileSync(positioningPath, 'utf-8');
  } catch {}

  const sectionMap = {
    opening: 'the opening 1-2 sentences',
    proofpoints: 'the proof points section (maintain proof point ordering from positioning document)',
    ask: 'the closing ask sentence'
  };

  const userPrompt = `## Current email body
${currentBody}

## Task
Rewrite ONLY ${sectionMap[section] || section} of this email.
${instruction ? `Additional instruction: ${instruction}` : ''}
Keep all other sections exactly as they are.
Contact: ${contact.name} at ${contact.company} (${contact.title})

## Positioning reference
${positioning}

Return ONLY a JSON object: { "body": "..." } with the full rewritten email body.
No preamble, no explanation, no markdown fences.`;

  const r = await axios.post('https://api.anthropic.com/v1/messages',
    {
      model: process.env.SONNET_MODEL || 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: SYSTEM_PROMPT.replace('{wordCountTarget}', wordCountTarget),
      messages: [{ role: 'user', content: userPrompt }]
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      timeout: 30000
    }
  );

  let textContent = '';
  for (const block of r.data.content || []) {
    if (block.type === 'text') textContent += block.text;
  }

  const cleaned = textContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);
  const body = parsed.body || currentBody;
  const wordCount = body.split(/\s+/).filter(w => w.length > 0).length;

  return { body, wordCount };
}
