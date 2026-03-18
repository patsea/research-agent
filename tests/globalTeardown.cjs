const fs = require('fs');

module.exports = async function globalTeardown() {
  try { fs.unlinkSync('/tmp/slack-test-mode'); } catch (_) {}
};
