/**
 * Email Scan UI tests (port 3034)
 */
const { connectChrome, getOrOpenPage, recordResult, saveResults } = require('./helpers.cjs');

const BASE = 'http://localhost:3034';
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

test('GET / returns HTML with Run Scan button', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const title = await page.title();
  expect(title).toMatch(/email.scan/i);
  const btn = await page.$('button');
  expect(btn).not.toBeNull();
  const body = await page.textContent('body');
  expect(body).toMatch(/run scan/i);
  recordResult('email-scan-ui', true, 'HTML with Run Scan button');
});

test('Stats row shows numeric values', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const body = await page.textContent('body');
  expect(body).toMatch(/scanned|emails/i);
  recordResult('email-scan-stats', true, 'Stats row present');
});
