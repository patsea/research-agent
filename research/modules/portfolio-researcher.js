import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { deepResearch } from './perplexity.js';
import { researchRuns } from '../db.js';

const __dirname_pr = dirname(fileURLToPath(import.meta.url));
function _getProfile() {
  return JSON.parse(readFileSync(join(__dirname_pr, '../../config/user-profile.json'), 'utf8'));
}

const ELNS_DIMENSIONS = [
  'Leadership composition gap (technical founding team, no product hire)',
  'Funding stage timing (Series A/B, 6-18 months post-raise)',
  'AI readiness deficit (traditional SaaS facing disruption)',
  'Growth signal without product scaling evidence',
  'Headcount growth without senior product hire',
  'Founder/CEO background mismatch (technical or commercial, not product)',
  'Recent product/ops job postings (indicates gap awareness)',
  'Competitive pressure signals (market moving faster than product)'
];

export async function runPortfolioResearch(input) {
  const { fundName, contactName, context, topN = 5 } = input;
  if (!fundName) throw new Error('fundName required');

  const today = new Date().toISOString().split('T')[0];
  const dimensionList = ELNS_DIMENSIONS.map((d, i) => `${i + 1}. ${d}`).join('\n');

  const p = _getProfile();
  const profileContext = `A ${p.roles[0]?.title || 'CPO/COO'} with ${p.ai_experience} and a PE-backed transformation track record is reviewing this fund's portfolio. Key credentials:\n${p.roles.map(r => '- ' + r.company + ': ' + r.title + ', ' + r.highlight).join('\n')}\n- ${p.education}, ${p.location.split(' —')[0]}\n- Positioning: ${p.positioning}`;

  const promptTemplate = readFileSync(
    join(__dirname_pr, '../../config/prompts/portfolio-researcher.md'), 'utf8');
  const prompt = promptTemplate
    .replace(/\{FIRM_NAME\}/g, fundName)
    .replace('{FIRM_WEBSITE}', input.firmWebsite || '')
    .replace('{GEOGRAPHY_FOCUS}', input.geographyFocus || '')
    .replace('{SECTOR_FOCUS}', input.sectorFocus || '')
    .replace('{RESEARCH_CONTEXT}', [
      profileContext,
      contactName ? `Fund contact: ${contactName}` : '',
      context ? `Discussion context: ${context}` : ''
    ].filter(Boolean).join('\n'));

  console.log(`Running Perplexity deep research on ${fundName} portfolio...`);
  const markdown = await deepResearch(prompt, 6000);
  console.log(`Portfolio research complete: ${markdown.length} chars`);

  // Parse ranked companies from the markdown — multiple strategies
  let rankedCompanies = [];

  // Strategy 0: Parse "#### Company N: Name (description)" section headers
  // This is the most common format from Perplexity deep research
  {
    const companyHeaderPattern = /^#{2,4}\s+Company\s+(\d+)\s*[:–—]\s*([^(\n]+?)(?:\s*\(([^)]*)\))?\s*$/gm;
    let match;
    while ((match = companyHeaderPattern.exec(markdown)) !== null) {
      rankedCompanies.push({
        rank: parseInt(match[1]),
        company: match[2].trim(),
        sector: match[3] ? match[3].trim() : '',
        score: '',
        signals: ''
      });
    }
    if (rankedCompanies.length > 0) console.log(`Strategy 0 (company headers): ${rankedCompanies.length} companies`);
  }

  // Strategy 1: Parse summary ranking table (| Rank | Company | Sector | Score | Signals |)
  const tableLines = markdown.split('\n').filter(l => l.includes('|') && !l.includes('---'));
  for (const line of tableLines) {
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length >= 4 && /^\d+$/.test(cols[0].replace(/[.*#]/g, ''))) {
      rankedCompanies.push({
        rank: parseInt(cols[0].replace(/[^0-9]/g, '')),
        company: cols[1].replace(/\*\*/g, '').trim(),
        sector: cols[2].replace(/\*\*/g, '').trim(),
        score: cols[3].replace(/\*\*/g, '').trim(),
        signals: cols[4] || ''
      });
    }
  }
  if (rankedCompanies.length > 0) console.log(`Strategy 1 (table): ${rankedCompanies.length} companies`);

  // Strategy 2: Extract from numbered list patterns (1. **Company Name** — description)
  if (rankedCompanies.length === 0) {
    const numberedPattern = /^\s*(\d+)\.\s+\*\*([^*]+)\*\*/gm;
    let match;
    while ((match = numberedPattern.exec(markdown)) !== null) {
      const name = match[2].trim();
      if (name.length > 2 && !name.match(/^(rank|company|sector|score|signal|dimension|overview|summary|methodology|leadership|funding|ai\s|growth|headcount|founder|recent|competitive|composition|readiness)/i)) {
        rankedCompanies.push({
          rank: parseInt(match[1]),
          company: name,
          sector: '',
          score: '',
          signals: ''
        });
      }
    }
    if (rankedCompanies.length > 0) console.log(`Strategy 2 (numbered list): ${rankedCompanies.length} companies`);
  }

  // Strategy 3: Extract from section headers (### 3.1 Company Name: Description)
  if (rankedCompanies.length === 0) {
    const headerPattern = /^#{2,4}\s+(?:\d+\.?\d*\s+)?([A-Z][A-Za-z0-9\s&.,'/()-]+?)(?:\s*[:–—]|\s*$)/gm;
    let match;
    let rank = 1;
    const skipHeaders = /^(executive|portfolio|methodology|overview|summary|montagu|creandum|elns|framework|appendix|conclusion|reference|source|key\b|top\b|assessment|detailed|analysis|strategic|active|composition|section|candidate|company|dimension|why|conversation|how|where|what|complete|list|other|notable|consumer|marketplace|healthcare|enterprise|funding|ai\s+infrastructure|background|context|discussion|introduction|fund\b|recent|current)/i;
    while ((match = headerPattern.exec(markdown)) !== null) {
      const name = match[1].trim();
      if (name.length > 2 && name.length < 80 && !skipHeaders.test(name)) {
        rankedCompanies.push({
          rank: rank++,
          company: name,
          sector: '',
          score: '',
          signals: ''
        });
      }
    }
    if (rankedCompanies.length > 0) console.log(`Strategy 3 (headers): ${rankedCompanies.length} companies`);
  }

  // Strategy 4: Extract bold company names with business indicators from prose
  if (rankedCompanies.length === 0) {
    const boldPattern = /\*\*([A-Z][A-Za-z0-9\s&.,'/()-]+?)\*\*/g;
    let match;
    let rank = 1;
    const seen = new Set();
    const skipTerms = /^(executive|portfolio|montagu|elns|note|warning|important|update|date|contact|context|summary|rank|company|open\b|march|july|august|january|february|section|why|how|conversation|this)/i;
    const companyIndicators = /\b(software|saas|tech|digital|group|limited|ltd|inc|corp|solutions|platform|systems|analytics|data|health|medical|clinical|insurance|financial|education|monitoring|intelligence|payments|logistics|manufacturing)\b/i;
    while ((match = boldPattern.exec(markdown)) !== null) {
      const name = match[1].trim();
      const surrounding = markdown.substring(Math.max(0, match.index - 150), match.index + match[0].length + 150);
      if (name.length > 2 && name.length < 60 && !skipTerms.test(name) && !seen.has(name.toLowerCase())) {
        if (companyIndicators.test(name) || companyIndicators.test(surrounding) ||
            /\b(portfolio|company|compan|business|revenue|employee|founded|acquired|sector)\b/i.test(surrounding)) {
          seen.add(name.toLowerCase());
          const scoreMatch = surrounding.match(/(\d{1,2})\s*(?:\/\s*16|out of\s*16|ELNS|points?)/i);
          rankedCompanies.push({
            rank: rank++,
            company: name,
            sector: '',
            score: scoreMatch ? `${scoreMatch[1]}/16` : '',
            signals: ''
          });
        }
      }
    }
    if (rankedCompanies.length > 0) console.log(`Strategy 4 (bold names): ${rankedCompanies.length} companies`);
  }

  // Strategy 5: Extract "CompanyName (description)" patterns from inline prose
  // Matches patterns like: Wireless Logic (IoT connectivity platform), ITRS Group (monitoring software)
  if (rankedCompanies.length === 0) {
    const inlinePattern = /(?:^|[,;]\s*|include\s+|including\s+|companies?\s+|and\s+)([A-Z][A-Za-z0-9&\s.'-]{1,50}?)\s*\(([^)]{5,200})\)/g;
    let match;
    let rank = 1;
    const seen = new Set();
    const descIndicators = /\b(software|saas|platform|tech|digital|data|analytics|intelligence|monitoring|management|services|solutions|education|insurance|healthcare|medical|iot|connectivity|crm|accounting|compliance|governance|fund|document|defense|aerospace|maritime|manufacturing|automation|ai|fintech|fraud|payments)\b/i;
    const skipNames = /^(dimension|section|approximately|notably|within|among|confirmed|the\s|this\s|that\s|these\s|those\s|such\s|however|because|although|while|since|where|which|when|after|before|between|beyond|across)/i;
    while ((match = inlinePattern.exec(markdown)) !== null) {
      const name = match[1].trim();
      const desc = match[2].trim();
      if (name.length > 2 && name.length < 55 && !skipNames.test(name) && !seen.has(name.toLowerCase()) && descIndicators.test(desc)) {
        seen.add(name.toLowerCase());
        rankedCompanies.push({
          rank: rank++,
          company: name,
          sector: desc.split(',')[0].trim(),
          score: '',
          signals: ''
        });
      }
    }
    if (rankedCompanies.length > 0) console.log(`Strategy 5 (inline prose): ${rankedCompanies.length} companies`);
  }

  // Enrich: extract ELNS total scores from per-company dimension tables
  // Handles multiple formats: table cells, bold standalone lines, inline text
  if (rankedCompanies.length > 0) {
    const scores = [];
    let m;
    // Format 1: | **ELNS Total Score** | **/16** | **6/16** |
    const tableScorePattern = /\*\*ELNS Total Score\*\*\s*\|\s*\*\*\/16\*\*\s*\|\s*\*\*(\d{1,2})\/16\*\*/g;
    while ((m = tableScorePattern.exec(markdown)) !== null) {
      scores.push(m[1] + '/16');
    }
    // Format 2: **ELNS Total Score: X/16** (standalone bold line)
    if (scores.length === 0) {
      const boldScorePattern = /\*\*ELNS Total Score\s*[:–—]\s*(\d{1,2})\/16\*\*/g;
      while ((m = boldScorePattern.exec(markdown)) !== null) {
        scores.push(m[1] + '/16');
      }
    }
    // Format 3: | **Total** | **X/16** | or Total ELNS Score: X/16
    if (scores.length === 0) {
      const altPattern = /(?:Total|ELNS)\s*(?:Score)?[^|\n]*?(?:\|[^|]*?)?\s*\*?\*?(\d{1,2})\/16\*?\*?/gi;
      while ((m = altPattern.exec(markdown)) !== null) {
        scores.push(m[1] + '/16');
      }
    }
    // Assign scores to companies in order (tables appear in same order as company list)
    if (scores.length > 0) {
      for (let i = 0; i < Math.min(scores.length, rankedCompanies.length); i++) {
        if (!rankedCompanies[i].score) {
          rankedCompanies[i].score = scores[i];
        }
      }
    }
  }

  // Deduplicate by company name (case-insensitive)
  if (rankedCompanies.length > 0) {
    const seen = new Set();
    rankedCompanies = rankedCompanies.filter(c => {
      const key = c.company.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    rankedCompanies.forEach((c, i) => c.rank = i + 1);
  }

  console.log(`Extracted ${rankedCompanies.length} ranked companies from ${markdown.length} chars of markdown`);

  // Save output
  const safeName = `${fundName}-${today}`
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const outputDir = process.env.RESEARCH_OUTPUT_DIR || './research';
  const outputPath = join(outputDir, 'portfolio-research', `${safeName}.md`);

  mkdirSync(join(outputDir, 'portfolio-research'), { recursive: true });
  writeFileSync(outputPath, `# Portfolio Research: ${fundName}\n\n**Date**: ${today}\n${contactName ? `**Contact**: ${contactName}\n` : ''}${context ? `**Context**: ${context}\n` : ''}\n---\n\n${markdown}`, 'utf8');
  console.log(`Saved to ${outputPath}`);

  const runId = researchRuns.insert({
    company_name: fundName,
    role_title: 'Portfolio Assessment',
    context_type: 'portfolio_research',
    interview_stage: 'n/a',
    output_path: outputPath
  });

  return { runId, outputPath, markdown, rankedCompanies };
}
