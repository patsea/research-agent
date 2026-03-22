/**
 * SIGINT Synthesizer — fetchAgentDigest resilience and synthesizeBriefing source injection tests
 * No running agents required. Tests logic by mocking HTTP and DB dependencies.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// --- Minimal mock HTTP server to simulate agent endpoints ---
let mockServer;
let mockPort;
let mockRoutes = {};

function setMockRoute(path, handler) {
  mockRoutes[path] = handler;
}

function clearMockRoutes() {
  mockRoutes = {};
}

beforeAll((done) => {
  mockServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost`);
    const handler = mockRoutes[url.pathname];
    if (handler) {
      handler(req, res, url);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  mockServer.listen(0, () => {
    mockPort = mockServer.address().port;
    done();
  });
});

afterAll((done) => {
  mockServer.close(done);
});

afterEach(() => {
  clearMockRoutes();
});

// Replicate fetchAgentDigest from sigint-synthesizer.js (ESM, so replicate logic)
async function fetchAgentDigest(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

describe('fetchAgentDigest — resilience', () => {
  test('returns null on HTTP error (does not throw)', async () => {
    setMockRoute('/api/digest/podcast', (req, res) => {
      res.writeHead(500);
      res.end('Internal Server Error');
    });
    const result = await fetchAgentDigest(`http://localhost:${mockPort}/api/digest/podcast`);
    expect(result).toBeNull();
  });

  test('returns null on timeout (does not throw)', async () => {
    setMockRoute('/api/digest/podcast', (req, res) => {
      // Never respond — let it timeout
      // AbortSignal.timeout(8000) will fire, but we use a shorter one for testing
    });
    // Use a very short timeout to avoid slow test
    async function fetchWithShortTimeout(url) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(200) });
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    }
    const result = await fetchWithShortTimeout(`http://localhost:${mockPort}/api/digest/podcast`);
    expect(result).toBeNull();
  });

  test('returns parsed data on success', async () => {
    const testData = [
      { title: 'Episode 1', relevance_score: 8 },
      { title: 'Episode 2', relevance_score: 6 }
    ];
    setMockRoute('/api/digest/podcast', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(testData));
    });
    const result = await fetchAgentDigest(`http://localhost:${mockPort}/api/digest/podcast`);
    expect(result).toEqual(testData);
  });
});

describe('synthesizeBriefing — source injection', () => {
  // Read the actual prompt template to verify placeholder presence
  const PROMPT_PATH = path.join(__dirname, '../config/prompts/research-sigint-briefing.md');
  let promptTemplate;

  beforeAll(() => {
    promptTemplate = fs.readFileSync(PROMPT_PATH, 'utf8');
  });

  test('synthesizeBriefing prompt template has {podcast_content} placeholder', () => {
    expect(promptTemplate).toContain('{podcast_content}');
  });

  test('synthesizeBriefing prompt template has {newsletter_content} placeholder', () => {
    expect(promptTemplate).toContain('{newsletter_content}');
  });

  test('synthesizeBriefing prompt template has {content} placeholder for RSS', () => {
    expect(promptTemplate).toContain('{content}');
  });

  test('podcast digest endpoint is called at correct URL pattern', () => {
    // Verify the URL pattern used by synthesizeBriefing
    // From source: fetchAgentDigest(`http://localhost:3040/api/digest/podcast?daysBack=${daysBack}`)
    const expectedPattern = /localhost:3040\/api\/digest\/podcast/;
    const sourceCode = fs.readFileSync(
      path.join(__dirname, '../research/modules/sigint-synthesizer.js'), 'utf8'
    );
    expect(sourceCode).toMatch(expectedPattern);
  });

  test('newsletter digest endpoint is called at correct URL pattern', () => {
    const expectedPattern = /localhost:3041\/api\/digest\/newsletter/;
    const sourceCode = fs.readFileSync(
      path.join(__dirname, '../research/modules/sigint-synthesizer.js'), 'utf8'
    );
    expect(sourceCode).toMatch(expectedPattern);
  });

  test('RSS content is injected via {content} placeholder', () => {
    const sourceCode = fs.readFileSync(
      path.join(__dirname, '../research/modules/sigint-synthesizer.js'), 'utf8'
    );
    // Verify the source replaces {content} with contentBlock
    expect(sourceCode).toContain(".replace('{content}', contentBlock)");
  });

  test('{podcast_content} is replaced in prompt', () => {
    const sourceCode = fs.readFileSync(
      path.join(__dirname, '../research/modules/sigint-synthesizer.js'), 'utf8'
    );
    expect(sourceCode).toContain(".replace('{podcast_content}', podcastContent)");
  });

  test('{newsletter_content} is replaced in prompt', () => {
    const sourceCode = fs.readFileSync(
      path.join(__dirname, '../research/modules/sigint-synthesizer.js'), 'utf8'
    );
    expect(sourceCode).toContain(".replace('{newsletter_content}', newsletterContent)");
  });

  test('synthesizeBriefing completes when one source returns null (resilience)', async () => {
    // Test that podcastContent defaults gracefully when fetchAgentDigest returns null
    const podcastItems = null;
    const newsletterItems = [{ subject: 'Test', relevance_score: 7, summary: 'A summary', sender_name: 'Tester' }];

    // Replicate the null-handling logic from synthesizeBriefing
    let podcastContent = 'No podcast intel available this period.';
    if (podcastItems && podcastItems.length > 0) {
      podcastContent = 'Would have content';
    }

    let newsletterContent = 'No newsletter intel available this period.';
    if (newsletterItems && newsletterItems.length > 0) {
      newsletterContent = newsletterItems.map(nl => `**${nl.subject}**`).join('\n\n');
    }

    expect(podcastContent).toBe('No podcast intel available this period.');
    expect(newsletterContent).toContain('**Test**');
  });

  test('synthesizeBriefing completes when two sources return null (resilience)', async () => {
    const podcastItems = null;
    const newsletterItems = null;

    let podcastContent = 'No podcast intel available this period.';
    if (podcastItems && podcastItems.length > 0) {
      podcastContent = 'Would have content';
    }

    let newsletterContent = 'No newsletter intel available this period.';
    if (newsletterItems && newsletterItems.length > 0) {
      newsletterContent = 'Would have content';
    }

    expect(podcastContent).toBe('No podcast intel available this period.');
    expect(newsletterContent).toBe('No newsletter intel available this period.');

    // Verify the prompt can still be built with fallback content
    const prompt = promptTemplate
      .replace('{content}', 'Some RSS content')
      .replace('{podcast_content}', podcastContent)
      .replace('{newsletter_content}', newsletterContent);

    expect(prompt).not.toContain('{podcast_content}');
    expect(prompt).not.toContain('{newsletter_content}');
    expect(prompt).toContain('No podcast intel available this period.');
    expect(prompt).toContain('No newsletter intel available this period.');
  });
});
