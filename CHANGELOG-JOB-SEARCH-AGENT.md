# Job Search Agent — Changelog

## 2026-03-17 — FIX-DASHBOARD-LAYOUT-17MAR2026.md
**Files changed:** `dashboard/public/index.html`
**Outcome:** Updated dashboard agent cards: improved descriptions (RSS/web signal extraction, FullEnrich contact finder, Reply classification/Attio updates, etc.), added Results button to Signal Scanner card, added arrow icons to Open buttons, renamed section labels to "Pipeline Agents" / "Standalone Agents". Pipeline horizontal flow layout with arrows and standalone row below were already in place from prior work. No breadcrumb bar existed to remove (step 3 skipped). Dashboard restarted and verified healthy on port 3030.

## 2026-03-17 — FIX-CONTACT-RESEARCH-BATCH-17MAR2026.md
**Files changed:** `contact-research/public/index.html`
**Outcome:** Batch toolbar, checkboxes, select-all, and step-by-step workflow (Identify/Enrich/Confirm) were already implemented in a prior session. Removed per-row "Find Contact" buttons and "Actions" column header from the Research Library table — users now use checkbox selection + batch toolbar exclusively. `/api/contacts/:id/enrich` route already present in server.js. Server restarted and verified healthy on port 3036.

## 2026-03-17 — FIX-PODCAST-MONITOR-UI-17MAR2026.md
**Files changed:** `podcast-monitor/server.js`, `podcast-monitor/public/index.html`, `podcast-monitor/data/podcast-monitor.db`
**Outcome:** Added `channel_name` column to episodes. Added `/api/episodes/:id/fetch-metadata` route (yt-dlp thumbnail + channel). Dismiss now archives summaries (`archived=1`) instead of just changing episode status. Summaries API excludes archived rows and includes `feed_name` + `channel_name`. Summary card headers now show feed/channel name. Fixed catch-all route placement (was before YouTube feed route, blocking it). `renderTopicTags` already existed — no changes needed. All verified on port 3040.

## 2026-03-15 — FIX-DASHBOARD-WORKSPACE-IFRAME-17MAR2026.md
**Files changed:** `dashboard/public/index.html`
**Outcome:** Injected `loadAgentInWorkspace()` with 2s health-check fallback into workspace iframe logic. Fixed stale `track-8/` path in start-hint to `job-search-agent/`. No X-Frame-Options or helmet issues found — agents serve HTML at GET / without frame-blocking headers. STEP 5 skipped (all agents return 200 on GET /).

### 2026-03-17 — FIX-CONTACT-RESEARCH-BATCH-17MAR2026.md
- **Files:** contact-research/public/index.html, contact-research/server.js
- **Result:** Replaced per-row "Find Contact" buttons with checkbox selection + batch toolbar (Identify/Enrich/Confirm). Added /api/contacts/:id/enrich route. Select-all checkbox, progress indicator, status badges.

### 2026-03-17 — FIX-OUTREACH-DRAFTER-TABS-17MAR2026.md
- **Files:** outreach-drafter/public/index.html
- **Result:** Added Drafts tab between Pipeline and Positioning. Shows saved drafts with contact name, company, word count, status badge, Edit button. Edit opens compose view.

### 2026-03-17 — FIX-DASHBOARD-LAYOUT-17MAR2026.md
- **Files:** dashboard/public/index.html
- **Result:** Redesigned dashboard from vertical stacked list to horizontal pipeline flow cards with arrow connectors. Standalone agents (Gmail Hygiene, Podcast Monitor) in row below. Health dots poll /api/status.

### 2026-03-17 — APPEND-PITFALL-437-17MAR2026.md
- **Files:** docs/best-practices/CLAUDE_CODE_UNIVERSAL_BEST_PRACTICES.md
- **Result:** Appended Pitfall 437 — Express catch-all route ordering bug. Total pitfalls: 437.

