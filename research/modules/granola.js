import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import 'dotenv/config';

let client = null;

async function getClient() {
  if (client) return client;
  try {
    const command = process.env.GRANOLA_MCP_COMMAND || 'node';
    const args = (process.env.GRANOLA_MCP_ARGS || '').split(',').filter(Boolean);
    const transport = new StdioClientTransport({ command, args });
    const c = new Client({ name: 'research-hub', version: '1.0.0' });
    await c.connect(transport);
    client = c;
    return client;
  } catch (err) {
    client = null;
    console.error('[granola] MCP client init failed:', err.message);
    throw err;
  }
}

export async function listMeetings(limit = 20) {
  const c = await getClient();
  const result = await c.callTool({ name: 'search_meetings', arguments: { query: '', limit } });
  try {
    const text = result.content?.[0]?.text || '[]';
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export async function getMeetingTranscript(id) {
  const c = await getClient();
  const result = await c.callTool({ name: 'get_meeting_content', arguments: { meeting_id: id } });
  try {
    return result.content?.[0]?.text || '';
  } catch { return ''; }
}

export async function searchMeetingsByCompany(companyName) {
  const meetings = await listMeetings(50);
  const lower = companyName.toLowerCase();
  return meetings.filter(m => (m.title || '').toLowerCase().includes(lower));
}

export async function closeClient() {
  if (client) { try { await client.close(); } catch {} }
  client = null;
}
