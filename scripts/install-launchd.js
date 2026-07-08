#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const LABEL = 'com.codex-usage-pet.profile-stats';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG_DIR = path.join(os.homedir(), 'Library', 'Logs', 'codex-usage-pet');
const FETCH_SCRIPT_PATH = path.join(APP_ROOT, 'scripts', 'fetch-profile-stats.js');
const NODE_SEARCH_PATH = [
  path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'bin'),
  path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin'
].join(':');
const USER_ID = String(process.getuid?.() || execFileSync('id', ['-u'], { encoding: 'utf8' }).trim());

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function makePlist() {
  const stdoutPath = path.join(LOG_DIR, 'profile-stats.out.log');
  const stderrPath = path.join(LOG_DIR, 'profile-stats.err.log');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>PATH=${xmlEscape(NODE_SEARCH_PATH)}</string>
    <string>node</string>
    <string>${xmlEscape(FETCH_SCRIPT_PATH)}</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(NODE_SEARCH_PATH)}</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>StartInterval</key>
  <integer>3600</integer>

  <key>WorkingDirectory</key>
  <string>${xmlEscape(APP_ROOT)}</string>

  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>

  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

function runLaunchctl(args, options = {}) {
  return execFileSync('launchctl', args, {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe'
  });
}

function install() {
  if (!fs.existsSync(FETCH_SCRIPT_PATH)) {
    throw new Error(`Missing profile fetch script: ${FETCH_SCRIPT_PATH}`);
  }
  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(PLIST_PATH, makePlist(), 'utf8');
  try {
    runLaunchctl(['bootout', `gui/${USER_ID}`, PLIST_PATH]);
  } catch {
    // The service may not be loaded yet.
  }
  runLaunchctl(['bootstrap', `gui/${USER_ID}`, PLIST_PATH]);
  runLaunchctl(['kickstart', '-k', `gui/${USER_ID}/${LABEL}`]);
  console.log(`Installed ${LABEL}`);
  console.log(PLIST_PATH);
}

function uninstall() {
  try {
    runLaunchctl(['bootout', `gui/${USER_ID}`, PLIST_PATH]);
  } catch {
    // Already unloaded.
  }
  if (fs.existsSync(PLIST_PATH)) fs.unlinkSync(PLIST_PATH);
  console.log(`Uninstalled ${LABEL}`);
}

function status() {
  try {
    process.stdout.write(runLaunchctl(['print', `gui/${USER_ID}/${LABEL}`]));
  } catch (error) {
    process.stderr.write(error.stderr || error.message);
    process.exit(1);
  }
}

function printPlist() {
  process.stdout.write(makePlist());
}

const action = process.argv[2] || 'install';
if (action === 'install') install();
else if (action === 'uninstall') uninstall();
else if (action === 'status') status();
else if (action === 'print') printPlist();
else {
  console.error('Usage: node scripts/install-launchd.js [install|uninstall|status|print]');
  process.exit(2);
}
