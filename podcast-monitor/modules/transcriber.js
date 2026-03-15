const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./db');

const YTDLP = '/opt/homebrew/bin/yt-dlp';
const WHISPER = process.env.WHISPER_PATH || 'whisper';
const DOWNLOADS = path.join(__dirname, '..', 'downloads');

function transcribe(episodeId) {
  const db = getDb();
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);
  if (!episode) throw new Error(`Episode ${episodeId} not found`);

  const url = episode.audio_url || episode.source_url;
  const mp3File = `ep_${episodeId}.mp3`;
  const mp3Path = path.join(DOWNLOADS, mp3File);

  // Download audio
  if (!fs.existsSync(mp3Path)) {
    console.log(`[transcriber] Downloading: ${url}`);
    try {
      execSync(
        `${YTDLP} -x --audio-format mp3 --output "${path.join(DOWNLOADS, `ep_${episodeId}.%(ext)s`)}" "${url}"`,
        { timeout: 600000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (err) {
      console.error('[transcriber] yt-dlp error:', err.stderr?.toString().slice(0, 500));
      throw new Error('yt-dlp download failed');
    }
  }

  if (!fs.existsSync(mp3Path)) {
    // Check if file was saved with different extension mapping
    const files = fs.readdirSync(DOWNLOADS).filter(f => f.startsWith(`ep_${episodeId}.`));
    if (files.length === 0) throw new Error('No audio file found after download');
  }

  // Transcribe with Whisper
  const jsonFile = `ep_${episodeId}.json`;
  const jsonPath = path.join(DOWNLOADS, jsonFile);

  if (!fs.existsSync(jsonPath)) {
    console.log(`[transcriber] Transcribing: ${mp3File}`);
    try {
      execSync(
        `${WHISPER} "${mp3Path}" --model base --language en --output_format json --output_dir "${DOWNLOADS}"`,
        { timeout: 600000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (err) {
      console.error('[transcriber] whisper error:', err.stderr?.toString().slice(0, 500));
      throw new Error('Whisper transcription failed');
    }
  }

  // Parse JSON output
  const whisperData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const segments = whisperData.segments || [];
  const fullText = segments.map(s => s.text.trim()).join(' ');

  // Create or update summary row with transcript path
  const existing = db.prepare('SELECT id FROM summaries WHERE episode_id = ?').get(episodeId);
  if (existing) {
    db.prepare('UPDATE summaries SET transcript_path = ? WHERE episode_id = ?')
      .run(jsonPath, episodeId);
  } else {
    db.prepare('INSERT INTO summaries (episode_id, transcript_path, word_count) VALUES (?, ?, ?)')
      .run(episodeId, jsonPath, fullText.split(/\s+/).length);
  }

  return { transcriptPath: jsonPath, segments };
}

function fetchMetadata(url) {
  try {
    const raw = execSync(
      `${YTDLP} --dump-json --no-playlist "${url}"`,
      { timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();
    const d = JSON.parse(raw);
    return {
      title:        d.title || null,
      description:  d.description || null,
      thumbnail:    d.thumbnail || (d.thumbnails && d.thumbnails[0] && d.thumbnails[0].url) || null,
      duration:     d.duration || null,
      published_at: d.upload_date
        ? d.upload_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')
        : null
    };
  } catch (err) {
    console.error('[fetchMetadata] Failed for', url, err.message);
    return null;
  }
}

module.exports = { transcribe, fetchMetadata };
