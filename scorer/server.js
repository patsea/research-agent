import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import axios from 'axios';
import 'dotenv/config';
import { scoreItem } from './modules/scorer.js';
import { rubrics, scores, agent4Queue } from './db.js';
import { logActivity } from '../shared/activityLogger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3038;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Rubrics
app.get('/api/rubrics', (req, res) => res.json(rubrics.list()));

app.post('/api/rubrics', (req, res) => {
  const { name, scoringType, dimensions, thresholds } = req.body;
  if (!name || !scoringType) return res.status(400).json({ error: 'name and scoringType required' });
  const id = rubrics.insert({ name, scoringType, dimensions, thresholds });
  res.json({ success: true, id });
});

app.put('/api/rubrics/:id', (req, res) => {
  const { id } = req.params;
  const existing = rubrics.get(id);
  if (!existing) return res.status(404).json({ error: 'Rubric not found' });
  const { name, dimensions, thresholds } = req.body;
  rubrics.update(id, { ...(name && { name }), ...(dimensions && { dimensions }), ...(thresholds && { thresholds }) });
  res.json({ success: true });
});

// Score single item
app.post('/api/score', async (req, res) => {
  const { name, scoringType, researchContext, rubricId, manualInputs } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const type = scoringType || 'company';
  const rubric = rubricId ? rubrics.get(rubricId) : rubrics.getDefault(type);
  if (!rubric) return res.status(400).json({ error: 'No rubric found for this scoring type' });

  try {
    console.log(`[score] Scoring ${name} (${type})`);
    const result = await scoreItem({ name, scoringType: type, researchContext, rubric, manualInputs: manualInputs || {} });
    scores.insert(result);
    console.log(`[score] ${name}: ${result.overallBadge} (${Math.round(result.finalScore * 100)}%)`);
    res.json(result);
    logActivity({ agent: 'agent3', action: 'score_complete', company: name, result: 'success', detail: `badge=${result.overallBadge}, score=${Math.round(result.finalScore * 100)}%, type=${type}` });
  } catch (err) {
    console.error('[score] Error:', err.message);
    logActivity({ agent: 'agent3', action: 'score_complete', company: name, result: 'error', detail: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Batch score
app.post('/api/score/batch', async (req, res) => {
  const { items, rubricId } = req.body;
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  if (items.length > 20) return res.status(400).json({ error: 'Batch limit is 20 — split into groups' });

  const results = [];
  for (const item of items) {
    const type = item.scoringType || 'company';
    const rubric = rubricId ? rubrics.get(rubricId) : rubrics.getDefault(type);
    if (!rubric) { results.push({ name: item.name, error: 'No rubric found' }); continue; }

    try {
      console.log(`[batch] Scoring ${item.name}`);
      const result = await scoreItem({ name: item.name, scoringType: type, researchContext: item.researchContext, rubric, manualInputs: {} });
      scores.insert(result);
      results.push(result);
      logActivity({ agent: 'agent3', action: 'batch_score', company: item.name, result: 'success', detail: `badge=${result.overallBadge}, score=${Math.round(result.finalScore * 100)}%` });
    } catch (err) {
      results.push({ name: item.name, error: err.message });
      logActivity({ agent: 'agent3', action: 'batch_score', company: item.name, result: 'error', detail: err.message });
    }
  }
  res.json(results);
});

// List scores
app.get('/api/scores', (req, res) => {
  const { status, scoringType } = req.query;
  res.json(scores.list({ status: status || null, scoringType: scoringType || null }));
});

// Update manual inputs
app.patch('/api/scores/:id/manual', async (req, res) => {
  const { id } = req.params;
  const existing = scores.get(id);
  if (!existing) return res.status(404).json({ error: 'Score not found' });

  const { hSignal, hSignalEvidence, connectionDegree, connectionName, networkSignal } = req.body;

  // Get the rubric for recalculation
  const rubric = rubrics.getDefault(existing.scoring_type);
  if (!rubric) return res.status(400).json({ error: 'No rubric found' });

  // Update manual dimension in existing dimensions
  const dims = existing.dimensions;
  const manualDimId = existing.scoring_type === 'company' ? 'H' : 'N';
  const manualDim = dims.find(d => d.id === manualDimId);
  if (manualDim) {
    if (existing.scoring_type === 'company') {
      manualDim.result.signal = hSignal || manualDim.result.signal;
      manualDim.result.evidence = hSignalEvidence || manualDim.result.evidence;
      manualDim.result.confidence = hSignal && hSignal !== 'Unknown' ? 'Medium' : 'Low';
    } else {
      manualDim.result.signal = networkSignal || manualDim.result.signal;
      manualDim.result.confidence = networkSignal && networkSignal !== 'Unknown' ? 'Medium' : 'Low';
    }
  }

  // Recalculate scores
  const SIGNAL_VALUES = { High: 1.0, Medium: 0.5, Low: 0.0, Unknown: 0.0 };
  const rawScore = dims.reduce((sum, d) => sum + (SIGNAL_VALUES[d.result.signal] ?? 0) * d.weight, 0);
  const degree = connectionDegree || existing.connection_degree;
  const multiplier = degree === '1st' ? 1.15 : degree === '2nd' ? 1.08 : 1.0;
  const finalScore = Math.min(rawScore * multiplier, 1.0);

  let overallBadge, recommendedAction;
  if (existing.scoring_type === 'company') {
    if (finalScore >= rubric.thresholds.hot) { overallBadge = 'Hot'; recommendedAction = 'Outreach now'; }
    else if (finalScore >= rubric.thresholds.warm) { overallBadge = 'Warm'; recommendedAction = 'Monitor'; }
    else { overallBadge = 'Cold'; recommendedAction = 'Not relevant'; }
  } else {
    if (finalScore >= rubric.thresholds.tier1) { overallBadge = 'Tier 1'; recommendedAction = 'Outreach now'; }
    else if (finalScore >= rubric.thresholds.tier2) { overallBadge = 'Tier 2'; recommendedAction = 'Monitor'; }
    else { overallBadge = 'Tier 3'; recommendedAction = 'Not relevant'; }
  }

  scores.update(id, {
    dimensions: dims,
    raw_score: Math.round(rawScore * 1000) / 1000,
    connection_multiplier: multiplier,
    final_score: Math.round(finalScore * 1000) / 1000,
    overall_badge: overallBadge,
    recommended_action: recommendedAction,
    h_signal: hSignal || existing.h_signal,
    h_signal_evidence: hSignalEvidence || existing.h_signal_evidence,
    connection_degree: degree,
    connection_name: connectionName || existing.connection_name
  });

  res.json(scores.get(id));
});

// Forward to Agent 4
app.post('/api/scores/:id/forward', async (req, res) => {
  const { id } = req.params;
  const { campaignType } = req.body;
  const score = scores.get(id);
  if (!score) return res.status(404).json({ error: 'Score not found' });

  const scoreContext = `${score.overall_badge} (${Math.round(score.final_score * 100)}%) — ${score.recommended_action}`;

  try {
    await axios.post(`${process.env.AGENT4_URL}/api/research`, {
      companyName: score.name,
      campaignType: campaignType || 'pe_vc',
      context: scoreContext
    }, { timeout: 120000 });

    scores.updateStatus(id, 'forwarded');
    agent4Queue.add(id, score.name, campaignType, scoreContext);
    logActivity({ agent: 'agent3', action: 'forwarded_to_agent4', company: score.name, result: 'success', detail: `badge=${score.overall_badge}, campaign=${campaignType || 'pe_vc'}` });
    res.json({ success: true, forwardedToAgent4: true });
  } catch (err) {
    console.error('[forward] Agent 4 error:', err.message);
    logActivity({ agent: 'agent3', action: 'forwarded_to_agent4', company: score.name, result: 'error', detail: err.message });
    res.json({ success: false, error: 'Agent 4 not available — start it on port 3036' });
  }
});

// Dismiss
app.post('/api/scores/:id/dismiss', (req, res) => {
  const { id } = req.params;
  const score = scores.get(id);
  if (!score) return res.status(404).json({ error: 'Score not found' });
  scores.updateStatus(id, 'dismissed');
  res.json({ success: true });
});

// Update notes
app.patch('/api/scores/:id/notes', (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;
  scores.update(id, { notes });
  res.json({ success: true });
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

app.listen(PORT, () => {
  console.log(`Agent 3 — Scorer running on http://localhost:${PORT}`);
});
