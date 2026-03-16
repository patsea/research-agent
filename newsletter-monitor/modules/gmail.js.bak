'use strict';
const fetch = require('node-fetch');

async function fetchNewsletters(daysBack = 1) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('No ANTHROPIC_API_KEY set');

  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceStr = since.toISOString().split('T')[0];

  const accounts = [
    { name: 'gmail', mcp_url: 'https://gmail.mcp.claude.com/mcp', label: 'patrick.williamson@gmail.com' },
    { name: 'gmail-aloma', mcp_url: 'https://gmail-aloma.mcp.claude.com/mcp', label: 'patrick@aloma.io' }
  ];

  const allNewsletters = [];

  for (const account of accounts) {
    try {
      const prompt = `Search Gmail for newsletters received since ${sinceStr}.
Use the gmail_search_messages tool with query: "after:${sinceStr} (unsubscribe OR newsletter OR digest OR weekly OR daily) -from:me -in:sent"
For each result, return a JSON array. Each item must have:
- messageId (string)
- subject (string)
- sender (display name)
- senderEmail (email address)
- snippet (first 300 chars of body)
- receivedAt (ISO timestamp)

Return ONLY the JSON array, no other text. If no results, return [].`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4000,
          mcp_servers: [{ type: 'url', url: account.mcp_url, name: account.name }],
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await response.json();
      const text = data.content
        ? data.content.filter(b => b.type === 'text').map(b => b.text).join('')
        : '';

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const items = JSON.parse(jsonMatch[0]);
        items.forEach(item => {
          allNewsletters.push({ ...item, account: account.label });
        });
      }
    } catch (err) {
      console.error(`[newsletter-monitor] Gmail fetch error for ${account.label}:`, err.message);
    }
  }

  return allNewsletters;
}

module.exports = { fetchNewsletters };
