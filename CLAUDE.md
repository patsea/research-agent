# Project Context: job-search-agent/ + content-engine/

# File routing authority: ~/Dropbox/ALOMA/claude-code/WHERE-THINGS-LIVE.md
# Do not define routing paths in this file — WHERE-THINGS-LIVE.md governs.
# Parent files (read these first — rules and identity live there):
#   ~/Dropbox/ALOMA/CLAUDE.md          ← GLOBAL: identity, two-space rule, universal gates
#   ~/Dropbox/ALOMA/claude-code/CLAUDE.md  ← STACK: DevOps rules, MCP inventory, pitfall count
# This file: JSA + content-engine delta only — ports, DB paths, pitfalls, agent topology

## Best Practices References

Before executing any instruction file in this project, read:
- ~/Dropbox/ALOMA/claude-code/docs/best-practices/CLAUDE_CODE_UNIVERSAL_BEST_PRACTICES.md
- ~/Dropbox/ALOMA/claude-code/job-search-agent/docs/JSA-BEST-PRACTICES.md

---

## ⛔ SCOPE DECLARATION
This CLAUDE.md governs two sibling apps:
- **job-search-agent/** — 8 research/outreach/pipeline agents (ports 3030, 3033–3038)
- **content-engine/** — unified podcast + newsletter intelligence platform (port 3042)

Both live under ~/Dropbox/ALOMA/claude-code/. Instruction files targeting content-engine/
must set `Execute from: ~/Dropbox/ALOMA/claude-code/content-engine/`.

**Purpose split:**
- job-search-agent: research, scoring, contact pipeline, outreach drafting, email scan, CRM sync
- content-engine: podcast + newsletter ingestion, transcription, summarisation, digest UI, knowledge base

Do NOT inherit rules from parent DevOps CLAUDE.md.
If working outside these two apps, stop and load the correct CLAUDE.md.

---

## Quick Reference

| Item | Value |
|------|-------|
| Agents in job-search-agent | 8 (Dashboard, Signal Scanner, Email Scan, Research, Contact Research, Outreach Drafter, Scorer, Gmail Hygiene) |
| Ports — job-search-agent | Dashboard :3030, Signal Scanner :3033 (scheduled), Email Scan :3034, Research :3035, Contact Research :3036, Outreach Drafter :3037, Scorer :3038, Gmail Hygiene :3039 (canonical source: `cli/agents.json`) |
| Ports — content-engine | Digest Server :3042 (unified — Podcast Monitor + Newsletter Monitor + Digest UI) |
| Shared modules | `shared/` at repo root (NOT inside job-search-agent/) |
| CLI | `cli/` at repo root — `jsa start\|stop\|restart\|status\|tail\|doctor\|pipeline\|prompts\|costs` |
| jsa doctor | 30 checks, 7 groups (Environment, API Keys, OAuth/Keychain, Configuration, DB Integrity, Network+Services, Topology) |
| JSA test baseline | ~437 passing, ~81 failing (pre-existing) |
| CE test baseline | digest-server: 353 passing, 0 failing (69 suites). Root `npm run test:all` includes 30+ broken suites in `_retired/`, `backups/`, `aloma-backup/` — run the digest-server suite for an actionable baseline. |
| Anthropic API | Raw fetch via `shared/anthropic.cjs` — no @anthropic-ai/sdk runtime dependency |
| Pitfall count | 501 (universal) + JSA-specific in JSA-BEST-PRACTICES.md |

---

## Content-Engine — Key Facts

| Item | Value |
|------|-------|
| Base path | ~/Dropbox/ALOMA/claude-code/content-engine/ |
| DB | content-engine/data/content-engine.db (SQLite WAL) |
| Knowledge base | content_items table + FTS5 virtual table (porter stemmer) |
| Transcription routing | Groq <24MB → AssemblyAI (en ≥24MB) → Gladia (non-en ≥24MB) → local Whisper fallback |
| Summary translation | POST /api/episodes/:id/translate → Haiku (classification slot) → summary_en field |
| Test sentinel | CE_TEST_MODE=1 env var (equivalent to /tmp/anthropic-test-mode in JSA) |
| Retired agents | podcast-monitor (3040) and newsletter-monitor (3041) moved to _retired/ |

---

## Superpowers — always active

The following superpowers skills are mandatory for all code changes in this project:

- `superpowers:test-driven-development` — write failing tests before any implementation code; confirm fail → write code → confirm pass
- `superpowers:systematic-debugging` — identify root cause in a single pass before writing any fix
- `superpowers:verification-before-completion` — self-check all changes before writing SUMMARY
- `superpowers:subagent-driven-development`
- `superpowers:test-driven-development` (UI) — Playwright tests in `tests/ui/` are ONLY required when changes touch: `*/public/*.html`, UI-serving routes, or frontend CSS/JS. Backend-only changes do NOT require UI tests.
- `superpowers:subagent-driven-development` — structured parallel agent coordination; agents write results to /tmp before reporting

---

## Testing Rules

### New modules and features — TDD mandatory
When building any new .cjs module, server endpoint, or feature:

**Step order in every instruction file:**
1. Create test file `tests/[module-name].test.cjs` with failing tests
2. Run Jest — tests must FAIL
3. Implement the module/feature
4. Run Jest — tests must PASS
5. Run full Jest suite — no regressions

**JSA test file naming:** `tests/[module-name].test.cjs`
**CE test file naming:** follow existing pattern in content-engine/tests/

### Gate 9 — Tests must exercise behaviour

A new or changed function passes Gate 9 only if:
  1. A test exists that calls the function and asserts on its return/effect
  2. The test fails when the function's logic is broken (mutation check)
  3. The test does not replicate the function's code inline

Tests that do NOT satisfy Gate 9 on their own:
  - Source-scan tests (readFileSync + string match)
  - Schema-only tests (assert column exists, no logic exercised)
  - Integration tests against live servers (fine as supplement, not primary gate)

### Bug fixes — regression gate only
- No new test file required unless the bug reveals a coverage gap
- Final step of every instruction file: run full Jest suite for the relevant app
- JSA baseline: ~437 passing, ~81 failing (pre-existing, do not fix unless tasked)
- CE baseline (digest-server only): 353 passing, 0 failing (69 suites). Root `npm run test:all` runs 30+ broken legacy suites — use digest-server jest as the actionable baseline.

### Never
- Never skip the Jest regression run at end of any instruction file
- Never write tests after implementation for new modules
- Never spontaneously create test files outside of listed instruction steps

---

## Absolute Rules — job-search-agent

1. Never use `claude-opus-4-6` — use `claude-sonnet-4-6` for synthesis, `claude-haiku-4-5-20251001` for classification only.
2. Never call the Perplexity API directly — research is manual (generate prompt → run in browser → paste output → /api/audit).
3. Outreach Drafter saves to Gmail Drafts only — never sends email under any circumstances.
4. Never commit `config/user-profile.json`, `config/attio-fields.json`, `outreach-drafter/POSITIONING.md`, any `.env` file, or any `.db` file.
5. Activity log endpoint is `http://localhost:3030/api/activity` — no other port.
6. Agent 4 (contact-research) writes to Attio via `scripts/attio-writeback.cjs` — triggered from pipeline export and outreach drafter approve.
7. Attio workspace member ID is set via `ATTIO_MEMBER_ID` env var in `email-scan/.env` — never hardcode it.
8. Attio protected statuses (never overwrite): Interested, Call scheduled, Call had, Mandate flagged, In process.

---

## Absolute Rules — content-engine

1. Never use `claude-opus-4-6` — model slots via `getModel(slot)` from shared/models.cjs only.
2. CE_TEST_MODE=1 must be set in test environment — prevents real API and Gladia calls.
3. Never commit `.env` files or `.db` files.
4. Transcription provider selection is via `_selectProvider(language, fileSize)` — never hardcode provider in call sites.
5. summary_en field is populated by user-triggered translate only — never auto-translate on ingest.

---

## Config files — job-search-agent

| File | Purpose | Tracked by git |
|------|---------|---------------|
| `config/user-profile.json` | Candidate name, title, proof points, target sectors/geographies | No |
| `config/attio-fields.json` | Attio field slugs, status values, member ID | No |
| `config/scoring-rubric.json` | ELNS scoring dimension weights and prompts | No |
| `outreach-drafter/POSITIONING.md` | Outreach tone, proof point rules, fund-specific angles | No |

---

## Investigation findings — mandatory (ENFORCED)

Every INVESTIGATE-*.md that produces confirmed facts MUST create a `FINDINGS-*-YYYYMMDD.md` file in `knowledge/findings/`. This is non-negotiable. An investigation without a FINDINGS file is incomplete.

- Write findings immediately after investigation completes.
- Start with `## Summary`: max 5 bullets, each a standalone confirmed fact.
- Follow with `## Detail`: full output, exact values, commands used.
- Include what was ruled out, not just what was found.
- End with recommended next actions.
- Path: `/Users/pwilliamson/Dropbox/ALOMA/claude-code/knowledge/findings/`
- Sub-agent enforcement: INVESTIGATE prompts MUST include the FINDINGS file instruction.

---

## Notion Knowledge Base

| Item | Value |
|------|-------|
| Notion: JSA Knowledge Base | ID: abf7e0ae-5ac1-4d67-8b65-2764b9320c2e |
| Notion: JSA KB data_source | ID: 76a259b9-388e-40f1-9729-8a84a0aaf3e1 |

---

## Known issues (not bugs — deferred work)

- Agent 5 → Agent 4 notify call silently fails (endpoint mismatch: /status vs /confirm) — cosmetic only
- 6 dead RSS feed URLs in Sigint sources — replace via GET /api/sigint/sources
- Digest tab defaults to Last 7 days — episodes older than 7 days not visible (fix pending)
- summary_en not yet surfaced in Digest UI — stored in DB, Digest reads original summary field (P2)

---

## Non-Negotiable Gate — ALOMA MCP NEVER

NEVER call any tool prefixed with `aloma_` or `aloma-admin_` in this session.
These tools connect directly to the production ALOMA database.
Use the ALOMA CLI only. If an aloma_ tool appears in the tool list: do not
call it, state the rule, stop.

---

## TDD and Security Gates

See CLAUDE_CODE_UNIVERSAL_BEST_PRACTICES.md — Universal Gate 1 (RED-GREEN-REFACTOR)
and Universal Gate 2 (Security checks). Both apply without exception.

Installed global skills for enforcement:
- superpowers:test-driven-development
- vibesec
- playwright-skill / webapp-testing
