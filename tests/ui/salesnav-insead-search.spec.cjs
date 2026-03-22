/**
 * Sales Navigator — INSEAD + Operating Partner lead search
 * Connects to running Chrome via CDP (Patrick must be logged into Sales Nav)
 *
 * Usage:
 *   1. Launch Chrome with remote debugging:
 *      /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *   2. Log into Sales Navigator in that Chrome
 *   3. Run: node tests/ui/salesnav-insead-search.spec.cjs [insead|full]
 */
const { chromium } = require('playwright');
const fs = require('fs');

const mode = process.argv[2] || 'insead'; // 'insead' or 'full'

const INSEAD_LIST   = 'Track 2A/2B — INSEAD Priority';
const FULL_LIST     = 'Track 2A/2B — All Operating Partners';
const INSEAD_LOG    = '/tmp/salesnav-insead-results.csv';
const FULL_LOG      = '/tmp/salesnav-full-results.csv';
const NOT_FOUND_LOG = '/tmp/salesnav-no-results.txt';

const INSEAD_SCHOOL_ID = '5176';

const TITLE_KEYWORDS = [
  'Operating Partner',
  'Value Creation',
  'Portfolio Operations',
  'Head of Platform',
  'Chief of Staff',
  'Portfolio Support',
  'Transformation'
];

const COMPANIES = [
  // Track 2B
  'HgCapital', 'EQT Partners', 'Main Capital Partners', 'Permira',
  'Nordic Capital', 'Bridgepoint', 'IK Partners', 'Montagu Private Equity',
  'Inflexion', 'H.I.G. Capital', 'Waterland Private Equity',
  'Vitruvian Partners', 'Francisco Partners',
  // Track 2A PE Tier 1
  'Corpfin Capital', 'Miura Private Equity', 'Trilantic Europe',
  'Magnum Capital', 'Artá Capital', 'Diana Capital', 'GED Capital',
  // Track 2A PE Tier 2
  'Alantra Private Equity', 'Suma Capital', 'Sherpa Capital',
  'Oquendo Capital', 'Talde', 'Beka Finance Private Equity',
  'Axon Partners Group', 'Ysios Capital', 'Riva y García',
  'Realza Capital', 'Springwater Capital', 'Abac Capital',
  'Fremman Capital', 'Nmás1 Private Equity', 'Proa Capital',
  'Asterion Industrial Partners', 'Nazca Capital',
  // Track 2A VC Tier 1
  'Seaya Ventures', 'Kibo Ventures', 'Bonsai Partners', 'K Fund',
  'Nekko Capital', 'Big Sur Ventures', 'Inveready', 'Ship2B Ventures',
  'Lanzadera', 'Encomenda Smart Capital', 'All Iron Ventures',
  'Sabadell Venture Capital',
  // Track 2A VC Tier 2
  'Mundi Ventures', 'BeAble Capital', 'Caixa Capital Risc',
  'JME Venture Capital', 'Wayra', 'Bankinter Venture Capital',
  'Nauta Capital', 'Active VP', 'Adara Ventures', 'Capsa Ventures',
  'GPF Capital', 'Idinvest Partners', 'Portobello Ventures',
  'The Venture City', 'Alma Mundi'
];

