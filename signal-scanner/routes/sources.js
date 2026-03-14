const express = require('express');
const router = express.Router();
const db = require('../db');
const { detect: detectMethod } = require('../methods/detect');

router.get('/', (req, res) => res.json(db.sources.list()));

router.post('/', async (req, res) => {
  const { name, url, method, extraction_prompt, cadence } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  let resolvedMethod = method, resolvedUrl = url;
  if (!method || method === 'auto') {
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('detect timeout')), 15000));
      const d = await Promise.race([detectMethod(url), timeout]);
      resolvedMethod = d.method; resolvedUrl = d.resolved_url || url;
    } catch(_) { resolvedMethod = 'webpage_scan'; }
  }
  const id = db.sources.insert({ name, url: resolvedUrl, method: resolvedMethod, extraction_prompt, cadence });
  res.json({ id, method_detected: resolvedMethod, url: resolvedUrl });
});

router.patch('/:id', (req, res) => {
  db.sources.update(req.params.id, req.body);
  res.json(db.sources.get(req.params.id));
});
router.delete('/:id', (req, res) => { db.sources.delete(req.params.id); res.json({ success: true }); });

router.get('/exclusions', (req, res) => res.json(db.exclusions.list()));
router.post('/exclusions', (req, res) => {
  if (!req.body.sector) return res.status(400).json({ error: 'sector required' });
  db.exclusions.add(req.body.sector);
  res.json(db.exclusions.list());
});
router.delete('/exclusions/:sector', (req, res) => {
  db.exclusions.remove(req.params.sector);
  res.json(db.exclusions.list());
});

module.exports = router;
