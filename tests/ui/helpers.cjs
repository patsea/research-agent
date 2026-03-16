/**
 * Shared CDP helper for UI tests
 * Connects to existing Chrome session — never launches a new browser
 */
const { chromium } = require('playwright');

const CDP_URL = 'http://localhost:9222';
const RESULTS = [];

async function connectChrome() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  return browser;
}

async function getOrOpenPage(browser, url) {
  // Find existing tab matching url, or open new one
  for (const ctx of browser.contexts()) {
    for (const pg of ctx.pages()) {
      if (pg.url().startsWith(url)) return pg;
    }
  }
  const ctx = browser.contexts()[0] || await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
  return page;
}

function recordResult(id, pass, notes = '') {
  RESULTS.push({ id, pass, notes, ts: new Date().toISOString() });
  console.log(`${pass ? '✅' : '❌'} UAT ${id}${notes ? ': ' + notes : ''}`);
}

function saveResults() {
  const fs = require('fs');
  fs.writeFileSync('/tmp/playwright-uat-results.json', JSON.stringify(RESULTS, null, 2));
}

module.exports = { connectChrome, getOrOpenPage, recordResult, saveResults };
