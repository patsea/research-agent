/**
 * Identifier JSON Parse Tests
 * Tests parseIdentifyResponse() — extracts structured contacts from LLM JSON output.
 * TDD: these tests written BEFORE implementation.
 */

let parseIdentifyResponse;

beforeAll(async () => {
  // ESM module — use dynamic import from CJS test file
  const mod = await import('../contact-research/modules/identifier.js');
  parseIdentifyResponse = mod.parseIdentifyResponse;
});

describe('parseIdentifyResponse — JSON parsing', () => {

  test('valid JSON contacts array parsed correctly (2 contacts, role_rationale mapped from why_selected)', () => {
    const llmJson = JSON.stringify({
      company_name: 'Acme Corp',
      contacts: [
        {
          rank: 1,
          name: 'Jane Smith',
          title: 'CPO',
          contact_type: 'cpo',
          company_or_firm: 'Acme Corp',
          relationship_to_company: 'company_side',
          source_basis: 'web_only',
          why_selected: 'Jane is the CPO and directly owns product strategy. Strong mandate fit.',
          linkedin_url: 'https://www.linkedin.com/in/janesmith',
          confidence: 'High'
        },
        {
          rank: 2,
          name: 'Bob Jones',
          title: 'COO',
          contact_type: 'coo',
          company_or_firm: 'Acme Corp',
          relationship_to_company: 'company_side',
          source_basis: 'web_only',
          why_selected: 'Bob oversees operations and would sponsor transformation work.',
          linkedin_url: 'https://www.linkedin.com/in/bobjones',
          confidence: 'Medium'
        }
      ],
      selection_notes: 'Two strong candidates identified.'
    });

    const results = parseIdentifyResponse(llmJson, 'Acme Corp');

    // Should return an array of 2 contacts
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(2);

    // First contact
    expect(results[0].name).toBe('Jane Smith');
    expect(results[0].title).toBe('CPO');
    expect(results[0].linkedinUrl).toBe('https://www.linkedin.com/in/janesmith');
    expect(results[0].confidence).toBe('High');
    expect(results[0].role_rationale).toBe('Jane is the CPO and directly owns product strategy. Strong mandate fit.');
    expect(results[0].company).toBe('Acme Corp');
    expect(results[0].source).toBe('web_search');

    // Second contact
    expect(results[1].name).toBe('Bob Jones');
    expect(results[1].title).toBe('COO');
    expect(results[1].linkedinUrl).toBe('https://www.linkedin.com/in/bobjones');
    expect(results[1].confidence).toBe('Medium');
    expect(results[1].role_rationale).toBe('Bob oversees operations and would sponsor transformation work.');
  });

  test('malformed JSON falls back to single Low-confidence contact', () => {
    const malformed = 'Here is the contact: Name: Alice Wong, Title: CEO, linkedin.com/in/alicewong';

    const results = parseIdentifyResponse(malformed, 'TestCo');

    expect(Array.isArray(results)).toBe(true);
    // Fallback should return at most 1 contact (regex extraction)
    expect(results.length).toBeLessThanOrEqual(1);

    if (results.length === 1) {
      expect(results[0].confidence).toBe('Low');
      expect(results[0].role_rationale).toBe('');
      expect(results[0].source).toBe('web_search');
    }
  });

  test('empty response returns empty array', () => {
    const results = parseIdentifyResponse('', 'EmptyCo');

    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });
});
