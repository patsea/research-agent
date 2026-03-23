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
| AI Engineer | ai-engineer/ | — | — | Prompt governance, model config, evaluation |
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
| Safety & Governance | safety-governance/ | — | — | Pre-commit gate: credentials, CRM writes, Gmail writes, API calls |
| QA Engineer | qa-engineer/ | — | — | Verification commands, test baselines, pipeline checks |
| Code Reviewer | code-reviewer/ | — | — | Pre-commit: patterns, pitfalls, prompt loading, ESM/CJS |
---

## Roadmap Agent
**Invoke:** "Read agents/roadmap-agent.md. Act as Roadmap Agent for job-search-agent."

Builds and maintains the job-search-agent pipeline roadmap. Features include:
new agents, new scoring rubrics, new enrichment integrations, new outreach patterns.
Sizing accounts for test baselines (25 podcast / 5 suites, 29-30 newsletter / 4 suites).
Notion DB: 32cc9e45e6a680d79bead2796cae8fdd

---

## AI Spec Agent
**Invoke:** "Read agents/ai-spec-agent.md. Act as AI Spec Agent for [feature]."

Owns the full AI Spec pipeline for job-search-agent features.
User stories define: which agent is affected, input (contact/company data shape),
output (Attio write, DB update, scoring result). Functional requirements include
Attio protected status rules and prompt loading at call time (Pitfall 445).
Claude Code writes investigation findings to Notion in real time.
Notion DB: 32cc9e45e6a680d79bead2796cae8fdd
