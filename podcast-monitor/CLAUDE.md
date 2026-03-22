# Agent: Podcast Monitor (port 3040)
**Invoke:** "Read job-search-agent/CLAUDE.md and job-search-agent/podcast-monitor/CLAUDE.md. Act as Podcast Monitor."

## Role
RSS/YouTube monitoring, Podcast Index search (SHA-1 auth), rich digest schema, Slack daily digest.

## Rules
- Credentials in podcast-monitor/.env — must be quoted (Pitfall 450)
- podcast-digest-scoring.md prompt — verify not stale via Dashboard before use
- Digest lockfile: /tmp/podcast-digest-YYYYMMDD.lock — check before running

## Always
- Read job-search-agent/CLAUDE.md Absolute Rules before any task
- Use getModel(slot) from shared/models.cjs — never hardcode model names
- Use shared/slack.cjs for Slack — never direct webhook calls
- Findings → /Users/pwilliamson/Dropbox/ALOMA/claude-code/docs/findings/
- Never write to another agent's DB or state
