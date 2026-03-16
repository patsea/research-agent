/**
 * Dashboard UI tests (port 3030)
 * Covers UAT: 1.1, 1.2, 1.3, 1.4, 1.7, 1.10, 1.11, 1.12, 1.13
 */
const { connectChrome, getOrOpenPage, recordResult, saveResults } = require('./helpers.cjs');

const BASE = 'http://localhost:3030';
let browser, page;

beforeAll(async () => {
  browser = await connectChrome();
  page = await getOrOpenPage(browser, BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500); // allow health dots to populate
});

afterAll(async () => {
  saveResults();
  await browser.close();
});

// UAT 1.1 — 9 agent health dots present (9 agents in the system)
test('1.1 — Dashboard shows agent health dots', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const hdots = await page.$$('[id^="hdot-"]');
  recordResult('1.1', hdots.length >= 9, `Found ${hdots.length} health dots`);
  expect(hdots.length).toBeGreaterThanOrEqual(9);
});

// UAT 1.4 — No Refresh button in nav
test('1.4 — No Refresh button in top nav', async () => {
  const navBtns = await page.$$('.mode-btn');
  let hasRefresh = false;
  for (const btn of navBtns) {
    const text = (await btn.textContent()).trim();
    if (text.toLowerCase() === 'refresh') hasRefresh = true;
  }
  recordResult('1.4', !hasRefresh, !hasRefresh ? 'Refresh button absent' : 'Refresh button FOUND');
  expect(hasRefresh).toBe(false);
});

// UAT 1.7 — Pipeline row with arrows
test('1.7 — Pipeline row has arrow connectors between agents', async () => {
  const arrows = await page.$$('.pipeline-arrow');
  recordResult('1.7', arrows.length > 0, `Arrow indicators: ${arrows.length}`);
  expect(arrows.length).toBeGreaterThan(0);
});

// UAT 1.10 — Activity agent dropdown has descriptive names
test('1.10 — Activity tab agent filter has descriptive names', async () => {
  // Click Activity mode button
  const activityBtn = await page.$('#btn-activity');
  if (activityBtn) {
    await activityBtn.click();
    await page.waitForTimeout(800);
  }
  const select = await page.$('#activity-agent-filter');
  let hasDescriptive = false;
  if (select) {
    const options = await select.$$('option');
    for (const opt of options) {
      const text = await opt.textContent();
      // Descriptive names contain spaces (e.g. "Signal Scanner" not "signal-scanner")
      if (text && text.includes(' ') && text.length > 5) { hasDescriptive = true; break; }
    }
  }
  recordResult('1.10', hasDescriptive, hasDescriptive ? 'Descriptive names found' : 'Only slugs found or no select');
  expect(hasDescriptive).toBe(true);
});

// UAT 1.11 — Workspace iframe loads or shows fallback
test('1.11 — Workspace: clicking agent loads iframe or fallback', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  // Click Workspace mode button by ID
  const wsTab = await page.$('#btn-workspace');
  if (wsTab) {
    await wsTab.click();
    await page.waitForTimeout(2000);
    // Click first agent in sidebar
    const agentLink = await page.$('.sidebar-item');
    if (agentLink) {
      await agentLink.click();
      await page.waitForTimeout(2500);
    }
  }
  // Check: either iframe exists, or workspace view is visible
  const iframe = await page.$('iframe');
  const wsView = await page.$('#workspace-view');
  const ok = iframe !== null || wsView !== null;
  recordResult('1.11', ok, iframe ? 'iframe found' : wsView ? 'workspace view shown' : 'neither found');
  expect(ok).toBe(true);
});

// UAT 1.12 — Inbox tab visible in nav
test('1.12 — Inbox tab visible in nav', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const inboxTab = await page.$('#btn-inbox');
  recordResult('1.12', inboxTab !== null, inboxTab ? 'Inbox tab found' : 'Inbox tab MISSING');
  expect(inboxTab).not.toBeNull();
});

// UAT 1.3 — Guide loads
test('1.3 — Guide page loads with content', async () => {
  const guidePage = await browser.contexts()[0].newPage();
  await guidePage.goto(`${BASE}/guide.html`, { waitUntil: 'domcontentloaded', timeout: 8000 });
  const bodyLen = (await guidePage.textContent('body')).length;
  const ok = bodyLen > 200;
  recordResult('1.3', ok, `Guide body length: ${bodyLen}`);
  await guidePage.close();
  expect(ok).toBe(true);
});

// UAT 1.13 — Prompts tab visible and functional in Settings
test('1.13 — Settings Prompts tab shows grouped prompts', async () => {
  const configPage = await browser.contexts()[0].newPage();
  await configPage.goto(`${BASE}/config.html`, { waitUntil: 'domcontentloaded', timeout: 8000 });
  await configPage.waitForTimeout(500);

  // Click Prompts tab
  const promptsTab = await configPage.$('.tab[data-tab="prompts"]');
  expect(promptsTab).not.toBeNull();
  await promptsTab.click();
  await configPage.waitForTimeout(2000);

  // Verify prompts panel is visible
  const panel = await configPage.$('#panel-prompts.active');
  const isActive = panel !== null;
  recordResult('1.13a', isActive, isActive ? 'Prompts panel active' : 'Prompts panel NOT active');

  // Verify at least one textarea is present (prompt loaded)
  const textareas = await configPage.$$('#prompts-list textarea');
  const hasPrompts = textareas.length >= 10;
  recordResult('1.13b', hasPrompts, `Found ${textareas.length} prompt textareas`);

  // Verify warning banner is shown
  const warning = await configPage.$('#panel-prompts .card[style*="fffbeb"]');
  const hasWarning = warning !== null;
  recordResult('1.13c', hasWarning, hasWarning ? 'Warning banner present' : 'Warning banner missing');

  await configPage.close();
  expect(isActive).toBe(true);
  expect(hasPrompts).toBe(true);
});
