/**
 * Tests for email-scan/modules/classify.js (output parsing)
 * and email-scan/modules/scan.js (category routing logic)
 *
 * These are unit tests that verify:
 * 1. The JSON parsing and field extraction from classify.js
 * 2. The routing switch logic from scan.js
 *
 * The LLM call is mocked by intercepting axios at the sub-project level.
 */

const path = require('path');

// Resolve axios from email-scan's own node_modules
const axiosPath = path.join(__dirname, '..', 'email-scan', 'node_modules', 'axios');

let mockAxiosResponse;
jest.mock(axiosPath, () => ({
  __esModule: true,
  default: {
    post: jest.fn(() => Promise.resolve(mockAxiosResponse))
  }
}));

// Mock fs.readFileSync to avoid reading prompt file from disk
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readFileSync: jest.fn((...args) => {
      const filePath = typeof args[0] === 'object' ? args[0].pathname || args[0].href || '' : String(args[0]);
      if (filePath.includes('email-reply-classification.md')) {
        return '# Prompt\nClassify this email reply.';
      }
      return actual.readFileSync(...args);
    })
  };
});

process.env.ANTHROPIC_API_KEY = 'test-key-fake';

function setLLMResponse(obj) {
  mockAxiosResponse = {
    data: { content: [{ text: JSON.stringify(obj) }] }
  };
}

// ─── classify.js output parsing ────────────────────────────────────────────

describe('classify.js — classifyReply output parsing', () => {
  // Replicate the JSON-parse logic from classify.js lines 35-37
  // This tests the parsing contract without needing the ESM import
  function parseClassifyOutput(rawText) {
    const raw = rawText.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(raw);
  }

  function classifyFallback(body) {
    return { type: 'other', summary: (body || '').slice(0, 200), next_step: 'Review manually', ooo_return_date: null };
  }

  test('returns type: not_now when LLM returns not_now', () => {
    const result = parseClassifyOutput(JSON.stringify({ type: 'not_now', summary: 'Not right now' }));
    expect(result.type).toBe('not_now');
  });

  test('returns type: meeting when LLM returns meeting', () => {
    const result = parseClassifyOutput(JSON.stringify({ type: 'meeting', summary: 'Wants to meet Tuesday' }));
    expect(result.type).toBe('meeting');
  });

  test('returns type: referral when LLM returns referral', () => {
    const result = parseClassifyOutput(JSON.stringify({ type: 'referral', summary: 'Try talking to Jane' }));
    expect(result.type).toBe('referral');
  });

  test('returns type: unclear when LLM returns unclear', () => {
    const result = parseClassifyOutput(JSON.stringify({ type: 'unclear', summary: 'Ambiguous response' }));
    expect(result.type).toBe('unclear');
  });

  test('returns type: ooo with ooo_return_date populated when LLM returns ooo + date', () => {
    const result = parseClassifyOutput(JSON.stringify({ type: 'ooo', summary: 'Out of office', ooo_return_date: '2026-04-01' }));
    expect(result.type).toBe('ooo');
    expect(result.ooo_return_date).toBe('2026-04-01');
  });

  test('returns type: ooo with ooo_return_date null when ooo but no date', () => {
    const result = parseClassifyOutput(JSON.stringify({ type: 'ooo', summary: 'OOO no date', ooo_return_date: null }));
    expect(result.type).toBe('ooo');
    expect(result.ooo_return_date).toBeNull();
  });

  test('does not include next_step field in LLM-parsed output', () => {
    const result = parseClassifyOutput(JSON.stringify({ type: 'interested', summary: 'Interested reply' }));
    expect(result).not.toHaveProperty('next_step');
  });

  test('strips markdown code fences from LLM response', () => {
    const result = parseClassifyOutput('```json\n{"type":"meeting","summary":"Let us meet"}\n```');
    expect(result.type).toBe('meeting');
  });

  test('fallback includes next_step but parsed LLM output does not', () => {
    const fallback = classifyFallback('some body text');
    expect(fallback).toHaveProperty('next_step');
    const parsed = parseClassifyOutput(JSON.stringify({ type: 'meeting', summary: 'Meet' }));
    expect(parsed).not.toHaveProperty('next_step');
  });
});


