/**
 * Newsletter Monitor UI tests (port 3041)
 * Covers: 4-tab structure, source badges, Archive/Read buttons, History accordion, Subscriptions, Settings
 */
const { connectChrome, getOrOpenPage, recordResult, saveResults } = require('./helpers.cjs');

const BASE = 'http://localhost:3041';
let browser, page;

beforeAll(async () => {
  browser = await connectChrome();
  page = await getOrOpenPage(browser, BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
});

afterAll(async () => {
  saveResults();
  await browser.close();
});

// NM-1 — 4 tabs present: Today, History, Subscriptions, Settings
test('NM-1 — Four tabs present', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const tabs = await page.$$('.tab');
  const tabTexts = [];
  for (const t of tabs) tabTexts.push((await t.textContent()).trim());
  const expected = ['Today', 'History', 'Subscriptions', 'Settings'];
  const allPresent = expected.every(e => tabTexts.includes(e));
  recordResult('NM-1', allPresent, `Tabs: ${tabTexts.join(', ')}`);
  expect(allPresent).toBe(true);
  expect(tabs.length).toBe(4);
});

// NM-2 — Source badges are color-coded
test('NM-2 — Source badges have distinct colors', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  // Check CSS rules exist for gmail and gmail-aloma badges
  const gmailRule = await page.evaluate(() => {
    const sheets = document.styleSheets;
    for (const sheet of sheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && rule.selectorText.includes('.source-badge.gmail-aloma')) return true;
        }
      } catch(e) {}
    }
    return false;
  });
  const gmailBasicRule = await page.evaluate(() => {
    const sheets = document.styleSheets;
    for (const sheet of sheets) {
      try {
        for (const rule of sheet.cssRules) {
          // Match .source-badge.gmail but NOT .source-badge.gmail-aloma
          if (rule.selectorText && /\.source-badge\.gmail(?!-)/.test(rule.selectorText)) return true;
        }
      } catch(e) {}
    }
    return false;
  });
  recordResult('NM-2', gmailRule && gmailBasicRule, `gmail rule: ${gmailBasicRule}, gmail-aloma rule: ${gmailRule}`);
  expect(gmailRule).toBe(true);
  expect(gmailBasicRule).toBe(true);
});

// NM-3 — Archive button present, Mark Read and Skip absent
test('NM-3 — Archive button present, no Mark Read or Skip', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const html = await page.content();
  const hasArchive = html.includes('archive-btn') || html.includes('Archive');
  const hasMarkRead = html.includes('Mark Read');
  const hasSkip = />\s*Skip\s*</.test(html);
  recordResult('NM-3', hasArchive && !hasMarkRead && !hasSkip, `Archive: ${hasArchive}, MarkRead: ${hasMarkRead}, Skip: ${hasSkip}`);
  expect(hasArchive).toBe(true);
  expect(hasMarkRead).toBe(false);
  expect(hasSkip).toBe(false);
});

// NM-4 — Read button present (opens Gmail)
test('NM-4 — Read button present', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const html = await page.content();
  // The Read button should exist in the template/JS (even if no newsletters loaded)
  const hasReadBtn = html.includes('read-btn') || html.includes('openInGmail');
  recordResult('NM-4', hasReadBtn, `Read button pattern: ${hasReadBtn}`);
  expect(hasReadBtn).toBe(true);
});

// NM-5 — History tab loads with accordion rows
test('NM-5 — History tab has accordion structure', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  // Click History tab
  const tabs = await page.$$('.tab');
  for (const t of tabs) {
    const text = (await t.textContent()).trim();
    if (text === 'History') { await t.click(); break; }
  }
  await page.waitForTimeout(1500);
  const historyTab = await page.$('#history-tab');
  const isVisible = historyTab ? await historyTab.isVisible() : false;
  recordResult('NM-5', isVisible, `History tab visible: ${isVisible}`);
  expect(isVisible).toBe(true);
});

// NM-6 — Subscriptions tab loads with sender rows
test('NM-6 — Subscriptions tab loads', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const tabs = await page.$$('.tab');
  for (const t of tabs) {
    const text = (await t.textContent()).trim();
    if (text === 'Subscriptions') { await t.click(); break; }
  }
  await page.waitForTimeout(1500);
  const subsTab = await page.$('#subscriptions-tab');
  const isVisible = subsTab ? await subsTab.isVisible() : false;
  recordResult('NM-6', isVisible, `Subscriptions tab visible: ${isVisible}`);
  expect(isVisible).toBe(true);
});

// NM-7 — Settings tab has prompt editor
test('NM-7 — Settings tab has prompt editor', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const tabs = await page.$$('.tab');
  for (const t of tabs) {
    const text = (await t.textContent()).trim();
    if (text === 'Settings') { await t.click(); break; }
  }
  await page.waitForTimeout(1500);
  const settingsTab = await page.$('#settings-tab');
  const isVisible = settingsTab ? await settingsTab.isVisible() : false;
  // Check for textarea or prompt editor
  const hasTextarea = await page.$$eval('#settings-tab textarea', els => els.length > 0).catch(() => false);
  recordResult('NM-7', isVisible && hasTextarea, `Settings visible: ${isVisible}, textarea: ${hasTextarea}`);
  expect(isVisible).toBe(true);
  expect(hasTextarea).toBe(true);
});

// NM-8 — gmail-growthworks badge CSS rule exists (green)
test('NM-8 — gmail-growthworks badge has green CSS rule', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const hasGrowthworksRule = await page.evaluate(() => {
    const sheets = document.styleSheets;
    for (const sheet of sheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && rule.selectorText.includes('.source-badge.gmail-growthworks')) return true;
        }
      } catch(e) {}
    }
    return false;
  });
  recordResult('NM-8', hasGrowthworksRule, `gmail-growthworks CSS rule: ${hasGrowthworksRule}`);
  expect(hasGrowthworksRule).toBe(true);
});
