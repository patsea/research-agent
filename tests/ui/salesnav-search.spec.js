/**
 * Sales Navigator — Generalised lead search
 * Reads job spec from JOB_FILE, writes results to RESULTS_FILE.
 * Connects to running Chrome via CDP (user must be logged into Sales Nav).
 *
 * Usage:
 *   1. Launch Chrome with: /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *   2. Log into Sales Navigator in that Chrome
 *   3. Run: JOB_FILE=/tmp/salesnav-job.json RESULTS_FILE=/tmp/salesnav-results.json node tests/ui/salesnav-search.spec.js
 */
const { chromium } = require('playwright');
const fs = require('fs');

const JOB_FILE = process.env.JOB_FILE || '/tmp/salesnav-job.json';
const RESULTS_FILE = process.env.RESULTS_FILE || '/tmp/salesnav-results.json';

function readSpec() {
  return JSON.parse(fs.readFileSync(JOB_FILE, 'utf8'));
}

function writeResults(data) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2));
}

async function ensureLoggedIn(page) {
  await page.goto('https://www.linkedin.com/sales/home', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  if (page.url().includes('/login') || page.url().includes('/checkpoint')) {
    throw new Error('Not logged into Sales Navigator — log in manually first then re-run.');
  }
  console.log('✅ Logged into Sales Navigator');
}

async function searchCompany(page, company, spec) {
  const titleQuery = encodeURIComponent(spec.title_keywords.join(' OR '));
  const companyQuery = encodeURIComponent(company);

  let url = `https://www.linkedin.com/sales/search/people?query=(keywords:${titleQuery},filters:List((type:CURRENT_COMPANY,values:List((text:${companyQuery},selectionType:INCLUDED)))))`;

  if (spec.geography) {
    const geoQuery = encodeURIComponent(spec.geography);
    url = `https://www.linkedin.com/sales/search/people?query=(keywords:${titleQuery},filters:List((type:CURRENT_COMPANY,values:List((text:${companyQuery},selectionType:INCLUDED))),(type:REGION,values:List((text:${geoQuery},selectionType:INCLUDED)))))`;
  }

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // Check for no results
  const noResults = await page.locator('text=No results found, text=0 results, text=No lead results')
    .first().isVisible({ timeout: 3000 }).catch(() => false);

  if (noResults) {
    console.log(`  ⬜ No results: ${company}`);
    return { contacts: [], notFound: true };
  }

  // Scroll to load lazy results
  for (let scroll = 0; scroll < 5; scroll++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // Extract results
  const resultEls = await page.locator(
    '[data-view-name="search-results-lead-result"], li.artdeco-list__item, .search-results__result-item'
  ).all();

  const maxResults = spec.max_results_per_company || 5;
  const contacts = [];

  for (const el of resultEls.slice(0, maxResults)) {
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);

      const nameEl = el.locator('[data-anonymize="person-name"], .result-lockup__name, a[data-control-name="view_lead"] span').first();
      const titleEl = el.locator('[data-anonymize="title"], .result-lockup__highlight-keyword, .t-14.t-black--light').first();
      const linkEl = el.locator('a[href*="/sales/lead/"], a[href*="/sales/people/"]').first();

      const fullName = (await nameEl.textContent().catch(() => '')).trim();
      const jobTitle = (await titleEl.textContent().catch(() => '')).trim();
      const href = await linkEl.getAttribute('href').catch(() => '');
      const salesNavUrl = href ? (href.startsWith('http') ? href : `https://www.linkedin.com${href}`) : '';

      if (!fullName) continue;

      // Split name into first/last
      const nameParts = fullName.split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      contacts.push({
        first_name: firstName,
        last_name: lastName,
        job_title: jobTitle,
        company_name: company,
        sales_nav_url: salesNavUrl,
        source_company: company,
      });

      console.log(`    📌 ${fullName} — ${jobTitle}`);
    } catch (e) {
      // continue on per-result errors
    }
  }

  return { contacts, notFound: contacts.length === 0 };
}

async function extractResultsFromPage(page, maxResults) {
  // Scroll to load lazy results
  for (let scroll = 0; scroll < 5; scroll++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  const resultEls = await page.locator(
    '[data-view-name="search-results-lead-result"], li.artdeco-list__item, .search-results__result-item'
  ).all();

  const contacts = [];
  for (const el of resultEls.slice(0, maxResults)) {
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);

      const nameEl = el.locator('[data-anonymize="person-name"], .result-lockup__name, a[data-control-name="view_lead"] span').first();
      const titleEl = el.locator('[data-anonymize="title"], .result-lockup__highlight-keyword, .t-14.t-black--light').first();
      const companyEl = el.locator('[data-anonymize="company-name"], .result-lockup__position-company a, .t-14.t-black--light').nth(1);
      const linkEl = el.locator('a[href*="/sales/lead/"], a[href*="/sales/people/"]').first();

      const fullName = (await nameEl.textContent().catch(() => '')).trim();
      const jobTitle = (await titleEl.textContent().catch(() => '')).trim();
      const companyName = (await companyEl.textContent().catch(() => '')).trim();
      const href = await linkEl.getAttribute('href').catch(() => '');
      const salesNavUrl = href ? (href.startsWith('http') ? href : `https://www.linkedin.com${href}`) : '';

      if (!fullName) continue;
      const nameParts = fullName.split(/\s+/);

      contacts.push({
        first_name: nameParts[0] || '',
        last_name: nameParts.slice(1).join(' ') || '',
        job_title: jobTitle,
        company_name: companyName || '',
        sales_nav_url: salesNavUrl,
        source_company: companyName || '',
      });
      console.log(`    📌 ${fullName} — ${jobTitle} at ${companyName}`);
    } catch (e) { /* continue */ }
  }
  return contacts;
}

