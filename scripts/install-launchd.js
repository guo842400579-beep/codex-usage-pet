#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const LABEL = 'com.codex-usage-pet.profile-stats';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
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
  const nodePath = process.execPath;
  const scriptPath = path.join(APP_ROOT, 'scripts', 'fetch-profile-stats.js');
  const stdoutPath = path.join(APP_ROOT, 'logs', 'profile-stats.out.log');
  const stderrPath = path.join(APP_ROOT, 'logs', 'profile-stats.err.log');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(scriptPath)}</string>
  </array>

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
  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.mkdirSync(path.join(APP_ROOT, 'logs'), { recursive: true });
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
