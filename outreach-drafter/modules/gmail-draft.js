import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import 'dotenv/config';

// Multi-account Gmail MCP configuration
// Each account maps to its own MCP server instance with separate credentials
const ACCOUNT_CONFIGS = {
  gmail: {
    command: process.env.GMAIL_MCP_COMMAND || 'npx',
    args: (process.env.GMAIL_MCP_ARGS || '-y,@gongrzhe/server-gmail-autoauth-mcp').split(','),
    credentialsPath: process.env.GMAIL_CREDENTIALS_PATH || null,
    label: 'primary Gmail'
  },
  'gmail-aloma': {
    command: process.env.GMAIL_ALOMA_MCP_COMMAND || 'npx',
    args: (process.env.GMAIL_ALOMA_MCP_ARGS || '-y,@gongrzhe/server-gmail-autoauth-mcp').split(','),
    credentialsPath: process.env.GMAIL_ALOMA_CREDENTIALS_PATH || null,
    label: 'Aloma Gmail'
  },
  'gmail-growthworks': {
    command: process.env.GMAIL_GROWTHWORKS_MCP_COMMAND || 'npx',
    args: (process.env.GMAIL_GROWTHWORKS_MCP_ARGS || '-y,@gongrzhe/server-gmail-autoauth-mcp').split(','),
    credentialsPath: process.env.GMAIL_GROWTHWORKS_CREDENTIALS_PATH || null,
    label: 'GrowthWorks Gmail'
  }
};

// Active accounts — only accounts with credentials present
function getActiveAccounts() {
  const active = ['gmail', 'gmail-aloma']; // Always active
  // gmail-growthworks only active when credentials.json exists
  const gwCreds = ACCOUNT_CONFIGS['gmail-growthworks'].credentialsPath;
  if (gwCreds && fs.existsSync(gwCreds)) {
    active.push('gmail-growthworks');
  }
  return active;
}

const clients = new Map();

async function getClient(account = 'gmail') {
  if (clients.has(account)) return clients.get(account);

  const config = ACCOUNT_CONFIGS[account];
  if (!config) {
    throw new Error(`[gmail-draft] Unknown account: ${account}. Valid: ${Object.keys(ACCOUNT_CONFIGS).join(', ')}`);
  }

  const activeAccounts = getActiveAccounts();
  if (!activeAccounts.includes(account)) {
    throw new Error(`[gmail-draft] Account '${account}' is not active (missing credentials). Active: ${activeAccounts.join(', ')}`);
  }

  const env = { ...process.env };
  // Set credentials path for account-specific MCP if configured
  if (config.credentialsPath) {
    env.GMAIL_CREDENTIALS_PATH = config.credentialsPath;
  }

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env
  });

  const client = new Client({ name: `agent5-outreach-drafter-${account}`, version: '1.0.0' });
  await client.connect(transport);
  clients.set(account, client);
  console.log(`[gmail-draft] Connected to ${config.label} (${account})`);
  return client;
}

export async function saveDraft({ to, subject, body, account = 'gmail' }) {
  try {
    const c = await getClient(account);
    const result = await c.callTool({
      name: 'gmail_create_draft',
      arguments: { to, subject, body }
    });
    const text = result.content?.[0]?.text || '{}';
    const parsed = JSON.parse(text);
    console.log(`[gmail-draft] Draft saved via ${account}: ${parsed.id || parsed.draftId || 'saved'}`);
    return { success: true, draftId: parsed.id || parsed.draftId || 'saved', account };
  } catch (err) {
    console.error(`[gmail-draft] Error (${account}):`, err.message);
    if (err.message.includes('connect') || err.message.includes('spawn')) {
      return { success: false, error: `Gmail MCP unavailable for ${account} — check credentials and MCP config`, account };
    }
    if (err.message.includes('Unknown account') || err.message.includes('not active')) {
      return { success: false, error: err.message, account };
    }
    return { success: false, error: err.message, account };
  }
}

export async function closeClient(account = null) {
  if (account) {
    const client = clients.get(account);
    if (client) {
      try { await client.close(); } catch {}
      clients.delete(account);
    }
  } else {
    // Close all clients
    for (const [name, client] of clients) {
      try { await client.close(); } catch {}
    }
    clients.clear();
  }
}

export function listActiveAccounts() {
  return getActiveAccounts();
}
