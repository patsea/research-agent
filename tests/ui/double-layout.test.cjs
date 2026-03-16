/**
 * Dashboard double layout test
 * Confirms only ONE layout section is rendered — no legacy grid visible
 */
const { chromium } = require('playwright');

let browser, page;

beforeAll(async () => {
  browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  page = await ctx.newPage();
  await page.goto('http://localhost:3030', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
});

afterAll(async () => {
  await browser.close();
});

test('Only one Pipeline Agents heading visible', async () => {
  const headings = await page.$$eval('*', els =>
    els.filter(e => e.textContent.trim() === 'Pipeline Agents' &&
      getComputedStyle(e).display !== 'none' &&
      getComputedStyle(e).visibility !== 'hidden')
    .length
  );
  expect(headings).toBe(1);
});

test('Legacy agent-grid has no visible content', async () => {
  const grid = await page.$('#agent-grid');
  if (grid) {
    const display = await grid.evaluate(el => getComputedStyle(el).display);
    const children = await grid.$$('*');
    const visibleChildren = await grid.evaluate(el => {
      return Array.from(el.querySelectorAll('*'))
        .filter(c => getComputedStyle(c).display !== 'none').length;
    });
    expect(display === 'none' || visibleChildren === 0).toBe(true);
  }
  // If #agent-grid doesn't exist, that's also acceptable (fully removed)
});

test('Dashboard has exactly 9 agent health indicators', async () => {
  const hdots = await page.$$('[id^="hdot-"]');
  expect(hdots.length).toBe(9);
});
