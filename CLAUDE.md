# Project Context: job-search-agent/

# File routing authority: ~/Dropbox/ALOMA/claude-code/WHERE-THINGS-LIVE.md
# Do not define routing paths in this file — WHERE-THINGS-LIVE.md governs.
# Parent files (read these first — rules and identity live there):
#   ~/Dropbox/ALOMA/CLAUDE.md          ← GLOBAL: identity, two-space rule, universal gates
#   ~/Dropbox/ALOMA/claude-code/CLAUDE.md  ← STACK: DevOps rules, MCP inventory, pitfall count
# This file: JSA-specific delta only — ports, DB paths, JSA pitfalls, agent topology

## Best Practices References

Before executing any instruction file in this project, read:
- ~/Dropbox/ALOMA/claude-code/docs/best-practices/CLAUDE_CODE_UNIVERSAL_BEST_PRACTICES.md
- ~/Dropbox/ALOMA/claude-code/job-search-agent/docs/JSA-BEST-PRACTICES.md

---

## ⛔ SCOPE DECLARATION — job-search-agent ONLY
This CLAUDE.md governs job-search-agent ONLY (8 agents).
Do NOT inherit rules from parent DevOps CLAUDE.md.
If working outside job-search-agent/, stop and load the correct CLAUDE.md.
Podcast Monitor and Newsletter Monitor are NOT in this repo — see content-engine/.

---

## Quick Reference

| Item | Value |
|------|-------|
| Agents in this repo | 8 (Dashboard, Signal Scanner, Email Scan, Research, Contact Research, Outreach Drafter, Scorer, Gmail Hygiene) |
| Sibling app | `content-engine/` (Podcast Monitor :3040, Newsletter Monitor :3041) |
| Shared modules | `shared/` at repo root (NOT inside job-search-agent/) |
| CLI | `cli/` at repo root — `jsa start\|stop\|restart\|status\|tail\|doctor\|pipeline\|prompts\|costs` |
| jsa doctor | 30 checks, 7 groups (Environment, API Keys, OAuth/Keychain, Configuration, DB Integrity, Network+Services, Topology) |
| Dashboard ports | Health-checks all 10 ports (3030, 3033-3041) across both apps |
| Test baseline | ~343 passing, ~102 failing |
| Anthropic API | Raw fetch via `shared/anthropic.cjs` — no @anthropic-ai/sdk runtime dependency |
| Pitfall count | 485 (universal) + 49 (JSA-specific) |

---

## Superpowers — always active

The following superpowers skills are mandatory for all code changes in this project:

- `superpowers:test-driven-development` — write failing tests before any implementation code; confirm fail → write code → confirm pass
- `superpowers:systematic-debugging` — identify root cause in a single pass before writing any fix
- `superpowers:verification-before-completion` — self-check all changes before writing SUMMARY
- `superpowers:subagent-driven-development`
- `superpowers:test-driven-development` (UI) — Playwright tests in `tests/ui/` are ONLY required when changes touch: `dashboard/public/`, `*/public/*.html`, UI-serving routes (GET / that return HTML), or frontend CSS/JS. Backend-only changes (API logic, DB queries, config, pipelines, modules) do NOT require UI tests. Run with `npm run test:ui`
- `superpowers:subagent-driven-development` — structured parallel agent coordination; agents write results to /tmp before reporting

---

## Testing Rules

### New modules and features — TDD mandatory
When building any new .cjs module, server endpoint, or feature:

**Step order in every instruction file:**
1. Create test file `tests/[module-name].test.cjs` with failing tests covering:
   - Happy path (expected inputs produce expected outputs)
   - Edge cases (empty input, null values, malformed data)
   - Error handling (throws correctly, returns error objects)
2. Run Jest — tests must FAIL (confirms tests are wired correctly)
3. Implement the module/feature
4. Run Jest — tests must PASS
5. Run full Jest suite — no regressions

**Test file naming:** `tests/[module-name].test.cjs`
Example: `school-checker.cjs` → `tests/school-checker.test.cjs`

### Gate 9 — Tests must exercise behaviour

A new or changed function passes Gate 9 only if:
  1. A test exists that calls the function and asserts on its return/effect
  2. The test fails when the function's logic is broken (mutation check)
  3. The test does not replicate the function's code inline — it imports and calls the real function

Tests that do NOT satisfy Gate 9 on their own:
  - Source-scan tests (readFileSync + string match on source code)
  - Schema-only tests (assert column exists, no logic exercised)
  - Integration tests against live servers (fine as a supplement, not as the primary gate)
  - Tests that redefine the production function inline before testing it

"Has tests" is not Gate 9. "Breaks the test by breaking the code" is Gate 9.

### Bug fixes and UI changes — regression gate only
When fixing a bug or modifying existing UI/endpoints:
- No new test file required unless the bug reveals a gap in existing coverage
- Final step of every instruction file: `npx jest --forceExit`
- Baseline: ~300 passing, ~102 failing (post source-scan cleanup 2026-04-23; pre-existing failures, do not fix unless explicitly tasked)

### Never
- Never skip the Jest regression run at end of any instruction file
- Never write tests after implementation for new modules (TDD means test-first)
- Never spontaneously create test files outside of listed instruction steps

---

