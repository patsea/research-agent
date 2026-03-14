const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs');
const path = require('path');

router.get('/', (req, res) => {
  const { status, signal_type, sector, source_name, geography, confidence, limit, offset } = req.query;
  res.json(db.signals.list({
    status: status||undefined, signal_type: signal_type||undefined, sector: sector||undefined,
    source_name: source_name||undefined, geography: geography||undefined, confidence: confidence||undefined,
    limit: limit ? parseInt(limit) : 200, offset: offset ? parseInt(offset) : 0
  }));
});

router.get('/meta', (req, res) => {
  const { db: raw } = require('../db');
  res.json({
    signal_types: raw.prepare("SELECT DISTINCT signal_type FROM signals WHERE signal_type!='' ORDER BY signal_type").all().map(r=>r.signal_type),
    sectors: raw.prepare("SELECT DISTINCT sector FROM signals WHERE sector!='' ORDER BY sector").all().map(r=>r.sector),
    sources: raw.prepare("SELECT DISTINCT source_name FROM signals WHERE source_name!='' ORDER BY source_name").all().map(r=>r.source_name),
    geographies: raw.prepare("SELECT DISTINCT geography FROM signals WHERE geography!='' ORDER BY geography").all().map(r=>r.geography)
  });
});

router.patch('/:id', (req, res) => {
  const signal = db.signals.getById(req.params.id);
  if (!signal) return res.status(404).json({ error: 'Not found' });
  if (req.body.status && ['new','reviewed','forwarded','dismissed'].includes(req.body.status))
    db.signals.updateStatus(req.params.id, req.body.status);
  if (req.body.sector) db.signals.updateSector(req.params.id, req.body.sector);
  res.json(db.signals.getById(req.params.id));
});

router.post('/:id/forward', (req, res) => {
  const signal = db.signals.getById(req.params.id);
  if (!signal) return res.status(404).json({ error: 'Not found' });
  db.signals.updateStatus(req.params.id, 'forwarded');
  const queuePath = path.join(__dirname, '..', 'data', 'forward_queue.jsonl');
  fs.appendFileSync(queuePath, JSON.stringify({ ...signal, forwarded_at: new Date().toISOString() }) + '\n');
  res.json({ success: true });
});

module.exports = router;
