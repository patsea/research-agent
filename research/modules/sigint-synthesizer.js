import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getSigintDb } from './sigint-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '../prompts/SIGINT_WEEKLY_BRIEFING.md');
const PROFILE_PATH = join(__dirname, '../../config/user-profile.json');
const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

function _getProfile() {
  return JSON.parse(readFileSync(PROFILE_PATH, 'utf8'));
}

export async function synthesizeBriefing(daysBack = 7) {
  const db = getSigintDb();
  const since = new Date(Date.now() - daysBack * 86400000).toISOString();
  const items = db.prepare(
    `SELECT ci.*, s.name as source_name FROM content_items ci
     JOIN sources s ON ci.source_id = s.id
     WHERE ci.fetched_at > ?
     ORDER BY s.priority DESC, ci.published_at DESC LIMIT 100`
  ).all(since);

  if (items.length === 0) {
    return { success: false, error: 'No content items found — run /api/sigint/fetch first' };
  }

  const contentBlock = items.map(i =>
    `**${i.title}** (${i.source_name})\n${i.summary || ''}\nURL: ${i.url}`
  ).join('\n\n---\n\n');

  const profile = _getProfile();
  const candidateBrief = `${profile.name} — ${profile.title || 'CPO/COO'}, ${profile.yearsExperience || ''} years experience, ${profile.location || ''}`;
  const prompt = readFileSync(PROMPT_PATH, 'utf8')
    .replace('{content}', contentBlock)
    .replace('{{CANDIDATE_BRIEF}}', candidateBrief)
    .replace('{{CANDIDATE_SECTORS}}', (profile.targetSectors || []).join(', ') || 'PE/VC-backed tech companies, AI transformation')
    .replace('{{CANDIDATE_GEOGRAPHIES}}', (profile.targetGeographies || []).join(', ') || 'Europe');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  }, { timeout: 180000 });

  const content = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const weekStart = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];
  const weekEnd = new Date().toISOString().split('T')[0];

  const result = db.prepare(
    'INSERT INTO briefings (title, week_start, week_end, content) VALUES (?, ?, ?, ?)'
  ).run(`Weekly Briefing ${weekEnd}`, weekStart, weekEnd, content);

  for (const item of items.slice(0, 20)) {
    db.prepare('INSERT OR IGNORE INTO briefing_sources (briefing_id, content_item_id) VALUES (?, ?)')
      .run(result.lastInsertRowid, item.id);
  }

  return {
    success: true,
    briefingId: result.lastInsertRowid,
    wordCount: content.split(/\s+/).length,
    itemCount: items.length,
    weekStart,
    weekEnd
  };
}
