const express = require('express');
const router = express.Router();
const db = require('../db');
const { runPipeline } = require('../pipeline/trigger');

let running = false;

router.post('/run', async (req, res) => {
  if (running) return res.status(429).json({ error: 'Run already in progress' });
  running = true;
  res.json({ started: true });
  runPipeline({ sourceId: req.body.source_id })
    .catch(e => console.error('[admin/run]', e.message))
    .finally(() => { running = false; });
});

router.get('/status', (req, res) => {
  res.json({ run_in_progress: running, latest_run: db.runLog.latest() });
});

router.get('/log', (req, res) => res.json(db.runLog.list(20)));

module.exports = router;
