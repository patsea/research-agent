import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let client = null;

export async function getGmailClient() {
  if (client) return client;
  const transport = new StdioClientTransport({
    command: process.env.GMAIL_MCP_COMMAND || 'npx',
    args: (process.env.GMAIL_MCP_ARGS || '-y,@gongrzhe/server-gmail-autoauth-mcp').split(',')
  });
  const tmp = new Client({ name: 'gmail-hygiene', version: '1.0.0' }, { capabilities: {} });
  await tmp.connect(transport);
  client = tmp;
  return client;
}

export async function closeGmailClient() {
  if (client) {
    try { await client.close(); } catch {}
    client = null;
  }
}

export function parseSearchResults(text) {
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

export async function callGmail(toolName, args) {
  const c = await getGmailClient();
  const result = await c.callTool({ name: toolName, arguments: args });
  return result?.content?.[0]?.text || '';
}
