# Setup Guide

Full step-by-step onboarding for the Research Agent system.

---

## 1. Prerequisites

- **Node.js 20+** -- check with `node --version`
- **npm** -- comes with Node.js
- **Git** -- for cloning the repo

## 2. Clone and Install

```bash
git clone https://github.com/YOUR_USERNAME/research-agent.git
cd research-agent

# Install root dependencies (shared SQLite)
npm install

# Install each agent's dependencies
for dir in dashboard signal-scanner email-scan research contact-research outreach-drafter scorer gmail-hygiene; do
  echo "Installing $dir..."
  (cd "$dir" && npm install)
done
```

## 3. Configure Your Profile

```bash
cp config/user-profile.example.json config/user-profile.json
```

Edit `config/user-profile.json` with your details:

```json
{
  "name": "Your Name",
  "roles": [
    {
      "company": "Company Name (Context)",
      "title": "Title",
      "period": "YYYY-YYYY",
      "highlight": "Key achievement with metrics"
    }
  ],
  "education": "Degree, Institution",
  "location": "City, Country",
  "ai_experience": "N years building AI-native products",
  "positioning": "One-line positioning statement",
  "proof_point_order_rule": "Which company leads proof points"
}
```

Also copy the scoring rubric:

```bash
cp config/scoring-rubric.example.json config/scoring-rubric.json
```

Edit thresholds and weights if the defaults don't fit your search criteria.

## 4. Configure Outreach Positioning

```bash
cp outreach-drafter/POSITIONING.example.md outreach-drafter/POSITIONING.md
```

Edit `outreach-drafter/POSITIONING.md` with your positioning strategy. This document controls how the outreach drafter writes emails on your behalf. Key sections:

- **Who I Am** -- professional summary
- **What I'm Looking For** -- target roles, industries, geographies
- **Proof Points** -- achievements with numbers, ordered by impact
- **Tone Guidance** -- register, openers to avoid, word limits
- **Fund/Firm-Specific Angles** -- custom angles per target firm

## 5. API Keys

### Required

