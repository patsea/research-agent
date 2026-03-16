import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import 'dotenv/config';

let client = null;

async function getClient() {
  if (client) return client;
  const command = process.env.GMAIL_MCP_COMMAND || 'npx';
  const args = (process.env.GMAIL_MCP_ARGS || '-y,@gongrzhe/server-gmail-autoauth-mcp').split(',');
  const transport = new StdioClientTransport({ command, args });
  client = new Client({ name: 'agent5-outreach-drafter', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

export async function saveDraft({ to, subject, body }) {
  try {
    const c = await getClient();
    const result = await c.callTool({
      name: 'gmail_create_draft',
      arguments: { to, subject, body }
    });
    const text = result.content?.[0]?.text || '{}';
    const parsed = JSON.parse(text);
    return { success: true, draftId: parsed.id || parsed.draftId || 'saved' };
  } catch (err) {
    console.error('[gmail-draft] Error:', err.message);
    if (err.message.includes('connect') || err.message.includes('spawn')) {
      return { success: false, error: 'Gmail MCP unavailable — check that Gmail MCP server is installed and GMAIL_MCP_COMMAND is set' };
    }
    return { success: false, error: err.message };
  }
}

export async function closeClient() {
  if (client) { try { await client.close(); } catch {} }
  client = null;
}
