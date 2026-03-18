import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getModel } = require('../../shared/models.cjs');
import { getSigintDb } from './sigint-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '../../config/prompts/research-sigint-briefing.md');
const PROFILE_PATH = join(__dirname, '../../config/user-profile.json');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function _getProfile() {
  return JSON.parse(readFileSync(PROFILE_PATH, 'utf8'));
}

async function fetchAgentDigest(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function synthesizeBriefing(daysBack = 7) {
  const db = getSigintDb();
  const since = new Date(Date.now() - daysBack * 86400000).toISOString();
  const items = db.prepare(
    `SELECT ci.*, s.name as source_name FROM content_items ci
     JOIN sources s ON ci.source_id = s.id
     WHERE ci.fetched_at > ?
     ORDER BY s.priority DESC, ci.published_at DESC LIMIT 30`
  ).all(since);

  if (items.length === 0) {
    return { success: false, error: 'No content items found — run /api/sigint/fetch first' };
  }

  const contentBlock = items.map(i =>
    `**${i.title}** (${i.source_name})\n${i.summary || ''}\nURL: ${i.url}`
  ).join('\n\n---\n\n');

  // Fetch cross-agent SIGINT intel (non-blocking — null if agent down)
  const [podcastItems, newsletterItems] = await Promise.all([
    fetchAgentDigest(`http://localhost:3040/api/digest/podcast?daysBack=${daysBack}`),
    fetchAgentDigest(`http://localhost:3041/api/digest/newsletter?daysBack=${daysBack}`)
  ]);

  // Build podcast section — top 10 by relevance_score, use takeaway + title
  let podcastContent = 'No podcast intel available this period.';
  if (podcastItems && podcastItems.length > 0) {
    const sorted = podcastItems
      .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
      .slice(0, 10);
    podcastContent = sorted.map(ep => {
      const takeaway = ep.one_line_takeaway || ep.description || '';
      const verdict = ep.episode_verdict ? ` [${ep.episode_verdict}]` : '';
      const score = ep.relevance_score ? ` (score: ${ep.relevance_score})` : '';
      return `**${ep.title}**${verdict}${score}\nFeed: ${ep.feed_name || 'Unknown'}\n${takeaway}`;
    }).join('\n\n');
  } else {
    console.warn('[SIGINT] Podcast Monitor unavailable or no items — omitting podcast section');
  }

  // Build newsletter section — top 10 by relevance_score, use summary + subject
  let newsletterContent = 'No newsletter intel available this period.';
  if (newsletterItems && newsletterItems.length > 0) {
    const sorted = newsletterItems
      .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
      .slice(0, 10);
    newsletterContent = sorted.map(nl => {
      const summary = nl.summary ? nl.summary.substring(0, 400) : '';
      const score = nl.relevance_score ? ` (score: ${nl.relevance_score})` : '';
      return `**${nl.subject}**${score}\nFrom: ${nl.sender_name || nl.sender_email}\n${summary}`;
    }).join('\n\n');
  } else {
    console.warn('[SIGINT] Newsletter Monitor unavailable or no items — omitting newsletter section');
  }

  const profile = _getProfile();
  const candidateBrief = `${profile.name} — ${profile.title || 'CPO/COO'}, ${profile.yearsExperience || ''} years experience, ${profile.location || ''}`;
  // Prompt placeholders: {content} = RSS articles, {podcast_content} = podcast intel,
  // {newsletter_content} = newsletter intel. Patrick adds these to prompt via Dashboard.
  const prompt = readFileSync(PROMPT_PATH, 'utf8')
    .replace('{content}', contentBlock)
    .replace('{podcast_content}', podcastContent)
    .replace('{newsletter_content}', newsletterContent)
    .replace('{{CANDIDATE_BRIEF}}', candidateBrief)
    .replace('{{CANDIDATE_SECTORS}}', (profile.targetSectors || []).join(', ') || 'PE/VC-backed tech companies, AI transformation')
    .replace('{{CANDIDATE_GEOGRAPHIES}}', (profile.targetGeographies || []).join(', ') || 'Europe');

  const response = await client.messages.create({
    model: getModel('synthesis'),
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
