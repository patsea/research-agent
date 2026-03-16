/**
 * Podcast Monitor UI tests (port 3040)
 * Covers: 4-tab structure, Subscriptions tab content, Settings tab prompt editor, per-feed metadata toggles
 */
const { connectChrome, getOrOpenPage, recordResult, saveResults } = require('./helpers.cjs');

const BASE = 'http://localhost:3040';
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

// PM-1 — 4 tabs present: Queue, Summaries, Subscriptions, Settings
test('PM-1 — Four tabs present', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const tabs = await page.$$('.tab');
  const tabTexts = [];
  for (const t of tabs) tabTexts.push((await t.textContent()).trim());
  const expected = ['Queue', 'Summaries', 'Subscriptions', 'Settings'];
  const allPresent = expected.every(e => tabTexts.includes(e));
  recordResult('PM-1', allPresent, `Tabs: ${tabTexts.join(', ')}`);
  expect(allPresent).toBe(true);
  expect(tabs.length).toBe(4);
});

// PM-2 — Subscriptions tab contains feed list (feed names or Add Feed)
test('PM-2 — Subscriptions tab has feed management', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  // Click Subscriptions tab
  const tabs = await page.$$('.tab');
  for (const t of tabs) {
    const text = (await t.textContent()).trim();
    if (text === 'Subscriptions') { await t.click(); break; }
  }
  await page.waitForTimeout(2000);
  // Wait for the subscriptions panel to become visible
  const subsPanel = await page.$('#tab-subscriptions');
  const isVisible = subsPanel ? await subsPanel.evaluate(el => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && !el.classList.contains('hidden');
  }) : false;
  // Check for feed-related content: Add Feed button or feed names
  const html = await page.evaluate(() => {
    const el = document.getElementById('tab-subscriptions');
    return el ? el.innerHTML : '';
  });
  const hasFeedContent = html.includes('Add Feed') || html.includes('Add RSS') ||
    html.includes('lenny') || html.includes('20vc') || html.includes('feed');
  recordResult('PM-2', isVisible && hasFeedContent, `Visible: ${isVisible}, feed content: ${hasFeedContent}`);
  expect(isVisible).toBe(true);
  expect(hasFeedContent).toBe(true);
});

// PM-3 — Settings tab has prompt editor, not feed list
test('PM-3 — Settings tab has prompt editor, not feeds', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  // Click Settings tab
  const tabs = await page.$$('.tab');
  for (const t of tabs) {
    const text = (await t.textContent()).trim();
    if (text === 'Settings') { await t.click(); break; }
  }
  await page.waitForTimeout(1500);
  const settingsPanel = await page.$('#tab-settings');
  const isVisible = settingsPanel ? await settingsPanel.isVisible() : false;
  const html = await page.evaluate(() => {
    const el = document.getElementById('tab-settings');
    return el ? el.innerHTML : '';
  });
  const hasPromptEditor = html.includes('textarea') || html.includes('prompt') || html.includes('Prompt');
  const hasFeedList = html.includes('RSS Feeds') || html.includes('feed-url');
  recordResult('PM-3', isVisible && hasPromptEditor && !hasFeedList,
    `Visible: ${isVisible}, prompts: ${hasPromptEditor}, feeds: ${hasFeedList}`);
  expect(isVisible).toBe(true);
  expect(hasPromptEditor).toBe(true);
  expect(hasFeedList).toBe(false);
});

// PM-4 — Per-feed metadata toggle checkboxes exist in Subscriptions
test('PM-4 — Per-feed metadata toggles present', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  // Click Subscriptions tab
  const tabs = await page.$$('.tab');
  for (const t of tabs) {
    const text = (await t.textContent()).trim();
    if (text === 'Subscriptions') { await t.click(); break; }
  }
  await page.waitForTimeout(1500);
  const html = await page.evaluate(() => {
    const el = document.getElementById('tab-subscriptions');
    return el ? el.innerHTML : '';
  });
  // Check for toggle checkboxes — should have at least show_thumbnail, show_audio_url etc.
  const hasCheckboxes = html.includes('type="checkbox"');
  const hasNewFields = html.includes('Thumbnail') || html.includes('thumbnail');
  recordResult('PM-4', hasCheckboxes && hasNewFields, `Checkboxes: ${hasCheckboxes}, new fields: ${hasNewFields}`);
  expect(hasCheckboxes).toBe(true);
  expect(hasNewFields).toBe(true);
});
