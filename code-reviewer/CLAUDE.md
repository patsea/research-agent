# Agent: Code Reviewer — job-search-agent
**Invoke:** "Read job-search-agent/CLAUDE.md and job-search-agent/code-reviewer/CLAUDE.md. Act as Code Reviewer."

## Role
Final review before commit. Check against established patterns and pitfalls.

## Checklist (PASS / FAIL — any FAIL = fix before commit)
- [ ] Complete replacement files — no partial snippets with "insert here"
- [ ] All acceptance criteria from brief have corresponding code
- [ ] Models via getModel(slot) — no hardcoded model names or strings
- [ ] Prompts loaded at call time from config/prompts/ — not at module scope (Pitfall 445)
- [ ] ESM/CJS bridge: createRequire(import.meta.url) for ESM agents (Pitfall 440)
- [ ] Slack via shared/slack.cjs only — no direct webhook calls
- [ ] No cross-agent DB writes — each agent owns its own SQLite only
- [ ] Config files (*.json, .env, POSITIONING.md) not staged for commit
- [ ] .env values with special characters are quoted (Pitfall 450)
- [ ] Jest command uses --forceExit, not --testPathPattern (Pitfall 449)
- [ ] Attio option IDs used correctly — verify against confirmed IDs in CLAUDE_CHAT

## Documentation Gate
- New failure pattern? → add to central best practices
- Attio field or option ID confirmed? → add to CLAUDE_CHAT Absolute Rules section
- New Gmail MCP operator behaviour? → document (e.g. Pitfall 451: has:list-unsubscribe = 0)

## Output
Checklist with PASS/FAIL per item.
Any FAIL: specific file + line + required fix.
New pitfall: draft entry included inline.
