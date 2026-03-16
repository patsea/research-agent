## Superpowers — always active

The following superpowers skills are mandatory for all code changes in this project:

- `superpowers:test-driven-development` — write failing tests before any implementation code; confirm fail → write code → confirm pass
- `superpowers:systematic-debugging` — identify root cause in a single pass before writing any fix
- `superpowers:verification-before-completion` — self-check all changes before writing SUMMARY
- `superpowers:subagent-driven-development`
- `superpowers:test-driven-development` (UI) — any change to a UI route, HTML page or frontend component requires a Playwright test in `tests/ui/`; run with `npm run test:ui`
 — structured parallel agent coordination; agents write results to /tmp before reporting

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
6. Agent 4 (contact-research) never writes to Attio — only Agent 2 (research) and Agent 6 (email-scan) write to Attio.
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

## Investigation findings — mandatory

Every investigation that produces confirmed facts MUST create a `FINDINGS-*-YYYYMMDD.md` file in `docs/findings/`. This is non-negotiable.

- Write findings immediately after the investigation completes — not deferred, not optional.
- Start with a `## Summary` section: max 5 bullets, each a standalone confirmed fact.
- Follow with `## Detail` section: full investigation output, exact values, commands used.
- Include what was ruled out, not just what was found.
- End with recommended next actions.
- The findings file path is: `/Users/pwilliamson/Dropbox/ALOMA/claude-code/docs/findings/`

Without findings files, the next session re-investigates what is already known.

---

## Known issues (not bugs — deferred work)

- Env var inconsistency: `CLAUDE_API_KEY` (signal-scanner, research, email-scan) vs `ANTHROPIC_API_KEY` (scorer, contact-research, outreach-drafter) — same key, not yet standardised
- Signal Scanner forward_queue.jsonl has no consumer — forwarding a signal does not automatically trigger research
- Agent 5 → Agent 4 notify call silently fails (endpoint mismatch: /status vs /confirm) — cosmetic only
- FullEnrich domain derivation is naive — may fail for non-.com companies
- 6 dead RSS feed URLs in Sigint sources — replace via GET /api/sigint/sources