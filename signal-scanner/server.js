let logActivity = async () => {}; // lazy-loaded from ESM module
import("../shared/activityLogger.js").then(m => { logActivity = m.logActivity; }).catch(() => {});
require('dotenv').config();
const express = require('express');
const path = require('path');

// Signal Scanner — UI server only.
// The daily pipeline runs independently via: node pipeline/run.js
// Start this server when you want to review signals: node server.js
// Stop it (Ctrl+C) when done — it does not need to run continuously.

const app = express();
const PORT = process.env.PORT || 3033;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/signals', require('./routes/signals'));
app.use('/api/sources', require('./routes/sources'));
app.use('/api/admin', require('./routes/admin'));
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
// --- Research Prompt & Audit routes ---
const axios = require('axios');
const signalDb = require('./db');

app.get('/api/signals/:id/generate-prompt', (req, res) => {
  const signal = signalDb.signals.getById(req.params.id);
  if (!signal) return res.status(404).json({ error: 'Signal not found' });

  const prompt = [
    `Research the company "${signal.company_name}" in depth. Here is the context:`,
    ``,
    `Signal type: ${signal.signal_type}`,
    `Sector: ${signal.sector}`,
    `Geography: ${signal.geography || 'Unknown'}`,
    `Summary: ${signal.ai_summary}`,
    ``,
    `Please provide:`,
    `1. Company overview — what they do, founding year, HQ location, size (employees/revenue if available)`,
    `2. Ownership structure — PE/VC-backed, public, private, recent transactions`,
    `3. Leadership team — CEO, CTO, and any recent C-suite changes`,
    `4. Technology stack and platform — what they build, key products`,
    `5. Recent news — funding rounds, acquisitions, partnerships, product launches (last 12 months)`,
    `6. Competitive landscape — key competitors and market position`,
    `7. Growth signals — hiring trends, office expansions, new markets`,
    `8. Red flags — layoffs, lawsuits, negative press, financial concerns`,
    ``,
    `Be specific with dates, numbers, and sources. If information is unavailable, say so explicitly.`
  ].join('\n');

  res.json({
    prompt,
    company: signal.company_name,
    signalId: signal.id,
    headline: signal.headline
  });
});

app.post('/api/signals/:id/audit', async (req, res) => {
  const signal = signalDb.signals.getById(req.params.id);
  if (!signal) return res.status(404).json({ error: 'Signal not found' });

  const { perplexityOutput } = req.body;
  if (!perplexityOutput) return res.status(400).json({ error: 'perplexityOutput is required' });

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'CLAUDE_API_KEY not configured' });

  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are a sceptical due-diligence auditor. Your job is to review research output about a company and flag:
- Claims that lack sources or specific dates
- Contradictions between different facts presented
- Missing critical information (financials, ownership, leadership)
- Overly positive framing that may hide risks
- Anything that seems AI-hallucinated or unverifiable

Structure your audit as:
## Verified Facts (high confidence)
## Unverified Claims (needs checking)
## Missing Information (gaps in research)
## Red Flags (concerns or contradictions)
## Overall Assessment (1-2 sentence verdict)`,
      messages: [{
        role: 'user',
        content: `Company: ${signal.company_name}\nSignal: ${signal.ai_summary}\n\nPerplexity Research Output:\n${perplexityOutput}\n\nPlease audit this research for accuracy, completeness, and potential issues.`
      }]
    }, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 60000
    });

    const audit = response.data.content[0].text;

    // Store in company_context and mark reviewed
    signalDb.db.prepare('UPDATE signals SET company_context = ?, status = ? WHERE id = ?')
      .run(audit, 'reviewed', signal.id);

    await logActivity('signal-scanner', 'audit', `Audited research for ${signal.company_name}`);
    res.json({ ok: true, audit, signalId: signal.id });
  } catch (err) {
    console.error('Audit error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Audit failed: ' + (err.response?.data?.error?.message || err.message) });
  }
});

// --- Company Context route ---
app.get('/api/signals/:id/context', async (req, res) => {
  const signal = signalDb.signals.getById(req.params.id);
  if (!signal) return res.status(404).json({ error: 'Signal not found' });

  // Return cached context if available
  if (signal.company_context) {
    return res.json({ cached: true, context: signal.company_context, signalId: signal.id });
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'CLAUDE_API_KEY not configured' });

  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      tools: [{
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3
      }],
      messages: [{
        role: 'user',
        content: `Look up the company "${signal.company_name}" and provide a brief structured profile in exactly this format (use "Unknown" if not found):

Company: ${signal.company_name}
Description: [1-2 sentence description of what they do]
Type: [PE-backed / VC-backed / Public / Private / Unknown]
Size: [employee count or range if available]
Founded: [year]
HQ: [city, country]
Funding: [total raised or latest round, if available]
Sector: ${signal.sector}`
      }]
    }, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 30000
    });

    // Extract text from response (may have tool_use blocks interspersed)
    const textBlocks = response.data.content.filter(b => b.type === 'text');
    const context = textBlocks.map(b => b.text).join('\n').trim();

    // Cache in DB
    signalDb.db.prepare('UPDATE signals SET company_context = ? WHERE id = ?')
      .run(context, signal.id);

    res.json({ cached: false, context, signalId: signal.id });
  } catch (err) {
    console.error('Context lookup error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Context lookup failed: ' + (err.response?.data?.error?.message || err.message) });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n  Signal Scanner UI running at http://localhost:${PORT}`);
  console.log(`  Daily pipeline runs independently — check launchd or run manually:`);
  console.log(`  node pipeline/run.js\n`);
});
