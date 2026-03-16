'use strict';
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { getModel } = require('../../shared/models.cjs');

const NEWSLETTER_PROMPT = fs.readFileSync(
  path.join(__dirname, '../../config/prompts/newsletter-summarisation.md'), 'utf8'
).replace(/^#[^\n]*\n/gm, '').trim();

async function summariseNewsletter(newsletter) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('No ANTHROPIC_API_KEY set');

  const prompt = `${NEWSLETTER_PROMPT}

Newsletter: ${newsletter.subject}
From: ${newsletter.sender}
Content: ${newsletter.snippet || newsletter.body || '(no content)'}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: getModel('classification'),
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await response.json();
  return data.content?.[0]?.text?.trim() || 'Summary unavailable.';
}

module.exports = { summariseNewsletter };
