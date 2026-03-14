# Job Search Agent — Claude Code Operational Rules

> Location: ~/Dropbox/ALOMA/claude-code/job-search-agent/
> Scope: LOCAL Node.js job search agent system ONLY

## System Overview

| Agent | Port | Directory | Purpose |
|-------|------|-----------|---------|
| Dashboard | 3030 | dashboard/ | Health dashboard, activity log, workspace |
| Signal Scanner | 3033 | signal-scanner/ | Monitors LinkedIn/news for job signals |
| Research | 3035 | research/ | Manual research workflow + Claude audit |
| Scorer | 3038 | scorer/ | Scores companies via ELNS framework |
| Contact Research | 3036 | contact-research/ | Contact enrichment, Attio lookup |
| Outreach Drafter | 3037 | outreach-drafter/ | Drafts emails, saves to Gmail Drafts, never sends |
| Email Scan | 3034 | email-scan/ | Scans Gmail for replies, classifies, writes to Attio |
| Gmail Hygiene | 3039 | gmail-hygiene/ | Auto-labels, unsubscribes, inbox cleanup |

## Key Paths

| Item | Path |
|------|------|
| Shared activity logger | shared/activityLogger.js |
| Research prompts | research/prompts/ |
| Agent databases | <agent>/data/<agent>.db |
| Logs | /tmp/jsa-<agent>.log |
| Old location (archived) | ~/Dropbox/ALOMA/claude-code/Track8 context/track-8/ |

## Execution Rules

1. Launch all agents: `claude-auto launch` from job-search-agent/
2. Model: claude-sonnet-4-6 for all synthesis (never claude-opus-4-6)
3. Classification only: claude-haiku-4-5-20251001
4. MCP transport: stdio only, never HTTP
5. Activity log: all agents POST to backend-api port 8001 — fire-and-forget, never await in response path
6. Never auto-send emails — outreach-drafter saves to Drafts only
7. Never delete Attio records — only update fields
8. Attio status_8 protected values (never overwrite): Interested, Call scheduled, Call had, Mandate flagged, In process
9. Valid status_8 values: Not contacted, Outreach sent, On File, Interested, Call scheduled, Call had, Mandate flagged, In process, Closed, Bad email
10. Attio workspace member ID: set via ATTIO_MEMBER_ID env var in each agent's .env
11. Perplexity API: not used — manual workflow only (generate prompt → run in browser → paste back)
12. All instruction files use full absolute paths — never abbreviate
13. Check package.json for @anthropic-ai/sdk before adding any module that imports it directly
14. Prompts may live in /prompts/ subdirectory as .md files — check before assuming inline
15. Backup before every code change: cp file file.bak.YYYYMMDDHHMMSS

## Pipeline Flow

Signal Scanner (3033) → Research (3035) → Scorer (3038) → Contact Research (3036) → Outreach Drafter (3037)
                                                                                                    ↓
Email Scan (3034) ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←
Gmail Hygiene (3039) — runs independently on schedule

## Health Check

```bash
for PORT in 3030 3033 3034 3035 3036 3037 3038 3039; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT 2>/dev/null)
  echo "Port $PORT: $STATUS"
done
```
