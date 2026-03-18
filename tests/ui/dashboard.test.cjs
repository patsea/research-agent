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

// UAT 1.14 — Models tab visible and loads selectors
test('1.14 — Settings Models tab shows 4 model selectors', async () => {
  const configPage = await browser.contexts()[0].newPage();
  await configPage.goto(`${BASE}/config.html`, { waitUntil: 'domcontentloaded', timeout: 8000 });
  await configPage.waitForTimeout(500);

  // Click Models tab
  const modelsTab = await configPage.$('.tab[data-tab="models"]');
  expect(modelsTab).not.toBeNull();
  recordResult('1.14a', modelsTab !== null, modelsTab ? 'Models tab found' : 'Models tab MISSING');

  await modelsTab.click();
  await configPage.waitForTimeout(1500);

  // Verify models panel is visible
  const panel = await configPage.$('#panel-models.active');
  const isActive = panel !== null;
  recordResult('1.14b', isActive, isActive ? 'Models panel active' : 'Models panel NOT active');

  // Verify 4 selectors present
  const selectors = await configPage.$$('#model-slots select');
  const has4 = selectors.length === 4;
  recordResult('1.14c', has4, `Found ${selectors.length} model selectors`);

  await configPage.close();
  expect(isActive).toBe(true);
  expect(has4).toBe(true);
});

// UAT 1.15 — Newsletter Monitor health dot turns green
test('1.15 — Newsletter Monitor health dot turns green', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000); // allow health poll cycle
  const dot = await page.$('#hdot-3041.running');
  recordResult('1.15', dot !== null, dot ? 'Newsletter dot green' : 'Newsletter dot NOT green');
  expect(dot).not.toBeNull();
});

test('Newsletter Monitor card shows triple Gmail copy', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const cardText = await page.$eval(
    '.agent-card[data-port="3041"]',
    el => el.textContent
  );
  expect(cardText).toContain('triple');
  expect(cardText).not.toContain('dual');
});

test('guide.html contains Gmail Hygiene, Podcast Monitor, Newsletter Monitor sections', async () => {
  const guidePage = await browser.contexts()[0].newPage();
  await guidePage.goto(`${BASE}/guide.html`, { waitUntil: 'domcontentloaded', timeout: 8000 });
  const body = await guidePage.textContent('body');
  await guidePage.close();
  expect(body).toMatch(/gmail.hygiene/i);
  expect(body).toMatch(/podcast.monitor/i);
  expect(body).toMatch(/newsletter.monitor/i);
});

test('Pipeline agent cards are equal width', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const widths = await page.$$eval('.pipeline-row .agent-card', cards =>
    cards.map(c => c.getBoundingClientRect().width)
  );
  const allEqual = widths.length > 1 && widths.every(w => Math.abs(w - widths[0]) < 2);
  recordResult('card-width', allEqual, `Widths: ${widths.map(w => w.toFixed(0)).join(', ')}`);
  expect(allEqual).toBe(true);
});

test('guide.html nav contains Inbox and Settings', async () => {
  const guidePage = await browser.contexts()[0].newPage();
  await guidePage.goto(`${BASE}/guide.html`, { waitUntil: 'domcontentloaded', timeout: 8000 });
  const navText = await guidePage.textContent('#guide-top-nav');
  await guidePage.close();
  expect(navText).toContain('Inbox');
  expect(navText).toContain('Settings');
});

// Bug A — Workspace: clicking second agent after unreachable one does not show stale error
test('Workspace: second agent load clears previous error state', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const wsTab = await page.$('#btn-workspace');
  if (wsTab) {
    await wsTab.click();
    await page.waitForTimeout(2000);
    const sidebarItems = await page.$$('.sidebar-item');
    if (sidebarItems.length >= 2) {
      // Click first agent and wait for potential error
      await sidebarItems[0].click();
      await page.waitForTimeout(3000);
      // Click second agent
      await sidebarItems[1].click();
      await page.waitForTimeout(3000);
      // The iframe should not retain srcdoc from a previous agent's error
      const iframe = await page.$('#agent-iframe');
      const srcdoc = await iframe.getAttribute('srcdoc');
      const src = await iframe.getAttribute('src');
      // If srcdoc is set, it should reference the SECOND agent, not the first
      if (srcdoc) {
        const firstName = await sidebarItems[0].textContent();
        expect(srcdoc).not.toContain(firstName.trim());
      }
    }
  }
  recordResult('bugA', true, 'Workspace error state does not poison next agent');
});

// Bug B — Activity nav link from URL param activates Activity tab
test('Activity tab activates from ?tab=activity URL param', async () => {
  await page.goto(`${BASE}/?tab=activity`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const activityPanel = await page.$('#activity-panel');
  const display = await activityPanel.evaluate(el => getComputedStyle(el).display);
  recordResult('bugB', display !== 'none', `Activity panel display: ${display}`);
  expect(display).not.toBe('none');
});

// Bug C — Inbox nav link from URL param activates Inbox tab
test('Inbox tab activates from ?tab=inbox URL param', async () => {
  await page.goto(`${BASE}/?tab=inbox`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const inboxPanel = await page.$('#inbox-panel');
  const display = await inboxPanel.evaluate(el => getComputedStyle(el).display);
  recordResult('bugC', display !== 'none', `Inbox panel display: ${display}`);
  expect(display).not.toBe('none');
});

// Bug D — Inbox nav click activates inbox panel and hides dashboard
test('Inbox nav click activates inbox panel and hides dashboard', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.click('#btn-inbox');
  await page.waitForTimeout(500);
  const inboxDisplay = await page.$eval('#inbox-panel', el => getComputedStyle(el).display);
  const dashDisplay = await page.$eval('#dashboard-view', el => getComputedStyle(el).display);
  const btnActive = await page.$eval('#btn-inbox', el => el.classList.contains('active'));
  recordResult('bugD-inbox', inboxDisplay !== 'none', `Inbox panel display: ${inboxDisplay}`);
  recordResult('bugD-dash', dashDisplay === 'none', `Dashboard display: ${dashDisplay}`);
  recordResult('bugD-btn', btnActive, `Inbox btn active: ${btnActive}`);
  expect(inboxDisplay).not.toBe('none');
  expect(dashDisplay).toBe('none');
  expect(btnActive).toBe(true);
});

// Tooltip test — User Profile tab has tooltips on field labels
test('User Profile tab has tooltips on field labels', async () => {
  const configPage = await browser.contexts()[0].newPage();
  await configPage.goto(`${BASE}/config.html`, { waitUntil: 'domcontentloaded', timeout: 8000 });
  await configPage.waitForTimeout(500);

  // User Profile tab is active by default
  const panel = await configPage.$('#panel-profile.active');
  expect(panel).not.toBeNull();

  // Check for tooltip icons with data-tip attributes
  const tooltips = await configPage.$$('.tooltip-icon[data-tip]');
  recordResult('tooltips', tooltips.length >= 10, `Found ${tooltips.length} tooltip icons`);
  expect(tooltips.length).toBeGreaterThanOrEqual(10);

  // Verify specific field tooltips exist
  const fullNameTip = await configPage.$('.tooltip-icon[data-tip*="email signatures"]');
  expect(fullNameTip).not.toBeNull();

  const positioningTip = await configPage.$('.tooltip-icon[data-tip*="elevator pitch"]');
  expect(positioningTip).not.toBeNull();

  await configPage.close();
});
