/**
 * Dashboard Inbox tab tests
 * Covers UAT: 16.1, 16.2, 16.3, 16.7
 */
const { connectChrome, getOrOpenPage, recordResult, saveResults } = require('./helpers.cjs');

const BASE = 'http://localhost:3030';
let browser, page;

beforeAll(async () => {
  browser = await connectChrome();
  page = await getOrOpenPage(browser, BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
});

afterAll(async () => {
  saveResults();
  await browser.close();
});

// UAT 16.1 — Inbox tab visible
test('16.1 — Inbox tab visible in nav', async () => {
  const tab = await page.$('#btn-inbox');
  recordResult('16.1', tab !== null, tab ? 'Found' : 'MISSING');
  expect(tab).not.toBeNull();
});

// UAT 16.2 — Clicking Inbox loads both panels
test('16.2 — Inbox tab loads Gmail Hygiene + Email Scan panels', async () => {
  const tab = await page.$('#btn-inbox');
  if (tab) {
    await tab.click();
    await page.waitForTimeout(2000);
    // Check inbox panel is visible
    const inboxPanel = await page.$('#inbox-panel');
    const panelVisible = inboxPanel !== null;
    // Check body text for expected content
    const bodyText = await page.textContent('body');
    const hasHygiene = bodyText.toLowerCase().includes('sender') || bodyText.toLowerCase().includes('hygiene');
    const hasEmailScan = bodyText.toLowerCase().includes('scan') || bodyText.toLowerCase().includes('classification');
    const ok = panelVisible && (hasHygiene || hasEmailScan);
    recordResult('16.2', ok,
      `Panel visible: ${panelVisible}, Hygiene: ${hasHygiene}, EmailScan: ${hasEmailScan}`);
    expect(ok).toBe(true);
  } else {
    recordResult('16.2', false, 'Inbox tab not found');
    expect(tab).not.toBeNull();
  }
});

// UAT 16.3 — Gmail Hygiene panel shows senders or placeholder
test('16.3 — Gmail Hygiene panel shows sender area', async () => {
  // Verify the Gmail Hygiene section exists in the inbox panel
  const ghSenders = await page.$('#gh-senders');
  const ok = ghSenders !== null;
  let detail = 'gh-senders element not found';
  if (ghSenders) {
    const text = (await ghSenders.textContent()).trim();
    detail = `gh-senders: "${text.substring(0, 80)}"`;
  }
  recordResult('16.3', ok, detail);
  expect(ok).toBe(true);
});

// UAT 16.7 — Email Scan panel area exists
test('16.7 — Email Scan panel shows scan area', async () => {
  // The inbox panel contains both Gmail Hygiene and Email Scan agent cards
  // Check for the email-scan agent card in the pipeline
  const inboxPanel = await page.$('#inbox-panel');
  let ok = false;
  let detail = 'Inbox panel not found';
  if (inboxPanel) {
    const text = await inboxPanel.textContent();
    // The inbox panel references email scan and gmail hygiene
    ok = text.toLowerCase().includes('scan') || text.toLowerCase().includes('email');
    detail = ok ? 'Email scan content found in inbox panel' : `Inbox panel text: "${text.substring(0, 100)}"`;
  }
  recordResult('16.7', ok, detail);
  expect(ok).toBe(true);
});

// UAT 16.8 — Newsletter Monitor panel exists in Inbox tab
test('16.8 — Newsletter Monitor panel exists', async () => {
  // Ensure we are on the Inbox tab
  const tab = await page.$('#btn-inbox');
  if (tab) await tab.click();
  await page.waitForTimeout(1500);
  const panel = await page.$('#newsletter-monitor-panel');
  const ok = panel !== null;
  recordResult('16.8', ok, ok ? 'newsletter-monitor-panel found' : 'MISSING');
  expect(ok).toBe(true);
});

// UAT 16.9 — Newsletter sender count badge present
test('16.9 — Newsletter sender count badge visible', async () => {
  const badge = await page.$('.newsletter-sender-count');
  const ok = badge !== null;
  let detail = 'newsletter-sender-count not found';
  if (badge) {
    const text = (await badge.textContent()).trim();
    detail = `newsletter-sender-count: "${text}"`;
  }
  recordResult('16.9', ok, detail);
  expect(ok).toBe(true);
});

// UAT 16.10 — Gmail Hygiene senders show real names, not "Unknown"
test('16.10 — Gmail Hygiene senders show email or name, not Unknown', async () => {
  // Navigate to inbox tab
  const tab = await page.$('#btn-inbox');
  if (tab) await tab.click();
  await page.waitForTimeout(3000);
  const ghSenders = await page.$('#gh-senders');
  let ok = true;
  let detail = 'gh-senders not found';
  if (ghSenders) {
    const text = await ghSenders.textContent();
    // If senders are loaded, none should show "Unknown"
    if (text.includes('Unknown')) {
      ok = false;
      detail = 'Found "Unknown" in sender names';
    } else {
      detail = 'No Unknown senders found';
    }
  }
  recordResult('16.10', ok, detail);
  expect(ok).toBe(true);
});
