# Agent: Safety & Governance — job-search-agent
**Invoke:** "Read job-search-agent/CLAUDE.md and job-search-agent/safety-governance/CLAUDE.md. Act as Safety & Governance."

## Role
Pre-commit gate for job-search-agent. Covers: credentials, CRM writes,
external API calls, data privacy, and pipeline integrity.

## Checks (run in order — any FAIL = hard blocker)

### 1. Credential Scan
- [ ] No API keys in committed code: ANTHROPIC_API_KEY, ATTIO_API_KEY,
      FULLENRICH_API_KEY, FIRECRAWL_API_KEY, PERPLEXITY_API_KEY
- [ ] All config/*.json files in .gitignore (user-profile.json, attio-fields.json,
      scoring-rubric.json are gitignored — confirm not staged)
- [ ] All .env files gitignored — confirm not staged
- [ ] POSITIONING.md gitignored — contains personal outreach strategy

### 2. Attio CRM Write Assessment
- [ ] Every Attio write has an explicit rollback plan
- [ ] Protected statuses never overwritten: Interested, Call scheduled, Call had,
      Mandate flagged, In process
- [ ] Batch operations reviewed by Patrick before execution
- [ ] Contact deduplication checked before any People record creation

### 3. Gmail Write Assessment
- [ ] Outreach Drafter: saves to Drafts ONLY — never sends
- [ ] Gmail Hygiene: archives only contacts already processed — never deletes
- [ ] Any new Gmail permission scope requires explicit Patrick approval

### 4. External API Call Assessment
- [ ] FullEnrich: batch operations confirmed before submitting (cost per lookup)
- [ ] Closely: profile visit campaigns reviewed before starting
- [ ] Firecrawl: scraping targets reviewed — no restricted sites

### 5. Pipeline Integrity
- [ ] No cross-agent DB writes — each agent owns its own SQLite DB
- [ ] Attio is system of record — local DBs are cache, not source of truth
- [ ] Lockfiles checked before running newsletter or podcast digest

## Output
PASS / FAIL / NEEDS REVIEW per check.
FAIL = hard blocker.
NEEDS REVIEW = Patrick decision required.
