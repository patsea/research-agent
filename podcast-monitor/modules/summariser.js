const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

const PODCAST_SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../../config/prompts/podcast-summarisation.md'), 'utf8'
).replace(/^#[^\n]*\n/gm, '').trim();

const { getModel } = require('../../shared/models.cjs');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
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

  const userPrompt = `Transcript (with timestamps in [HH:MM:SS] format):
${truncated}

Return ONLY valid JSON, no preamble, no markdown fences:
{
  "overview": "300-500 word summary of the full episode — key arguments, who said what, main conclusions",
  "topic_tags": [
    {
      "topic": "2-5 word topic label",
      "timestamp_start": "HH:MM:SS",
      "timestamp_end": "HH:MM:SS",
      "teaser": "One sentence: the specific argument or insight discussed in this section"
    }
  ],
  "new_novel_contrarian": [
    {
      "type": "new|novel|contrarian",
      "idea": "One sentence stating the idea",
      "why": "One sentence: why this challenges or extends current thinking"
    }
  ]
}

Rules for topic_tags:
- Maximum 10 tags
- Order by timestamp ascending
- Each tag must map to a real section of the transcript with a clear start and end time
- Teaser must be specific and factual — what was actually said, not a vague description
- Topic label must be specific (e.g. "Nvidia margin compression") not generic (e.g. "technology")
- Only tag sections with substantive discussion (minimum 2 minutes of content)`;

  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const fetch = (await import('node-fetch')).default;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: getModel('podcast_summary'),
      max_tokens: 2000,
      system: PODCAST_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

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

  const overview = parsed.overview || '';
  const topicTags = parsed.topic_tags || [];
  const newNovelContrarian = parsed.new_novel_contrarian || [];

  // Upsert into summaries
  const existing = db.prepare('SELECT id FROM summaries WHERE episode_id = ?').get(episodeId);
  if (existing) {
    db.prepare(`
      UPDATE summaries SET
        summary_text = ?,
        topic_tags = ?,
        transcript_path = ?,
        word_count = ?
      WHERE episode_id = ?
    `).run(overview, JSON.stringify(topicTags), jsonPath, overview.split(/\s+/).length, episodeId);
  } else {
    db.prepare(`
      INSERT INTO summaries (episode_id, summary_text, topic_tags, transcript_path, word_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(episodeId, overview, JSON.stringify(topicTags), jsonPath, overview.split(/\s+/).length);
  }

  // Update episode with transcript path and status
  db.prepare('UPDATE episodes SET status = ?, transcript_path = ? WHERE id = ?')
    .run('summarised', jsonPath, episodeId);

  console.log(`[summariser] Episode ${episodeId} summarised — ${topicTags.length} topic tags, ${newNovelContrarian.length} novel/contrarian items`);
  return { overview, topicTags, newNovelContrarian };
}

module.exports = { summarise };