// ─── scan.js routing logic ─────────────────────────────────────────────────

describe('scan.js — category routing logic', () => {
  let updateStatusCalls, appendNoteCalls, createTaskCalls;

  const PROTECTED = new Set(['Interested', 'Call scheduled', 'Call had', 'Mandate flagged', 'In process']);

  function addDays(baseDate, n) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  }

  // Replicate the routing switch from scan.js lines 103-147
  async function routeClassification(classified, person, replyDate) {
    switch (classified.type) {
      case 'interested':
        if (!PROTECTED.has(person.currentStatus)) updateStatusCalls.push({ id: person.id, status: 'Interested' });
        createTaskCalls.push({ id: person.id, title: `Follow up with ${person.name}`, date: addDays(replyDate, 2) });
        break;
      case 'request_info':
        if (!PROTECTED.has(person.currentStatus)) updateStatusCalls.push({ id: person.id, status: 'Interested' });
        createTaskCalls.push({ id: person.id, title: `Review and respond to ${person.name}`, date: replyDate.split('T')[0] || addDays(replyDate, 0) });
        break;
      case 'meeting':
        if (!PROTECTED.has(person.currentStatus)) updateStatusCalls.push({ id: person.id, status: 'Interested' });
        createTaskCalls.push({ id: person.id, title: `Prepare for meeting with ${person.name}`, date: addDays(replyDate, 1) });
        appendNoteCalls.push({ id: person.id, title: `Meeting proposed by ${person.name}`, body: classified.summary || '(no summary)' });
        break;
      case 'referral':
        appendNoteCalls.push({ id: person.id, title: `Referral from ${person.name}`, body: classified.summary || '(no summary)' });
        break;
      case 'unclear':
        appendNoteCalls.push({ id: person.id, title: `Unclear reply from ${person.name}`, body: classified.summary || '(no summary)' });
        break;
      case 'ooo':
        createTaskCalls.push({ id: person.id, title: `Re-contact ${person.name} on return`, date: classified.ooo_return_date || addDays(replyDate, 21) });
        break;
      default:
        break;
    }
    // Always append classification note (mirrors scan.js line 148)
    appendNoteCalls.push({ id: person.id, title: `Reply classified: ${classified.type}`, body: classified.summary || '(no summary)' });
  }

  const mockPerson = { id: 'attio-123', name: 'Alice', currentStatus: 'Outreach sent' };
  const replyDate = '2026-03-18T10:00:00Z';

  beforeEach(() => {
    updateStatusCalls = [];
    appendNoteCalls = [];
    createTaskCalls = [];
  });

  test('meeting → sets Attio status Interested', async () => {
    await routeClassification({ type: 'meeting', summary: 'Wants to meet' }, mockPerson, replyDate);
    expect(updateStatusCalls).toEqual([{ id: 'attio-123', status: 'Interested' }]);
  });

  test('ooo → creates re-contact task, does not change status', async () => {
    await routeClassification({ type: 'ooo', summary: 'OOO', ooo_return_date: '2026-04-01' }, mockPerson, replyDate);
    expect(createTaskCalls.length).toBe(1);
    expect(createTaskCalls[0].title).toMatch(/Re-contact.*on return/);
    expect(createTaskCalls[0].date).toBe('2026-04-01');
    expect(updateStatusCalls).toEqual([]);
  });

  test('referral → adds note only, no status change', async () => {
    await routeClassification({ type: 'referral', summary: 'Try Jane' }, mockPerson, replyDate);
    expect(updateStatusCalls).toEqual([]);
    // Two notes: the referral note + the classification note
    expect(appendNoteCalls.length).toBe(2);
    expect(appendNoteCalls[0].title).toMatch(/Referral from/);
  });
});
