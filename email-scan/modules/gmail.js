import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import 'dotenv/config';

let client = null;

async function getClient() {
  if (client) return client;
  try {
    const command = process.env.GMAIL_MCP_COMMAND || 'npx';
    const args = (process.env.GMAIL_MCP_ARGS || '-y,@gongrzhe/server-gmail-autoauth-mcp').split(',');
    const transport = new StdioClientTransport({ command, args });
    const c = new Client({ name: 'agent6-email-scan', version: '1.0.0' });
    await c.connect(transport);
    client = c;
    return client;
  } catch (err) {
    client = null;
    console.error('[gmail] MCP client init failed:', err.message);
    throw err;
  }
}

function parseSearchResults(text) {
  // Gmail MCP returns plain text, not JSON. Parse "ID: xxx\nSubject: ...\nFrom: ...\nDate: ..." blocks.
  if (!text || text === '[]' || text.trim() === '') return [];

  // Try JSON first in case MCP changes format
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // Parse plain-text format: blocks separated by blank lines, each starting with "ID: ..."
  const messages = [];
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    const idMatch = block.match(/^ID:\s*(.+)/m);
    if (idMatch) {
      const subjectMatch = block.match(/^Subject:\s*(.+)/m);
      const fromMatch = block.match(/^From:\s*(.+)/m);
      const dateMatch = block.match(/^Date:\s*(.+)/m);
      messages.push({
        id: idMatch[1].trim(),
        messageId: idMatch[1].trim(),
        subject: subjectMatch ? subjectMatch[1].trim() : '',
        from: fromMatch ? fromMatch[1].trim() : '',
        date: dateMatch ? dateMatch[1].trim() : ''
      });
    }
  }
  return messages;
}

export async function searchMessages(query) {
  const c = await getClient();
  console.log(`[gmail] search query: ${query}`);
  const result = await c.callTool({ name: 'search_emails', arguments: { query, maxResults: 50 } });
  const text = result.content?.[0]?.text || '[]';
  const messages = parseSearchResults(text);
  console.log(`[gmail] parsed ${messages.length} results from response (${text.length} bytes)`);
  return messages;
}

function parseEmailContent(text) {
  // Try JSON first
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch {}

  // Parse plain-text email format with header lines followed by body
  const result = {};
  const lines = text.split('\n');
  let bodyStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^Thread ID:\s*/)) { result.threadId = line.replace(/^Thread ID:\s*/, '').trim(); continue; }
    if (line.match(/^Subject:\s*/)) { result.subject = line.replace(/^Subject:\s*/, '').trim(); continue; }
    if (line.match(/^From:\s*/)) { result.from = line.replace(/^From:\s*/, '').trim(); continue; }
    if (line.match(/^To:\s*/)) { result.to = line.replace(/^To:\s*/, '').trim(); continue; }
    if (line.match(/^Date:\s*/)) { result.date = line.replace(/^Date:\s*/, '').trim(); continue; }
    if (line.match(/^CC:\s*/i)) { result.cc = line.replace(/^CC:\s*/i, '').trim(); continue; }
    if (line.trim() === '' && !result.body && (result.subject || result.from)) {
      bodyStart = i + 1;
      break;
    }
  }

  if (bodyStart > 0) {
    result.body = lines.slice(bodyStart).join('\n').trim();
  }

  // Extract snippet from body (first 200 chars)
  if (result.body) {
    result.snippet = result.body.substring(0, 200);
  }

  return result;
}

export async function readMessage(id) {
  const c = await getClient();
  const result = await c.callTool({ name: 'read_email', arguments: { messageId: id } });
  const text = result.content?.[0]?.text || '{}';
  const parsed = parseEmailContent(text);
  console.log(`[gmail] read message ${id}: subject="${parsed.subject || '?'}", from="${parsed.from || '?'}"`);
  return parsed;
}

export async function closeClient() {
  if (client) { try { await client.close(); } catch {} }
  client = null;
}