# Research Agent — Operational Rules

Rules Claude must follow when working in this codebase. Read this file before making any changes.

---

## Absolute rules

1. Never use `claude-opus-4-6` in any agent — use `claude-sonnet-4-6` for synthesis, `claude-haiku-4-5-20251001` for classification only.
2. Never call the Perplexity API directly — research is manual (generate prompt → run in browser → paste output → /api/audit).
3. Outreach Drafter saves to Gmail Drafts only — never sends email under any circumstances.
4. Never commit `config/user-profile.json`, `config/attio-fields.json`, `outreach-drafter/POSITIONING.md`, any `.env` file, or any `.db` file.
5. Activity log endpoint is `http://localhost:3030/api/activity` — no other port.
6. Agent 4 (contact-research) writes to Attio via `scripts/attio-writeback.cjs` (upsertPerson) — triggered from pipeline export (Eval → Export to Attio) and outreach drafter approve. Agent 2 (research) and Agent 6 (email-scan) also write to Attio.
7. Attio workspace member ID is set via `ATTIO_MEMBER_ID` env var in `email-scan/.env` — never hardcode it.
8. Attio protected statuses (never overwrite): Interested, Call scheduled, Call had, Mandate flagged, In process.

---

## Config files — how personalisation works

All personal data lives in config files, not in source code:

| File | Purpose | Tracked by git |
|------|---------|---------------|
| `config/user-profile.json` | Candidate name, title, proof points, target sectors/geographies | No |
| `config/attio-fields.json` | Attio field slugs, status values, member ID | No |
| `config/scoring-rubric.json` | ELNS scoring dimension weights and prompts | No |
| `outreach-drafter/POSITIONING.md` | Outreach tone, proof point rules, fund-specific angles | No |

Edit via Settings UI at `http://localhost:3030/config.html` or directly in the files.

Example files (tracked, no personal data):
- `config/user-profile.example.json`
- `config/attio-fields.example.json`
- `config/scoring-rubric.example.json`
- `outreach-drafter/POSITIONING.example.md`

---

## Prompt injection

`research/prompts/system_interview_prep.txt` and `research/prompts/SIGINT_WEEKLY_BRIEFING.md` use `{{CANDIDATE_*}}` placeholders. These are injected at runtime by `buildSystemPrompt()` in `research/modules/prompt-builder.js` using values from `config/user-profile.json`. Never hardcode candidate details in prompt files.

---

## Investigation findings — mandatory (ENFORCED)

Every INVESTIGATE-*.md instruction that produces confirmed facts MUST create a `FINDINGS-*-YYYYMMDD.md` file in `knowledge/findings/`. This is non-negotiable. **An investigation without a FINDINGS file is incomplete — do not move it to completed/.**

- Write findings immediately after the investigation completes — not deferred, not optional.
- Start with a `## Summary` section: max 5 bullets, each a standalone confirmed fact.
- Follow with `## Detail` section: full investigation output, exact values, commands used.
- Include what was ruled out, not just what was found.
- End with recommended next actions.
- The findings file path is: `/Users/pwilliamson/Dropbox/ALOMA/claude-code/knowledge/findings/`
- **Sub-agent enforcement:** When dispatching an INVESTIGATE instruction to a sub-agent, the prompt MUST include: "After completing all steps, write a FINDINGS file to /Users/pwilliamson/Dropbox/ALOMA/claude-code/knowledge/findings/FINDINGS-<description>-<date>.md with ## Summary (max 5 bullets) and ## Detail sections. This is mandatory — the investigation is not complete without it."

Without findings files, the next session re-investigates what is already known.

---

## Notion Knowledge Base

| Item | Value |
|------|-------|
| Notion: JSA Knowledge Base | ID: abf7e0ae-5ac1-4d67-8b65-2764b9320c2e |
| Notion: JSA KB data_source | ID: 76a259b9-388e-40f1-9729-8a84a0aaf3e1 |

FINDINGS and HANDOVER files sync to this database. See parent CLAUDE.md Rule 15 for sync protocol.

---

## Known issues (not bugs — deferred work)

- Agent 5 → Agent 4 notify call silently fails (endpoint mismatch: /status vs /confirm) — cosmetic only
- ~~FullEnrich domain derivation is naive~~ FIXED 2026-04-23: three-tier resolver (explicit > cache > fabricated .com w/ needs_review flag) in shared/domain-resolver.cjs
- 6 dead RSS feed URLs in Sigint sources — replace via GET /api/sigint/sources
---

## Non-Negotiable Gate — ALOMA MCP NEVER

NEVER call any tool prefixed with `aloma_` or `aloma-admin_` in this session.
These tools connect directly to the production ALOMA database.
Use the ALOMA CLI only. If an aloma_ tool appears in the tool list: do not
call it, state the rule, stop.


---

## TDD and Security Gates

See CLAUDE_CODE_UNIVERSAL_BEST_PRACTICES.md — Universal Gate 1 (RED-GREEN-REFACTOR)
and Universal Gate 2 (Security checks). Both apply to this project without exception.

Installed global skills for enforcement:
- superpowers:test-driven-development — TDD cycle enforcement
- vibesec — security review before any STEP is marked complete
- playwright-skill / webapp-testing — UI and E2E test execution
