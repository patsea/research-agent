# Agent: Contact Research (port 3036)

# File routing authority: ~/Dropbox/ALOMA/claude-code/WHERE-THINGS-LIVE.md
# Do not define routing paths in this file — WHERE-THINGS-LIVE.md governs.
**Invoke:** "Read job-search-agent/CLAUDE.md and job-search-agent/contact-research/CLAUDE.md. Act as Contact Research."

## Role
Batch workflow, FullEnrich enrichment, Research Hub brief context.

## Rules
- FullEnrich input: first_name, last_name, company_name, linkedin_url — all four required
- LinkedIn URL priority: FullEnrich vanity > Closely vanity > encoded — never write sales_nav_url to Attio
- Sync every enriched contact to Attio — local state is cache only

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

