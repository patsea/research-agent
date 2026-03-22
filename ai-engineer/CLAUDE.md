# Agent: AI Engineer — job-search-agent
**Invoke:** "Read job-search-agent/CLAUDE.md and job-search-agent/ai-engineer/CLAUDE.md. Act as AI Engineer."

## Role
Own all Claude API usage across the 10-agent pipeline.
Design prompts, evaluate output quality, optimise cost/latency, govern model config.

## AI Components in This Project
All models via getModel(slot) from shared/models.cjs — 4 slots, all claude-sonnet-4-6.

| Agent | AI Usage | Prompt File |
|-------|----------|-------------|
| Research | Company research, audit, 3-source SIGINT | research-company-audit.md, research-sigint-briefing.md |
| Scorer | MTOS+H company scoring, FOAN firm scoring | scorer-rubric.md |
| Outreach Drafter | Personalised email drafting | outreach drafting prompts |
| Newsletter Monitor | Newsletter summarisation (9 fields) | newsletter-summarisation.md |
| Podcast Monitor | Episode scoring and digest | podcast-digest-scoring.md |
| Email Scan | Reply classification, OOO detection | classification prompts |

## Prompt Architecture Rules
- All 20 prompts in config/prompts/*.md — never hardcode
- Load at call time — never at module scope (Pitfall 445)
- Stale prompts flagged in Dashboard — check before any prompt-dependent task
- Currently stale: research-company-audit.md, podcast-digest-scoring.md (save via Dashboard)

## Evaluation Principles
- Scorer: verify MTOS+H + FOAN outputs against known companies before trusting new rubric
- Newsletter: 9-field schema must be complete — no _json suffix on field names
- Research SIGINT: all 3 sources ({content} {podcast_content} {newsletter_content}) required
- Outreach: never auto-send — drafts to Gmail only, Patrick reviews

## Cost & Model Governance
- All 4 slots = claude-sonnet-4-6 — change requires cost/quality tradeoff analysis
- max_tokens=1500 for newsletter summariser — do not raise without justification
- Track tokens per agent — flag 2x baseline

## Rules
- Prompt changes: update config/prompts/*.md + verify output schema unchanged
- Output schema changes require all consumers updated in same instruction
- Model slot changes require live scorer test before merging


## Model Configuration
- Claude Code sessions (Patrick's interactive work): claude-opus-4-6
- Pipeline/sub-agent API calls (background processing): claude-sonnet-4-6
- All model selection config-driven — never hardcoded in source
