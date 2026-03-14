import axios from 'axios';
import 'dotenv/config';

const API_URL = 'https://api.perplexity.ai/chat/completions';

function stripThinkTags(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function deepResearch(prompt, maxTokens = 4000) {
  const r = await axios.post(API_URL,
    {
      model: 'sonar-deep-research',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 150000
    }
  );
  const content = r.data.choices?.[0]?.message?.content || '';
  return stripThinkTags(content);
}

export async function fastSearch(prompt) {
  const r = await axios.post(API_URL,
    {
      model: 'sonar',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );
  const content = r.data.choices?.[0]?.message?.content || '';
  return stripThinkTags(content);
}
