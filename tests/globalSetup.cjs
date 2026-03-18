const fs = require('fs');

module.exports = async function globalSetup() {
  fs.writeFileSync('/tmp/slack-test-mode', '1');
  process.env.SLACK_MOCK = 'true';
  process.env.NODE_ENV = 'test';
};