async function ensureLoggedIn(page) {
  await page.goto('https://www.linkedin.com/sales/home', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  if (page.url().includes('/login') || page.url().includes('/checkpoint')) {
    throw new Error('Not logged into Sales Navigator — log in manually first then re-run.');
  }
  console.log('✅ Logged into Sales Navigator');
}

async function searchAndSave(page, company, withINSEAD, csvPath) {
  const titleQuery = encodeURIComponent(TITLE_KEYWORDS.join(' OR '));
  const companyQuery = encodeURIComponent(company);

  let url = `https://www.linkedin.com/sales/search/people?query=(keywords:${titleQuery},filters:List((type:CURRENT_COMPANY,values:List((text:${companyQuery},selectionType:INCLUDED)))))`;

  if (withINSEAD) {
    url = `https://www.linkedin.com/sales/search/people?query=(keywords:${titleQuery},filters:List((type:CURRENT_COMPANY,values:List((text:${companyQuery},selectionType:INCLUDED))),(type:SCHOOL,values:List((id:${INSEAD_SCHOOL_ID},text:INSEAD,selectionType:INCLUDED)))))`;
  }

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // Check for "no results" indicator
  const noResults = await page.locator('text=No results found, text=0 results, text=No lead results').first().isVisible({ timeout: 3000 }).catch(() => false);

  if (noResults) {
    console.log(`  ⬜ No results: ${company}${withINSEAD ? ' (INSEAD)' : ''}`);
    if (withINSEAD) {
      fs.appendFileSync(NOT_FOUND_LOG, `${company}\n`);
    }
    return 0;
  }

  // Try to get result count
  const countEl = page.locator('.search-results__total-count, [data-test-id="results-count"], .artdeco-pill__text').first();
  const countText = await countEl.textContent({ timeout: 5000 }).catch(() => '?');
  const count = parseInt(countText.replace(/[^0-9]/g, '')) || 0;

  if (count === 0) {
    // Double-check: look for any result items
    const anyResults = await page.locator('[data-view-name="search-results-lead-result"], li.artdeco-list__item').first().isVisible({ timeout: 3000 }).catch(() => false);
    if (!anyResults) {
      console.log(`  ⬜ No results: ${company}${withINSEAD ? ' (INSEAD)' : ''}`);
      if (withINSEAD) fs.appendFileSync(NOT_FOUND_LOG, `${company}\n`);
      return 0;
    }
  }

  console.log(`  🟢 ${count || '?'} result(s): ${company}${withINSEAD ? ' (INSEAD)' : ''}`);

  // Scroll down to load all visible results (Sales Nav lazy-loads)
  for (let scroll = 0; scroll < 5; scroll++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(500);
  }
  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // Collect results
  const results = await page.locator('[data-view-name="search-results-lead-result"], li.artdeco-list__item, .search-results__result-item').all();

  let saved = 0;
  for (const result of results.slice(0, 10)) {
    try {
      // Scroll result into view to ensure it's rendered
      await result.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);

      const nameEl  = result.locator('[data-anonymize="person-name"], .result-lockup__name, a[data-control-name="view_lead"] span').first();
      const titleEl = result.locator('[data-anonymize="title"], .result-lockup__highlight-keyword, .t-14.t-black--light').first();
      const locEl   = result.locator('[data-anonymize="location"], .result-lockup__misc-item, .t-12.t-black--light').first();
      const linkEl  = result.locator('a[href*="/sales/lead/"], a[href*="/sales/people/"]').first();

      const name     = (await nameEl.textContent().catch(() => '')).trim();
      const title    = (await titleEl.textContent().catch(() => '')).trim();
      const location = (await locEl.textContent().catch(() => '')).trim();
      const href     = await linkEl.getAttribute('href').catch(() => '');
      const profileUrl = href ? (href.startsWith('http') ? href : `https://www.linkedin.com${href}`) : '';

      if (!name) continue;

      const escapedName = name.replace(/"/g, '""');
      const escapedTitle = title.replace(/"/g, '""');
      const escapedLoc = location.replace(/"/g, '""');

      const row = `"${escapedName}","${escapedTitle}","${company}","${escapedLoc}","${profileUrl}"\n`;
      fs.appendFileSync(csvPath, row);
      saved++;
      console.log(`    📌 ${name} — ${title}`);
    } catch (e) {
      // continue on per-result errors
    }
  }

  return saved;
}

(async () => {
  const withINSEAD = mode === 'insead';
  const csvPath = withINSEAD ? INSEAD_LOG : FULL_LOG;
  const listName = withINSEAD ? INSEAD_LIST : FULL_LIST;

  console.log(`\n🔍 Sales Navigator Search — ${withINSEAD ? 'INSEAD Filter' : 'All Operating Roles'}`);
  console.log(`   Searching ${COMPANIES.length} companies\n`);

  // Resume support: if CSV already exists with data, append instead of overwriting
  const startIndex = parseInt(process.env.START_INDEX || '0');
  if (startIndex === 0) {
    fs.writeFileSync(csvPath, 'name,title,company,location,profile_url\n');
    if (withINSEAD) fs.writeFileSync(NOT_FOUND_LOG, '');
  } else {
    console.log(`   Resuming from company index ${startIndex}`);
  }

  let browser;
  try {
    // Connect to Chrome with remote debugging
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    console.log('✅ Connected to Chrome via CDP');
  } catch (e) {
    console.error(`\n❌ Cannot connect to Chrome on port 9222.`);
    console.error(`   Launch Chrome with: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222`);
    console.error(`   Then log into Sales Navigator and re-run.`);
    process.exit(1);
  }

  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page);

    let totalSaved = 0;
    for (let i = startIndex; i < COMPANIES.length; i++) {
      const company = COMPANIES[i];
      console.log(`[${i + 1}/${COMPANIES.length}] ${company}`);
      const saved = await searchAndSave(page, company, withINSEAD, csvPath);
      totalSaved += saved;
      // Rate limiting — 2-3s between searches
      await page.waitForTimeout(2000 + Math.random() * 1000);
    }

    console.log(`\n✅ Search complete.`);
    console.log(`   Total leads found: ${totalSaved}`);
    console.log(`   CSV: ${csvPath}`);
    if (withINSEAD) {
      const noResults = fs.readFileSync(NOT_FOUND_LOG, 'utf8').trim().split('\n').filter(Boolean);
      console.log(`   No INSEAD results for ${noResults.length} companies`);
    }
  } finally {
    await page.close();
    browser.close();
  }
})();
