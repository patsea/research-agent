/**
 * Shared browser helper for UI tests
 * Launches headless Chromium — no CDP or external Chrome required
 * Set HEADLESS=false for headed mode (useful for authenticated test flows)
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost';
const HEADLESS = process.env.HEADLESS !== 'false';
const RESULTS = [];

async function connectChrome() {
  const browser = await chromium.launch({ headless: HEADLESS });
  return browser;
}

async function getOrOpenPage(browser, url) {
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
