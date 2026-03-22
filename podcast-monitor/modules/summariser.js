const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

const { getModel } = require('../../shared/models.cjs');

function _getPodcastPrompt(episode, transcriptContent) {
  let prompt = fs.readFileSync(
    path.join(__dirname, '../../config/prompts/podcast-summarisation.md'), 'utf8'
  ).replace(/^#[^\n]*\n/gm, '').trim();

  // Inject episode metadata into prompt tokens
  prompt = prompt.replace('{EPISODE_TITLE}', episode.title || 'Unknown');
  prompt = prompt.replace('{PODCAST_NAME}', episode.channel_name || 'Unknown');
  prompt = prompt.replace('{PUBLISHED_DATE}', episode.published_at || 'Unknown');
  prompt = prompt.replace('{DESCRIPTION}', episode.description || '');
  prompt = prompt.replace('{CONTENT}', transcriptContent);

  return prompt;
}
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DOWNLOADS = path.join(__dirname, '..', 'downloads');

function buildTranscriptText(whisperJson) {
  return whisperJson.segments.map(seg => {
    const h = Math.floor(seg.start / 3600).toString().padStart(2, '0');
    const m = Math.floor((seg.start % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seg.start % 60).toString().padStart(2, '0');
    return `[${h}:${m}:${s}] ${seg.text.trim()}`;
  }).join('\n');
}

async function summarise(episodeId) {
  const db = getDb();
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);
  if (!episode) throw new Error(`Episode ${episodeId} not found`);

  // Find transcript JSON file
  const jsonPath = path.join(DOWNLOADS, `ep_${episodeId}.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Transcript not found at ${jsonPath} — run transcription first`);
  }

  const whisperData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const transcriptText = buildTranscriptText(whisperData);

  // Truncate if very long (Claude context limit safety)
  const MAX_CHARS = 80000;
  const truncated = transcriptText.length > MAX_CHARS
    ? transcriptText.slice(0, MAX_CHARS) + '\n[transcript truncated]'
    : transcriptText;

  const systemPrompt = _getPodcastPrompt(episode, truncated);
  const userMessage = 'Summarise now.';

  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const fetch = (await import('node-fetch')).default;
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: getModel('podcast_summary'),
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });
  } catch (err) {
    console.error('[summariser] LLM call failed:', err.message);
    throw err;
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  let raw = data.content[0].text.trim();

  // Strip markdown fences if present
  raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse Claude response as JSON: ${e.message}\nRaw: ${raw.slice(0, 500)}`);
  }

  const summary = parsed.summary || '';
  const one_line_takeaway = parsed.one_line_takeaway || '';
  const top_tags_json = JSON.stringify(parsed.top_tags || []);
  const key_points_json = JSON.stringify(parsed.key_points || []);
  const best_sections_json = JSON.stringify(parsed.best_sections || []);
  const skip_sections_json = JSON.stringify(parsed.skip_sections || []);
  const actionable_followups_json = JSON.stringify(parsed.actionable_followups || []);

  // Upsert into summaries (legacy table — store summary + top_tags for backward compat)
  const existing = db.prepare('SELECT id FROM summaries WHERE episode_id = ?').get(episodeId);
  if (existing) {
    db.prepare(`
      UPDATE summaries SET
        summary_text = ?,
        topic_tags = ?,
        transcript_path = ?,
        word_count = ?
      WHERE episode_id = ?
    `).run(summary, top_tags_json, jsonPath, summary.split(/\s+/).length, episodeId);
  } else {
    db.prepare(`
      INSERT INTO summaries (episode_id, summary_text, topic_tags, transcript_path, word_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(episodeId, summary, top_tags_json, jsonPath, summary.split(/\s+/).length);
  }

  // Update episode with all rich summary fields
  db.prepare(`UPDATE episodes SET
    status = ?,
    transcript_path = ?,
    summary = ?,
    one_line_takeaway = ?,
    top_tags_json = ?,
    key_points_json = ?,
    best_sections_json = ?,
    skip_sections_json = ?,
    actionable_followups_json = ?
  WHERE id = ?`).run(
    'summarised', jsonPath,
    summary, one_line_takeaway, top_tags_json,
    key_points_json, best_sections_json, skip_sections_json,
    actionable_followups_json, episodeId
  );

  console.log(`[summariser] Episode ${episodeId} summarised — ${(parsed.top_tags || []).length} tags, ${(parsed.best_sections || []).length} best sections, ${(parsed.actionable_followups || []).length} followups`);
  return { summary, one_line_takeaway, top_tags_json, key_points_json, best_sections_json, skip_sections_json, actionable_followups_json };
}

module.exports = { summarise };
