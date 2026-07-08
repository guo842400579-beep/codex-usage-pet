#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DATA_DIR = process.env.CODEX_USAGE_PET_DATA_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'codex-usage-pet');
const DEFAULT_AUTH_PATH = path.join(os.homedir(), '.codex', 'auth.json');
const DEFAULT_OUTPUT_PATH = path.join(APP_DATA_DIR, 'profile-stats.json');
const PROFILE_URL = 'https://chatgpt.com/backend-api/wham/profiles/me';
const DEFAULT_TIMEOUT_MS = 15000;

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function expandHome(value) {
  if (!value || typeof value !== 'string') return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function readAccessToken(authPath) {
  const raw = fs.readFileSync(authPath, 'utf8');
  const auth = JSON.parse(raw);
  const token = auth?.tokens?.access_token;
  if (!token) throw new Error(`No access_token found in ${authPath}`);
  return token;
}

function atomicWriteJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function makeTimeoutSignal(timeoutMs) {
  const ms = Math.max(1000, Number(timeoutMs || DEFAULT_TIMEOUT_MS));
  if (AbortSignal.timeout) return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

async function fetchProfileStats(authPath, outputPath) {
  const accessToken = readAccessToken(authPath);
  const timeoutMs = process.env.CODEX_PROFILE_TIMEOUT_MS || argValue('--timeout-ms', DEFAULT_TIMEOUT_MS);
  const response = await fetch(PROFILE_URL, {
    signal: makeTimeoutSignal(timeoutMs),
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json'
    }
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Profile API returned non-JSON status ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`Profile API failed with status ${response.status}: ${body?.detail || body?.error || 'unknown error'}`);
  }

  const totalTokens = Number(body?.stats?.lifetime_tokens || 0);
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    throw new Error('Profile API did not include stats.lifetime_tokens');
  }

  const profile = body?.profile || {};
  const stats = {
    source: 'chatgpt-wham-profile',
    fetchedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalTokens,
    peakTokens: Number(body?.stats?.peak_daily_tokens || 0) || null,
    fastModeUsagePercentage: Number(body?.stats?.fast_mode_usage_percentage || 0) || null,
    handle: profile.handle || null,
    plan: profile.plan_type || profile.subscription_plan || null
  };

  atomicWriteJson(outputPath, stats);
  return stats;
}

async function main() {
  const authPath = expandHome(process.env.CODEX_AUTH_JSON || argValue('--auth', DEFAULT_AUTH_PATH));
  const outputPath = expandHome(process.env.CODEX_PROFILE_STATS_FILE || argValue('--output', DEFAULT_OUTPUT_PATH));
  const stats = await fetchProfileStats(authPath, outputPath);
  console.log(JSON.stringify({
    ok: true,
    outputPath,
    totalTokens: stats.totalTokens,
    peakTokens: stats.peakTokens,
    fetchedAt: stats.fetchedAt
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  fetchProfileStats
};
