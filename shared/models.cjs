const fs = require('fs');
const path = require('path');
const MODELS_PATH = path.join(__dirname, '../config/models.json');
const DEFAULTS = {
  synthesis: 'claude-sonnet-4-6',
  classification: 'claude-haiku-4-5-20251001',
  podcast_summary: 'claude-sonnet-4-6',
  podcast_section: 'claude-haiku-4-5-20251001',
};
function getModel(slot) {
  try { return JSON.parse(fs.readFileSync(MODELS_PATH, 'utf8'))[slot] || DEFAULTS[slot]; }
  catch (e) { return DEFAULTS[slot]; }
}
function getAllModels() {
  try { return JSON.parse(fs.readFileSync(MODELS_PATH, 'utf8')); }
  catch (e) { return { ...DEFAULTS }; }
}
module.exports = { getModel, getAllModels, DEFAULTS };
