# Agent: Research (port 3035)
**Invoke:** "Read job-search-agent/CLAUDE.md and job-search-agent/research/CLAUDE.md. Act as Research."

## Role
Company research, audit, 3-source SIGINT (research + podcast + newsletter), auto-score.

## Rules
- research-company-audit.md prompt must be loaded from config/prompts/ — verify not stale via Dashboard
- SIGINT briefing uses {content} {podcast_content} {newsletter_content} — all three sources required
- Check existing Attio record before creating new company research

## Always
- Read job-search-agent/CLAUDE.md Absolute Rules before any task
- Use getModel(slot) from shared/models.cjs — never hardcode model names
- Use shared/slack.cjs for Slack — never direct webhook calls
- Findings → /Users/pwilliamson/Dropbox/ALOMA/claude-code/docs/findings/
- Never write to another agent's DB or state
