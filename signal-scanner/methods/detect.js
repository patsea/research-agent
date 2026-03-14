const rss = require('./rss');
const webpage = require('./webpage');
const email = require('./email');

async function detect(urlOrDescription) {
  const results = [];
  const emailScore = email.detect(urlOrDescription);
  if (emailScore.confidence > 0) results.push({ method: 'email_inbox', confidence: emailScore.confidence, resolved_url: urlOrDescription });
  try {
    const rssScore = await rss.detect(urlOrDescription);
    if (rssScore.confidence > 0) results.push({ method: 'rss', confidence: rssScore.confidence, resolved_url: rssScore.resolved_url });
  } catch(_) {}
  const pageScore = webpage.detect(urlOrDescription);
  results.push({ method: pageScore.type || 'webpage_scan', confidence: pageScore.confidence, resolved_url: urlOrDescription });
  results.sort((a, b) => b.confidence - a.confidence);
  return results[0] || { method: 'webpage_scan', confidence: 0.3, resolved_url: urlOrDescription };
}

module.exports = { detect };
