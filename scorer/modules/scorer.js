import axios from 'axios';
import { randomUUID } from 'crypto';
import 'dotenv/config';

const SIGNAL_VALUES = { High: 1.0, Medium: 0.5, Low: 0.0, Unknown: 0.0 };

// Manual dimension IDs per scoring type
const MANUAL_DIMENSIONS = { company: 'H', firm: 'N' };

export async function scoreItem({ name, scoringType, researchContext, rubric, manualInputs = {} }) {
  const dimensions = rubric.dimensions;
  const manualDimId = MANUAL_DIMENSIONS[scoringType];

  // Separate auto and manual dimensions
  const autoDimensions = dimensions.filter(d => d.id !== manualDimId);
  const manualDimension = dimensions.find(d => d.id === manualDimId);

  // Build LLM scoring prompt
  const dimPrompts = autoDimensions.map(d => `${d.id}: ${d.prompt}`).join('\n');
  const prompt = `You are scoring "${name}" for outreach relevance.

Score EACH of the following dimensions. Use web search to find current evidence.
Return a JSON object with one key per dimension ID.

Dimensions:
${dimPrompts}

Research context provided:
${researchContext || 'None — rely on web search only.'}

Return ONLY valid JSON:
{
${autoDimensions.map(d => `  "${d.id}": { "signal": "High|Medium|Low", "evidence": "one sentence", "confidence": "High|Medium|Low" }`).join(',\n')}
}
No preamble, no explanation, no markdown fences.`;

  let llmResults = {};
  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages',
      {
        model: process.env.SONNET_MODEL || 'claude-sonnet-4-6',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        timeout: 120000
      }
    );

    // Extract text from response
    let textContent = '';
    for (const block of r.data.content || []) {
      if (block.type === 'text') textContent += block.text;
    }

    // Parse JSON response
    const cleaned = textContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    // Find the JSON object in the text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      llmResults = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.error('[scorer] LLM scoring error:', err.message);
  }

  // Build dimension results
  const dimensionResults = dimensions.map(d => {
    if (d.id === manualDimId) {
      // Manual dimension
      const signal = (scoringType === 'company')
        ? (manualInputs.hSignal || 'Unknown')
        : (manualInputs.networkSignal || 'Unknown');
      const evidence = (scoringType === 'company')
        ? (manualInputs.hSignalEvidence || 'Awaiting Cowork check')
        : 'Manual input';
      return { ...d, result: { signal, evidence, confidence: signal === 'Unknown' ? 'Low' : 'Medium' }, manual: true };
    }

    // LLM dimension
    const llmResult = llmResults[d.id] || { signal: 'Low', evidence: 'No data found', confidence: 'Low' };
    return { ...d, result: llmResult, manual: false };
  });

  // Calculate raw score
  const rawScore = dimensionResults.reduce((sum, d) => {
    const signalValue = SIGNAL_VALUES[d.result.signal] ?? 0;
    return sum + signalValue * d.weight;
  }, 0);

  // Connection multiplier
  const connectionDegree = manualInputs.connectionDegree || null;
  const multiplier = connectionDegree === '1st' ? 1.15
    : connectionDegree === '2nd' ? 1.08 : 1.0;
  const finalScore = Math.min(rawScore * multiplier, 1.0);

  // Badge assignment
  let overallBadge, recommendedAction;
  if (scoringType === 'company') {
    if (finalScore >= rubric.thresholds.hot) { overallBadge = 'Hot'; recommendedAction = 'Outreach now'; }
    else if (finalScore >= rubric.thresholds.warm) { overallBadge = 'Warm'; recommendedAction = 'Monitor'; }
    else { overallBadge = 'Cold'; recommendedAction = 'Not relevant'; }
  } else {
    if (finalScore >= rubric.thresholds.tier1) { overallBadge = 'Tier 1'; recommendedAction = 'Outreach now'; }
    else if (finalScore >= rubric.thresholds.tier2) { overallBadge = 'Tier 2'; recommendedAction = 'Monitor'; }
    else { overallBadge = 'Tier 3'; recommendedAction = 'Not relevant'; }
  }

  // Overall confidence
  const confValues = dimensionResults.map(d => d.result.confidence);
  const highCount = confValues.filter(c => c === 'High').length;
  const confidence = highCount >= dimensionResults.length / 2 ? 'High' : highCount > 0 ? 'Medium' : 'Low';

  return {
    id: randomUUID(),
    name,
    scoringType,
    rawScore: Math.round(rawScore * 1000) / 1000,
    connectionMultiplier: multiplier,
    finalScore: Math.round(finalScore * 1000) / 1000,
    overallBadge,
    confidence,
    recommendedAction,
    dimensions: dimensionResults,
    hSignal: manualInputs.hSignal || null,
    hSignalEvidence: manualInputs.hSignalEvidence || null,
    connectionDegree: connectionDegree,
    connectionName: manualInputs.connectionName || null
  };
}
