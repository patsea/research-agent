# job-search-agent — Agent Roster & Orchestration

## Pipeline Flow
Signal Scanner → Research → Scorer → Contact Research → Outreach Drafter
→ [outreach sent] → Email Scan → Gmail Hygiene

## Supporting: Podcast Monitor + Newsletter Monitor (feed into Signal Scanner)
## Control: Dashboard (monitors all)

| Agent | Dir | Port | DB | Role |
|-------|-----|------|----|------|
| Dashboard | dashboard/ | 3030 | — | Health, inbox, settings, 20 prompts |
| Signal Scanner | signal-scanner/ | 3033 | — | RSS/web signal extraction |
| Email Scan | email-scan/ | 3034 | agent-email.db | Reply classification, Attio writes |
| Research | research/ | 3035 | — | Company research, audit, SIGINT |
| Contact Research | contact-research/ | 3036 | — | Batch enrichment, FullEnrich |
| Outreach Drafter | outreach-drafter/ | 3037 | — | Pipeline/Drafts/Positioning |
| Scorer | scorer/ | 3038 | — | MTOS+H company + FOAN firm scoring |
| Gmail Hygiene | gmail-hygiene/ | 3039 | — | Labelling, dual account, cleanup |
| Podcast Monitor | podcast-monitor/ | 3040 | — | RSS/YouTube digest |
| Newsletter Monitor | newsletter-monitor/ | 3041 | — | Triple Gmail, JSON summariser |

## Invocation
"Read job-search-agent/CLAUDE.md and job-search-agent/[dir]/CLAUDE.md. Act as [agent]."

## State Rules
- Each agent owns its own DB — never write cross-agent
- Attio is system of record — all contact/deal state syncs there
- Models: all slots use getModel() from shared/models.cjs — never hardcode
- Config: shared/ for activityLogger, models, slack utilities

## Key Paths
Base: /Users/pwilliamson/Dropbox/ALOMA/claude-code/job-search-agent/
Panel: instructions/Project files/Job search agent/
Upload: instructions/Project files/Job search agent/Upload/
Findings: docs/findings/ (central — NOT per-project)
