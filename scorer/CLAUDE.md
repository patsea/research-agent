# Agent: Scorer (port 3038)
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
- Findings → /Users/pwilliamson/Dropbox/ALOMA/claude-code/docs/findings/
- Never write to another agent's DB or state
