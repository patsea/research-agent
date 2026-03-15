'use strict';
const fetch = require('node-fetch');

async function summariseNewsletter(newsletter) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('No ANTHROPIC_API_KEY set');

  const prompt = `Summarise this newsletter in exactly 5 lines. Be neutral and factual — just describe what the newsletter covers. No opinions, no relevance judgements, no recommendations.

Newsletter: ${newsletter.subject}
From: ${newsletter.sender}
Content: ${newsletter.snippet || newsletter.body || '(no content)'}

Write 5 lines only. Each line is one sentence. No bullet points, no headers.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await response.json();
  return data.content?.[0]?.text?.trim() || 'Summary unavailable.';
}

module.exports = { summariseNewsletter };
