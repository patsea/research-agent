import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let client = null;

export async function getGmailClient() {
  if (client) return client;
  const transport = new StdioClientTransport({
    command: process.env.GMAIL_MCP_COMMAND || 'npx',
    args: (process.env.GMAIL_MCP_ARGS || '-y @gongrzhe/server-gmail-autoauth-mcp').split(' ')
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

export async function callGmail(toolName, args) {
  const c = await getGmailClient();
  const result = await c.callTool({ name: toolName, arguments: args });
  return result?.content?.[0]?.text || '';
}
