/**
 * Gmail Hygiene UI tests (port 3039)
 */
const { connectChrome, getOrOpenPage, recordResult, saveResults } = require('./helpers.cjs');

const BASE = 'http://localhost:3039';
let browser, page;

beforeAll(async () => {
  browser = await connectChrome();
  page = await getOrOpenPage(browser, BASE);
  await page.waitForLoadState('domcontentloaded');
});

afterAll(async () => {
  saveResults();
  await browser.close();
});

test('GET / returns HTML with scan buttons', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const title = await page.title();
  expect(title).toMatch(/gmail.hygiene/i);
  const body = await page.textContent('body');
  expect(body).toMatch(/scan 7/i);
  expect(body).toMatch(/scan 30/i);
  recordResult('gmail-hygiene-ui', true, 'HTML with scan buttons');
});

test('Senders table present', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const table = await page.$('table, .senders-list, [class*="sender"]');
  expect(table).not.toBeNull();
  recordResult('gmail-hygiene-senders', true, 'Senders table present');
});

test('Gmail Hygiene uses light background', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const bg = await page.evaluate(() =>
    getComputedStyle(document.body).backgroundColor
  );
  // Dark theme uses rgb(15,17,23) / rgb(18,18,...) / rgb(26,26,...) — all low values
  const isDark = bg.includes('15, 17') || bg.includes('18, 18') || bg.includes('26, 26');
  expect(isDark).toBe(false);
  recordResult('gmail-hygiene-light-theme', !isDark, `body bg: ${bg}`);
});
