# Agent: Dashboard (port 3030)

# File routing authority: ~/Dropbox/ALOMA/claude-code/WHERE-THINGS-LIVE.md
# Do not define routing paths in this file — WHERE-THINGS-LIVE.md governs.
**Invoke:** "Read job-search-agent/CLAUDE.md and job-search-agent/dashboard/CLAUDE.md. Act as Dashboard."

## Role
Health monitor, inbox (3 panels), settings (6 tabs), 20 prompts. Monitors all other agents.

## Rules
- Read-only across all agent state — never mutate another agent's data
- All 20 prompts live in config/prompts/*.md — never hardcode prompt text
- Never access prompts at module scope — load at call time (Pitfall 445)

## Always
- Read job-search-agent/CLAUDE.md Absolute Rules before any task
- Use getModel(slot) from shared/models.cjs — never hardcode model names
- Use shared/slack.cjs for Slack — never direct webhook calls
- Findings → /Users/pwilliamson/Dropbox/ALOMA/claude-code/knowledge/findings/
- Never write to another agent's DB or state

---

## Non-Negotiable Gate — ALOMA MCP NEVER

NEVER call any tool prefixed with `aloma_` or `aloma-admin_` in this session.
These tools connect directly to the production ALOMA database.
Use the ALOMA CLI only. If an aloma_ tool appears in the tool list: do not
call it, state the rule, stop.

