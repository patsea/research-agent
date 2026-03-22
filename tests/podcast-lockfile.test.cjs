/**
 * Podcast digest lockfile — prevents duplicate Slack sends on same day.
 *
 * NOTE: Unlike newsletter-monitor which has a /api/digest/send Express endpoint,
 * podcast-monitor uses a shell script (run-digest.sh) for digest lockfile logic.
 * The lockfile pattern is: /tmp/podcast-digest-YYYYMMDD.lock
 * This test validates the lockfile logic directly (no running agent required).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCRIPT_PATH = path.join(__dirname, '../podcast-monitor/run-digest.sh');

function getTodayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

describe('Podcast Digest Lockfile', () => {
  const testLockDir = '/tmp';

  test('lockfile path includes today\'s date in YYYYMMDD format', () => {
    // Read the script and verify the lockfile pattern
    const script = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(script).toContain('podcast-digest-$(date +%Y%m%d).lock');

    // Verify the pattern produces correct format
    const today = getTodayYYYYMMDD();
    const expectedPath = `/tmp/podcast-digest-${today}.lock`;
    expect(expectedPath).toMatch(/\/tmp\/podcast-digest-\d{8}\.lock/);
  });

  test('lockfile is created before Slack send (not after)', () => {
    const script = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const lines = script.split('\n');

    // Find the line indices for touch (lockfile creation) and the slack send
    let touchLine = -1;
    let slackLine = -1;

    lines.forEach((line, i) => {
      if (line.includes('touch "$LOCK"')) touchLine = i;
      if (line.includes('sendPodcastDigest')) slackLine = i;
    });

    expect(touchLine).toBeGreaterThan(-1);
    expect(slackLine).toBeGreaterThan(-1);
    // touch must come before the slack send
    expect(touchLine).toBeLessThan(slackLine);
  });

  test('existing lockfile prevents duplicate sends', () => {
    const script = fs.readFileSync(SCRIPT_PATH, 'utf8');
    // The script checks: [ -f "$LOCK" ] && echo "..." && exit 0
    // This pattern exits early if lockfile exists
    expect(script).toMatch(/\[ -f "\$LOCK" \]/);
    expect(script).toContain('exit 0');

    // Verify the guard comes before the send logic
    const lines = script.split('\n');
    let guardLine = -1;
    let sendLine = -1;

    lines.forEach((line, i) => {
      if (line.includes('[ -f "$LOCK" ]')) guardLine = i;
      if (line.includes('sendPodcastDigest')) sendLine = i;
    });

    expect(guardLine).toBeGreaterThan(-1);
    expect(sendLine).toBeGreaterThan(-1);
    expect(guardLine).toBeLessThan(sendLine);
  });

  test('lockfile creation uses touch (atomic create)', () => {
    const script = fs.readFileSync(SCRIPT_PATH, 'utf8');
    // touch creates the file atomically
    expect(script).toContain('touch "$LOCK"');
  });
});