| Key | Used By | How to Get |
|-----|---------|-----------|
| `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` | All agents except dashboard | [console.anthropic.com](https://console.anthropic.com/) |

### Optional

| Key | Used By | How to Get |
|-----|---------|-----------|
| `ATTIO_API_KEY` | email-scan, research | [app.attio.com](https://app.attio.com/) > Settings > API |
| `ATTIO_MEMBER_ID` | email-scan | Attio workspace member UUID (for note attribution) |
| `FULLENRICH_API_KEY` | contact-research | [fullenrich.com](https://fullenrich.com/) |
| `FIRECRAWL_API_KEY` | signal-scanner | [firecrawl.dev](https://firecrawl.dev/) |
| `PERPLEXITY_API_KEY` | research (optional) | [perplexity.ai](https://perplexity.ai/) |

Set up environment files:

```bash
# Root .env (shared defaults)
cp .env.example .env
# Edit .env with your keys

# Per-agent .env files (override root values)
for dir in dashboard signal-scanner email-scan research contact-research outreach-drafter scorer gmail-hygiene; do
  cp "$dir/.env.example" "$dir/.env"
done
# Edit each agent's .env as needed
```

Per-agent `.env` files override the root `.env`. You only need to set per-agent values when they differ from root defaults.

## 6. Gmail MCP Setup

Three agents use Gmail (email-scan, outreach-drafter, gmail-hygiene) via the MCP stdio transport.

### 6.1 Create Google Cloud OAuth Credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable the **Gmail API**
4. Go to **APIs & Services > Credentials**
5. Create an **OAuth 2.0 Client ID** (type: Desktop App)
6. Download the JSON credentials file

### 6.2 Set Environment Variables

In each Gmail-using agent's `.env`:

```bash
GMAIL_MCP_COMMAND=npx
GMAIL_MCP_ARGS=-y,@anthropic/gmail-mcp
```

The Gmail MCP will prompt for OAuth consent on first run. Follow the browser flow to authorise.

### 6.3 Verify

After authorising, the agent should be able to list recent emails. Check the agent's log:

```bash
# Start one agent and watch logs
cd email-scan && node server.js
# Look for successful Gmail connection message
```

## 7. Attio Field Setup

If you're using Attio CRM for contact/deal tracking:

### 7.1 Create the Status Field

1. In Attio, go to your Companies object
2. Add a new **Status** field
3. Note the field slug (e.g., `status_8`)

### 7.2 Add Status Values

Add these values to your status field:

- Not contacted
- Outreach sent
- On File
- Interested
- Call scheduled
- Call had
- Mandate flagged
- In process
- Closed
- Bad email

### 7.3 Configure Field Mapping

```bash
cp config/attio-fields.example.json config/attio-fields.json
```

Edit `config/attio-fields.json`:

```json
{
  "status_field": "status_8",
  "next_action_field": "next_action",
  "protected_statuses": ["Interested", "Call scheduled", "Call had", "Mandate flagged", "In process"],
  "valid_statuses": ["Not contacted", "Outreach sent", "On File", "Interested", "Call scheduled", "Call had", "Mandate flagged", "In process", "Closed", "Bad email"]
}
```

Update `status_field` to match your actual Attio field slug.

### 7.4 Set Member ID

Find your Attio workspace member UUID (Settings > Members in Attio) and add to `.env`:

```bash
ATTIO_MEMBER_ID=your-uuid-here
```

## 8. Granola MCP (Optional)

Email-scan and research agents can optionally use Granola for meeting note context.

```bash
GRANOLA_MCP_COMMAND=npx
GRANOLA_MCP_ARGS=-y,@anthropic/granola-mcp
```

If you don't use Granola, leave these unset. The agents will skip meeting note lookups.

## 9. Start All Agents

```bash
# Start all 8 agents
npm run start:all

# Check health
npm run health
```

Expected output:

```
Port 3030: 200  (Dashboard)
Port 3033: 200  (Signal Scanner)
Port 3034: 200  (Email Scan)
Port 3035: 200  (Research)
Port 3036: 200  (Contact Research)
Port 3037: 200  (Outreach Drafter)
Port 3038: 200  (Scorer)
Port 3039: 200  (Gmail Hygiene)
```

To stop all agents:

```bash
npm run stop:all
```

## 10. First Run Checklist

- [ ] Dashboard loads at http://localhost:3030
- [ ] All 8 ports return HTTP 200 (`npm run health`)
- [ ] Signal scanner can fetch a test URL (check `/tmp/jsa-signal-scanner.log`)
- [ ] Email scan connects to Gmail successfully
- [ ] Outreach drafter can save a draft to Gmail
- [ ] Scorer returns a score for a test company
- [ ] Contact research can query Attio (if configured)
- [ ] Gmail hygiene labels test emails correctly

## 11. Scheduling

### macOS launchd (recommended)

Create `~/Library/LaunchAgents/com.research-agent.all.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.research-agent.all</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/npm</string>
        <string>run</string>
        <string>start:all</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/research-agent</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/jsa-all.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/jsa-all.err</string>
</dict>
</plist>
```

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.research-agent.all.plist
```

### cron

```cron
# Start all agents at 8am on weekdays, stop at 8pm
0 8 * * 1-5  cd /path/to/research-agent && npm run start:all >> /tmp/jsa-all.log 2>&1
0 20 * * 1-5 cd /path/to/research-agent && npm run stop:all >> /tmp/jsa-all.log 2>&1
```

---

## Troubleshooting

### Agent won't start

- Check the agent's `.env` file exists and has required keys
- Check port isn't already in use: `lsof -i :PORT`
- Check logs: `/tmp/jsa-<agent-name>.log`

### Gmail MCP fails to connect

- Re-run OAuth flow: delete cached credentials and restart the agent
- Verify Gmail API is enabled in Google Cloud Console
- Check `GMAIL_MCP_COMMAND` and `GMAIL_MCP_ARGS` are set correctly

### Attio updates not working

- Verify `ATTIO_API_KEY` has write permissions
- Check field slug in `config/attio-fields.json` matches your Attio workspace
- Verify `ATTIO_MEMBER_ID` is set for note attribution

### Scorer returns unexpected scores

- Review `config/scoring-rubric.json` -- adjust weights and thresholds
- Check the manual dimension (H for companies, N for firms) which requires manual input

### "Cannot find module" errors

- Run `npm install` in the affected agent's directory
- Ensure Node.js 20+ is installed: `node --version`

### Dashboard shows agents as down

- Run `npm run health` to verify which ports are responding
- Restart individual agents: `cd <agent-dir> && node server.js`
- Check `/tmp/jsa-<agent>.log` for crash details