### 2026-03-17 — INVESTIGATE-EMAIL-SCAN-17MAR2026.md
- **Files:** docs/findings/FINDINGS-EMAIL-SCAN-20260317.md (created)
- **Result:** Investigation: 7 classification types, minimal per-email storage (needs schema expansion), no results GET endpoint, 13/24 runs incomplete. FINDINGS written.

### 2026-03-17 — INVESTIGATE-GMAIL-HYGIENE-17MAR2026.md
- **Files:** docs/findings/FINDINGS-GMAIL-HYGIENE-20260317.md (created)
- **Result:** Investigation: 17 sender categories, one row per email address, unsubscribe attempts real HTTP but has extraction bug, frequency_per_month never populated, actual DB is agent7.db not gmail-hygiene.db. FINDINGS written.

### 2026-03-17 — BUILD-NEWSLETTER-MONITOR-17MAR2026.md
- **Files:** newsletter-monitor/ (new agent — server.js, modules/gmail.js, modules/summariser.js, modules/pipeline.js, public/index.html, run-daily.sh, package.json), ~/.claude-auto.conf, ~/Library/LaunchAgents/io.patrickwilliamson.newsletter-monitor.plist, open-dashboard.sh
- **Result:** Built newsletter-monitor agent on port 3041. Scans both Gmail accounts via Claude API + MCP, generates Haiku 5-line summaries. UI: Today digest with Read/Skip/Unsubscribe actions, History tab. Scheduled at 16:00/16:30/17:00 UTC via launchd. Registered in claude-auto.conf.

### 2026-03-17 — FIX-EMAIL-SCAN-SCHEMA-17MAR2026.md
- **Files:** email-scan/db.js, email-scan/server.js, email-scan/modules/scan.js
- **Result:** Added 8 columns to processed_emails (sender_email, sender_name, subject, classification_type, classification_summary, attio_record_id, attio_updated, ooo_return_date). Added /api/results and /api/stats endpoints. Fixed incomplete runs: moved runLog.update() into finally block. Root cause of 13 incomplete runs: exception in runScan() skipped update.

### 2026-03-17 — FIX-GMAIL-HYGIENE-BUGS-17MAR2026.md
- **Files:** gmail-hygiene/server.js, gmail-hygiene/modules/scanner.js
- **Result:** Fixed unsubscribe bug (now looks up Gmail message ID instead of passing email address). Fixed frequency_per_month (now calculated on scan as emails/month extrapolated from scan window). DB path already correct (agent7.db). /api/digest already existed.

### 2026-03-17 — BUILD-SLACK-NOTIFICATIONS-17MAR2026.md
- **Files:** shared/slack.cjs (new), signal-scanner/pipeline/trigger.js, newsletter-monitor/modules/pipeline.js, gmail-hygiene/modules/scanner.js, gmail-hygiene/modules/gmail.js (rewritten for dual-account), gmail-hygiene/server.js, podcast-monitor/modules/poller.js
- **Result:** Created shared Slack notification module (webhook-based, fire-and-forget). Patched 4 agents to push to channel C08U2KPR09X on: new signal, new newsletter, new sender classified, new episode. Gmail Hygiene now scans both accounts (gmail + gmail-aloma) via dual MCP clients. All 5 notification types tested successfully.

### 2026-03-17 — BUILD-DASHBOARD-EMBEDDED-PANELS-17MAR2026.md
- **Files:** dashboard/public/index.html, dashboard/server.js
- **Result:** Added Inbox tab to dashboard nav. Gmail Hygiene panel: stats grid, senders grouped by label with Keep/Unsub actions, 7/30-day scan buttons. Email Scan panel: stats grid, results with classification badges, Run scan button. 7 proxy routes added to server.js for CORS-free cross-port fetching via axios.

### 2026-03-17 — TRIGGER-EMAIL-SCAN-BACKFILL-17MAR2026.md
- **Files:** None modified (read-only)
- **Result:** 90-day backfill scan completed in ~2.5 minutes. 82 new emails scanned, 24 Attio records updated, 22 bounces detected. Total: 391 processed emails, 122 with new schema columns populated. Launchd daily schedule confirmed active (09:00-11:00 UTC).
