# Job Search Agent — Changelog

## 2026-03-17 — FIX-PODCAST-MONITOR-UI-17MAR2026.md
**Files changed:** `podcast-monitor/server.js`, `podcast-monitor/public/index.html`, `podcast-monitor/data/podcast-monitor.db`
**Outcome:** Added `channel_name` column to episodes. Added `/api/episodes/:id/fetch-metadata` route (yt-dlp thumbnail + channel). Dismiss now archives summaries (`archived=1`) instead of just changing episode status. Summaries API excludes archived rows and includes `feed_name` + `channel_name`. Summary card headers now show feed/channel name. Fixed catch-all route placement (was before YouTube feed route, blocking it). `renderTopicTags` already existed — no changes needed. All verified on port 3040.

## 2026-03-15 — FIX-DASHBOARD-WORKSPACE-IFRAME-17MAR2026.md
**Files changed:** `dashboard/public/index.html`
**Outcome:** Injected `loadAgentInWorkspace()` with 2s health-check fallback into workspace iframe logic. Fixed stale `track-8/` path in start-hint to `job-search-agent/`. No X-Frame-Options or helmet issues found — agents serve HTML at GET / without frame-blocking headers. STEP 5 skipped (all agents return 200 on GET /).
