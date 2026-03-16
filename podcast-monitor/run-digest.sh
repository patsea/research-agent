#!/bin/bash
LOCK="/tmp/podcast-digest-$(date +%Y%m%d).lock"
[ -f "$LOCK" ] && echo "[digest] Already ran today" && exit 0
touch "$LOCK"

LOG="/tmp/podcast-digest.log"
echo "[digest] $(date) — starting" >> "$LOG"
node -e "
const slack = require('/Users/pwilliamson/Dropbox/ALOMA/claude-code/job-search-agent/shared/slack.cjs');
fetch('http://localhost:3040/api/digest/podcast')
  .then(r => r.json())
  .then(items => {
    console.log('[digest] items:', items.length);
    if (items.length > 0) return slack.sendPodcastDigest(items);
  })
  .then(() => { console.log('[digest] done'); process.exit(0); })
  .catch(e => { console.error('[digest] error:', e.message); process.exit(1); });
" >> "$LOG" 2>&1
