import axios from 'axios';
import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getModel } = require('../../shared/models.cjs');

export async function search(query, maxResults = 10) {
  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages',
      {
        model: getModel('synthesis'),
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: query }]
      },
      {
        headers: {
          'x-api-key': process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        timeout: 60000
      }
    );

    const results = [];
    for (const block of r.data.content || []) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const item of block.content) {
          if (item.type === 'web_search_result') {
            results.push({
              url: item.url || '',
              title: item.title || '',
              snippet: item.encrypted_content || item.page_content || ''
            });
          }
        }
      }
    }
    return results.slice(0, maxResults);
  } catch (err) {
    console.error('Web search error:', err.message);
    return [];
  }
}
