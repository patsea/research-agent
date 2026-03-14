function detect(s) {
  if (/^[^@]+@[^@]+\.[^@]+$/.test(s)) return { confidence: 0.95 };
  if (/email|newsletter|digest|alert/i.test(s)) return { confidence: 0.6 };
  return { confidence: 0 };
}
async function fetch(sender, lastRun) {
  console.log(`[email] email_inbox not yet implemented for ${sender}`);
  return { content: '', item_count: 0 };
}
module.exports = { detect, fetch };
