import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getModel } = require('../../shared/models.cjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

function _getProfile() {
  return JSON.parse(readFileSync(join(__dirname, '../../config/user-profile.json'), 'utf8'));
}

const AUDIT_SYSTEM_PROMPT = readFileSync(
  new URL('../../config/prompts/research-general-audit.md', import.meta.url), 'utf8'
).replace(/^#[^\n]*\n/gm, '').trim();

export async function runAudit({ priorResearch, taskContext, explicitQuestions, namedPeople, researchType }) {
  const userMsg = [
    `## TASK CONTEXT\n${taskContext || `Executive job search research for ${_getProfile().name}.`}`,
    `## PRIOR RESEARCH (Perplexity Stage 1 output)\n${priorResearch}`,
    explicitQuestions ? `## EXPLICIT QUESTIONS TO RESOLVE\n${explicitQuestions}` : '',
    namedPeople ? `## NAMED PEOPLE\n${namedPeople}` : '',
    `## OUTPUT GOAL\nDecision-grade brief for ${_getProfile().name}'s job search. Research type: ${researchType || 'general'}.`
  ].filter(Boolean).join('\n\n');

  const response = await client.messages.create({
    model: getModel('synthesis'),
    max_tokens: 4000,
    system: AUDIT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }]
  }, {
    timeout: 180000
  });

  return response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}
