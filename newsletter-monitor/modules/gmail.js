/**
 * newsletter-monitor/modules/gmail.js
 * Fetches newsletters from Gmail using stdio MCP pattern.
 * Uses dynamic import() to bridge CJS (this module) → ESM (@modelcontextprotocol/sdk).
 *
 * Active accounts: personal Gmail, gmail-aloma, gmail-growthworks (all credentials.json present)
 */

const path = require('path');

const ACCOUNT_CONFIGS = [
  {
    name: 'gmail',
    oauthPath: path.join(process.env.HOME, '.gmail-mcp/gcp-oauth.keys.json'),
    credentialsPath: path.join(process.env.HOME, '.gmail-mcp/credentials.json'),
  },
  {
    name: 'gmail-aloma',
    oauthPath: path.join(process.env.HOME, '.gmail-mcp-aloma/gcp-oauth.keys.json'),
    credentialsPath: path.join(process.env.HOME, '.gmail-mcp-aloma/credentials.json'),
  },
  {
    name: 'gmail-growthworks',
    oauthPath: path.join(process.env.HOME, '.gmail-mcp-growthworks/gcp-oauth.keys.json'),
    credentialsPath: path.join(process.env.HOME, '.gmail-mcp-growthworks/credentials.json'),
  }
];

async function fetchNewslettersFromAccount(accountConfig, daysBack) {
  let client, transport;
  try {
    // Dynamic import bridges CJS → ESM
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

    transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
      env: {
        ...process.env,
        GMAIL_OAUTH_PATH: accountConfig.oauthPath,
        GMAIL_CREDENTIALS_PATH: accountConfig.credentialsPath,
      }
    });

    client = new Client({ name: 'newsletter-monitor', version: '1.0.0' });
    await client.connect(transport);

    const after = new Date();
    after.setDate(after.getDate() - daysBack);
    const afterStr = after.toISOString().split('T')[0].replace(/-/g, '/');

    const result = await client.callTool({
      name: 'search_emails',
      arguments: {
        query: `after:${afterStr} label:inbox`,
        maxResults: 50
      }
    });

    const raw = result?.content?.[0]?.text || '';
    if (!raw) {
      console.log(`[newsletter-monitor] ${accountConfig.name}: empty response from Gmail MCP`);
      return [];
    }

    const parsed = parseNewsletterResults(raw, accountConfig.name);
    console.log(`[newsletter-monitor] ${accountConfig.name}: ${parsed.length} emails found`);
    return parsed;

  } catch (err) {
    console.error(`[newsletter-monitor] Gmail fetch error (${accountConfig.name}):`, err.message);
    return [];
  } finally {
    try { if (client) await client.close(); } catch {}
  }
}

function parseNewsletterResults(raw, account) {
  if (!raw || typeof raw !== 'string') return [];
  const emails = [];
  // Split on blank lines between email blocks
  const blocks = raw.split(/\n\s*\n/).filter(b => b.trim());
  for (const block of blocks) {
    const id    = (block.match(/(?:^|\n)(?:ID|Message-ID):\s*(.+)/i)    || [])[1]?.trim();
    const from  = (block.match(/(?:^|\n)From:\s*(.+)/i)                  || [])[1]?.trim();
    const subj  = (block.match(/(?:^|\n)Subject:\s*(.+)/i)               || [])[1]?.trim();
    const date  = (block.match(/(?:^|\n)Date:\s*(.+)/i)                  || [])[1]?.trim();
    if (id && from && subj) {
      emails.push({
        message_id:  id,
        sender_email: extractEmail(from),
        sender_name:  extractName(from),
        subject:      subj,
        date:         date || null,
        account
      });
    }
  }
  return emails;
}

function extractEmail(from) {
  const m = from.match(/<([^>]+)>/);
  return m ? m[1] : from.trim();
}

function extractName(from) {
  const m = from.match(/^"?([^"<]+)"?\s*</);
  return m ? m[1].trim() : '';
}

async function fetchAllNewsletters(daysBack) {
  const results = await Promise.all(
    ACCOUNT_CONFIGS.map(cfg => fetchNewslettersFromAccount(cfg, daysBack))
  );
  return results.flat();
}

module.exports = { fetchAllNewsletters };
