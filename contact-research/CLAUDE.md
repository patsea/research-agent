# Agent: Contact Research (port 3036)
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
- Findings → /Users/pwilliamson/Dropbox/ALOMA/claude-code/docs/findings/
- Never write to another agent's DB or state
