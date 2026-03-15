import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Support multiple Gmail MCP clients (one per account)
const clients = new Map();

// Account configurations — env vars point to per-account OAuth credentials
const ACCOUNT_CONFIGS = {
  gmail: {
    command: process.env.GMAIL_MCP_COMMAND || 'npx',
    args: (process.env.GMAIL_MCP_ARGS || '-y,@gongrzhe/server-gmail-autoauth-mcp').split(','),
    env: {
      GMAIL_OAUTH_PATH: process.env.GMAIL_OAUTH_PATH || `${process.env.HOME}/.gmail-mcp/gcp-oauth.keys.json`,
      GMAIL_CREDENTIALS_PATH: process.env.GMAIL_CREDENTIALS_PATH || `${process.env.HOME}/.gmail-mcp/credentials.json`
    }
  },
  'gmail-aloma': {
    command: process.env.GMAIL_ALOMA_MCP_COMMAND || 'npx',
    args: (process.env.GMAIL_ALOMA_MCP_ARGS || '-y,@gongrzhe/server-gmail-autoauth-mcp').split(','),
    env: {
      GMAIL_OAUTH_PATH: process.env.GMAIL_ALOMA_OAUTH_PATH || `${process.env.HOME}/.gmail-mcp-aloma/gcp-oauth.keys.json`,
      GMAIL_CREDENTIALS_PATH: process.env.GMAIL_ALOMA_CREDENTIALS_PATH || `${process.env.HOME}/.gmail-mcp-aloma/credentials.json`
    }
  }
};

export async function getGmailClient(account = 'gmail') {
  if (clients.has(account)) return clients.get(account);

  const config = ACCOUNT_CONFIGS[account];
  if (!config) throw new Error(`Unknown Gmail account: ${account}`);

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...process.env, ...config.env }
  });
  const tmp = new Client({ name: `gmail-hygiene-${account}`, version: '1.0.0' }, { capabilities: {} });
  await tmp.connect(transport);
  clients.set(account, tmp);
  return tmp;
}

export async function closeGmailClient(account) {
  if (account) {
    const c = clients.get(account);
    if (c) {
      try { await c.close(); } catch {}
      clients.delete(account);
    }
  } else {
    // Close all
    for (const [k, c] of clients) {
      try { await c.close(); } catch {}
    }
    clients.clear();
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

export async function callGmail(toolName, args, account = 'gmail') {
  const c = await getGmailClient(account);
  const result = await c.callTool({ name: toolName, arguments: args });
  return result?.content?.[0]?.text || '';
}

/** List available account names */
export function getAccountNames() {
  return Object.keys(ACCOUNT_CONFIGS);
}
