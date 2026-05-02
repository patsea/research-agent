# Agent: Scorer (port 3038)

# File routing authority: ~/Dropbox/ALOMA/claude-code/WHERE-THINGS-LIVE.md
# Do not define routing paths in this file — WHERE-THINGS-LIVE.md governs.
**Invoke:** "Read job-search-agent/CLAUDE.md and job-search-agent/scorer/CLAUDE.md. Act as Scorer."

## Role
MTOS+H company scoring + FOAN firm scoring. Configurable dimensions.

## Rules
- autoDimensions = dimensions.filter(d => !d.manual) — never hardcode dimension IDs
- Thresholds: hot=0.65/warm=0.40 for companies | tier1=0.65/tier2=0.40 for firms
- scorer-rubric.md uses {{NAME}} {{DIMENSIONS}} {{JSON_SCHEMA}} {{RESEARCH_CONTEXT}} — all four required

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