async function runFilterSearch(page, spec, state) {
  const f = spec.filters || {};
  const titleQuery = encodeURIComponent((f.title_keywords || []).join(' OR '));
  const maxResults = spec.max_results || 200;

  // Build filter URL
  let filters = [];
  if (f.geography && f.geography.length > 0) {
    const geos = (Array.isArray(f.geography) ? f.geography : [f.geography]);
    const geoValues = geos.map(g => `(text:${encodeURIComponent(g)},selectionType:INCLUDED)`).join(',');
    filters.push(`(type:REGION,values:List(${geoValues}))`);
  }
  if (f.schools && f.schools.length > 0) {
    const schoolValues = f.schools.map(s => `(text:${encodeURIComponent(s)},selectionType:INCLUDED)`).join(',');
    filters.push(`(type:SCHOOL,values:List(${schoolValues}))`);
  }
  if (f.seniority && f.seniority.length > 0) {
    const senValues = f.seniority.map(s => `(text:${encodeURIComponent(s)},selectionType:INCLUDED)`).join(',');
    filters.push(`(type:SENIORITY_LEVEL,values:List(${senValues}))`);
  }

  const filterStr = filters.length > 0 ? ',' + filters.join(',') : '';
  let pageNum = 1;
  let collected = 0;

  while (collected < maxResults) {
    const url = `https://www.linkedin.com/sales/search/people?query=(keywords:${titleQuery},filters:List(${filterStr.replace(/^,/, '')}))&page=${pageNum}`;
    console.log(`[Page ${pageNum}] Searching...`);

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const noResults = await page.locator('text=No results found, text=0 results, text=No lead results')
      .first().isVisible({ timeout: 3000 }).catch(() => false);
    if (noResults && pageNum === 1) {
      console.log('  ⬜ No results found');
      break;
    }
    if (noResults) break; // no more pages

    const perPage = Math.min(25, maxResults - collected);
    const contacts = await extractResultsFromPage(page, perPage);

    if (contacts.length === 0) break; // no more results

    state.results.push(...contacts);
    collected += contacts.length;
    state.progress.current = collected;
    state.progress.total = maxResults;
    state.progress.current_company = `page ${pageNum}`;
    writeResults(state);

    console.log(`  ✓ Page ${pageNum}: ${contacts.length} contacts (${collected} total)`);

    if (contacts.length < 10) break; // likely last page
    pageNum++;
    await page.waitForTimeout(2000 + Math.random() * 1000);
  }

  return collected;
}

(async () => {
  const spec = readSpec();
  const isFilterMode = spec.mode === 'filter_search';

  if (isFilterMode) {
    const f = spec.filters || {};
    console.log(`\n🔍 Sales Navigator Filter Search — ${spec.label}`);
    console.log(`   Keywords: ${(f.title_keywords || []).join(', ')}`);
    console.log(`   Schools: ${(f.schools || []).join(', ') || '(none)'}`);
    console.log(`   Geography: ${(f.geography || []).join(', ') || '(none)'}`);
    console.log(`   Max results: ${spec.max_results}\n`);
  } else {
    console.log(`\n🔍 Sales Navigator Search — ${spec.label}`);
    console.log(`   ${spec.companies.length} companies, keywords: ${spec.title_keywords.join(', ')}\n`);
  }

  const state = {
    job_id: spec.job_id,
    status: 'running',
    progress: { current: 0, total: isFilterMode ? (spec.max_results || 200) : spec.companies.length, current_company: '' },
    results: [],
    not_found: [],
    errors: [],
  };
  writeResults(state);

  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    console.log('✅ Connected to Chrome via CDP');
  } catch (e) {
    console.error('❌ Cannot connect to Chrome on port 9222.');
    console.error('   Launch Chrome with: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222');
    state.status = 'error';
    state.errors.push('Cannot connect to Chrome on port 9222');
    writeResults(state);
    process.exit(1);
  }

  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page);

    if (isFilterMode) {
      await runFilterSearch(page, spec, state);
    } else {
      for (let i = 0; i < spec.companies.length; i++) {
        const company = spec.companies[i];
        state.progress.current = i + 1;
        state.progress.current_company = company;
        writeResults(state);

        console.log(`[${i + 1}/${spec.companies.length}] ${company}`);

        try {
          const result = await searchCompany(page, company, spec);
          if (result.notFound && result.contacts.length === 0) {
            state.not_found.push(company);
          }
          state.results.push(...result.contacts);
          writeResults(state);
        } catch (err) {
          console.error(`  ❌ Error searching ${company}: ${err.message}`);
          state.errors.push(`${company}: ${err.message}`);
          writeResults(state);
        }

        // Rate limiting — 2-3s between searches
        await page.waitForTimeout(2000 + Math.random() * 1000);
      }
    }

    state.status = 'complete';
    writeResults(state);

    console.log(`\n✅ Search complete.`);
    console.log(`   Total contacts found: ${state.results.length}`);
    console.log(`   Not found: ${state.not_found.length}`);
    console.log(`   Errors: ${state.errors.length}`);
  } catch (err) {
    state.status = 'error';
    state.errors.push(err.message);
    writeResults(state);
    console.error(`❌ Fatal error: ${err.message}`);
  } finally {
    await page.close();
    browser.close();
  }
})();
