const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const APP_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(APP_ROOT, 'config.json');
const APP_DATA_DIR = process.env.CODEX_USAGE_PET_DATA_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'codex-usage-pet');

function readConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);
  const home = os.homedir();
  config.usage.codexHome = resolveConfigPath(config.usage.codexHome || path.join(home, '.codex'));
  if (config.usage.profileStatsFile) {
    const profileStatsFile = config.usage.profileStatsFile;
    config.usage.profileStatsFile = resolveDataPath(profileStatsFile);
    if (!path.isAbsolute(expandHome(profileStatsFile))) {
      config.usage.profileStatsFallbackFile = resolveConfigPath(profileStatsFile);
    }
  }
  config.usage.appDataDir = APP_DATA_DIR;
  config.pet.atlasPath = resolveConfigPath(config.pet.atlasPath);
  return config;
}

function expandHome(value) {
  if (!value || typeof value !== 'string') return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolveConfigPath(value) {
  const expanded = expandHome(value);
  if (!expanded || typeof expanded !== 'string') return expanded;
  return path.isAbsolute(expanded) ? expanded : path.join(APP_ROOT, expanded);
}

function resolveDataPath(value) {
  const expanded = expandHome(value);
  if (!expanded || typeof expanded !== 'string') return expanded;
  return path.isAbsolute(expanded) ? expanded : path.join(APP_DATA_DIR, expanded);
}

function walkJsonl(root, out = []) {
  if (!root || !fs.existsSync(root)) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkJsonl(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        const stat = fs.statSync(full);
        out.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        // Ignore files that disappear while Codex is writing them.
      }
    }
  }
  return out;
}

function getCandidateFiles(config) {
  const codexHome = config.usage.codexHome;
  const max = Number(config.usage.maxSessionFiles || 24);
  const files = [...walkJsonl(path.join(codexHome, 'sessions'))];
  if (config.usage.includeArchivedSessions) {
    files.push(...walkJsonl(path.join(codexHome, 'archived_sessions')));
  }
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, max)
    .map((file) => ({ ...file, sessionMeta: readSessionMeta(file.path) }));
}

function readFirstLine(filePath, maxBytes = 4 * 1024 * 1024) {
  let fd;
  try {
    const stat = fs.statSync(filePath);
    const length = Math.min(stat.size, maxBytes);
    const chunks = [];
    let offset = 0;
    fd = fs.openSync(filePath, 'r');
    while (offset < length) {
      const size = Math.min(64 * 1024, length - offset);
      const buffer = Buffer.alloc(size);
      const bytesRead = fs.readSync(fd, buffer, 0, size, offset);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      const newlineIndex = chunk.indexOf(10);
      if (newlineIndex >= 0) {
        chunks.push(chunk.subarray(0, newlineIndex));
        break;
      }
      chunks.push(chunk);
      offset += bytesRead;
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

function readSessionMeta(filePath) {
  const line = readFirstLine(filePath);
  if (!line) return null;
  try {
    const obj = JSON.parse(line);
    if (obj.type !== 'session_meta') return null;
    const payload = obj.payload || {};
    return {
      id: payload.id || payload.session_id || null,
      parentThreadId: payload.parent_thread_id || null,
      threadSource: payload.thread_source || null,
      source: payload.source || null,
      cwd: payload.cwd || null
    };
  } catch {
    return null;
  }
}

function isPrimaryUserSession(file) {
  const meta = file?.sessionMeta;
  if (!meta) return true;
  if (meta.parentThreadId) return false;
  if (meta.threadSource === 'subagent') return false;
  if (meta.source && typeof meta.source === 'object' && meta.source.subagent) return false;
  return true;
}

function readFileTail(filePath, tailBytes) {
  const maxBytes = Math.max(64 * 1024, Number(tailBytes || 2 * 1024 * 1024));
  try {
    const stat = fs.statSync(filePath);
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, length, stat.size - length);
    } finally {
      fs.closeSync(fd);
    }
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

function parseTokenCounts(filePath, config) {
  const text = readFileTail(filePath, config?.usage?.tailBytes);
  const events = [];
  for (const line of text.split(/\n/)) {
    if (!line.includes('"token_count"')) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== 'event_msg' || obj.payload?.type !== 'token_count') continue;
    const totalTokens = Number(obj.payload?.info?.total_token_usage?.total_tokens || 0);
    events.push({
      timestamp: obj.timestamp,
      filePath,
      totalTokens,
      payload: obj.payload
    });
  }
  return events;
}

function collectUsage(config = readConfig()) {
  const files = getCandidateFiles(config);
  let latestActivity = null;
  let lifetimeTokens = 0;
  let sessionCount = 0;
  const latestByLimitId = new Map();

  for (const file of files) {
    if (!isPrimaryUserSession(file)) continue;
    const events = parseTokenCounts(file.path, config);
    if (!events.length) continue;
    sessionCount += 1;

    const maxForSession = events.reduce((max, event) => Math.max(max, event.totalTokens || 0), 0);
    lifetimeTokens += maxForSession;

    for (const event of events) {
      const limitId = event.payload?.rate_limits?.limit_id || 'unknown';
      const current = latestByLimitId.get(limitId);
      if (!current || eventTime(event) > eventTime(current)) {
        latestByLimitId.set(limitId, event);
      }
    }
  }

  const preferredLimitId = config?.usage?.preferredLimitId || 'codex';
  const latest = latestByLimitId.get(preferredLimitId) || newestEvent(latestByLimitId.values());

  const activityFiles = files.filter(isPrimaryUserSession).slice(0, 8);
  for (const file of activityFiles) {
    const activity = parseActivity(file.path, config);
    if (!activity?.updatedAt) continue;
    activity.sessionId = file.sessionMeta?.id || null;
    activity.workspace = file.sessionMeta?.cwd ? path.basename(file.sessionMeta.cwd) : null;
    if (!latestActivity || new Date(activity.updatedAt).getTime() > new Date(latestActivity.updatedAt).getTime()) {
      latestActivity = activity;
    }
  }

  const profileStats = normalizeProfileStats(config);
  const levelTokenOffset = Number(config.usage.levelTokenOffset || 0);
  const fallbackLevelTokens = lifetimeTokens + levelTokenOffset;
  const levelTokens = profileStats?.totalTokens || fallbackLevelTokens;
  const level = makeLevel(levelTokens, config.usage.tokensPerLevel);
  const primary = normalizeLimit(latest?.payload?.rate_limits?.primary);
  const secondary = normalizeLimit(latest?.payload?.rate_limits?.secondary);

  return {
    ok: Boolean(latest),
    generatedAt: new Date().toISOString(),
    latestEventAt: latest?.timestamp || null,
    sourceFile: latest?.filePath || null,
    pet: {
      ...config.pet,
      atlasUrl: pathToFileURL(config.pet.atlasPath).toString()
    },
    planType: latest?.payload?.rate_limits?.plan_type || 'unknown',
    limitId: latest?.payload?.rate_limits?.limit_id || 'codex',
    primary,
    secondary,
    tokens: {
      lifetime: levelTokens,
      recentTotal: lifetimeTokens,
      levelTokenOffset,
      profileTotal: profileStats?.totalTokens || null,
      profilePeak: profileStats?.peakTokens || null,
      latestThreadTotal: latest?.payload?.info?.total_token_usage?.total_tokens || 0,
      latestTurn: latest?.payload?.info?.last_token_usage?.total_tokens || 0,
      input: latest?.payload?.info?.total_token_usage?.input_tokens || 0,
      output: latest?.payload?.info?.total_token_usage?.output_tokens || 0,
      reasoning: latest?.payload?.info?.total_token_usage?.reasoning_output_tokens || 0,
      contextWindow: latest?.payload?.info?.model_context_window || null
    },
    level,
    profileStats,
    refreshMs: Number(config.usage.refreshMs || 15000),
    activity: latestActivity || {
      updatedAt: null,
      task: 'No current Codex task found',
      status: 'Waiting for Codex session activity',
      tool: null,
      isToolRunning: false
    },
    scan: {
      sessionCount,
      fileCount: files.length,
      recentTokenTotal: lifetimeTokens,
      preferredLimitId,
      availableLimitIds: Array.from(latestByLimitId.keys()),
      tailBytes: Number(config.usage.tailBytes || 2 * 1024 * 1024),
      includeArchivedSessions: Boolean(config.usage.includeArchivedSessions)
    }
  };
}

function eventTime(event) {
  const timestamp = new Date(event?.timestamp || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function newestEvent(events) {
  let latest = null;
  for (const event of events) {
    if (!latest || eventTime(event) > eventTime(latest)) latest = event;
  }
  return latest;
}

function normalizeProfileStats(config) {
  const fileStats = readProfileStatsFile(config?.usage?.profileStatsFile);
  if (fileStats) return fileStats;
  const fallbackFileStats = readProfileStatsFile(config?.usage?.profileStatsFallbackFile);
  if (fallbackFileStats) return fallbackFileStats;

  const stats = config?.usage?.profileStats;
  if (!stats || stats.enabled === false) return null;
  const totalTokens = Number(stats.totalTokens || 0);
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null;
  const peakTokens = Number(stats.peakTokens || 0);
  return {
    source: stats.source || 'manual',
    totalTokens,
    peakTokens: Number.isFinite(peakTokens) && peakTokens > 0 ? peakTokens : null,
    updatedAt: stats.updatedAt || null
  };
}

function readProfileStatsFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const stats = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const totalTokens = Number(stats.totalTokens || stats.lifetimeTokens || 0);
    if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null;
    const peakTokens = Number(stats.peakTokens || stats.peakDailyTokens || 0);
    return {
      source: stats.source || `file:${filePath}`,
      totalTokens,
      peakTokens: Number.isFinite(peakTokens) && peakTokens > 0 ? peakTokens : null,
      updatedAt: stats.updatedAt || stats.fetchedAt || null
    };
  } catch {
    return null;
  }
}

function parseActivity(filePath, config) {
  const text = readFileTail(filePath, config?.usage?.tailBytes);

  const activity = {
    sourceFile: filePath,
    updatedAt: null,
    turnId: null,
    task: null,
    status: null,
    tool: null,
    isToolRunning: false,
    isComplete: false,
    isFailed: false,
    completedAt: null,
    completionHasFinalMessage: false
  };
  const pendingCalls = new Map();

  for (const line of text.split(/\n/)) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const timestamp = obj.timestamp || null;
    const payload = obj.payload || {};

    if (obj.type === 'event_msg') {
      if (payload.type === 'task_started') {
        pendingCalls.clear();
        activity.turnId = payload.turn_id || activity.turnId;
        activity.isComplete = false;
        activity.isFailed = false;
        activity.completedAt = null;
        activity.completionHasFinalMessage = false;
        activity.status = activity.status || 'Task started';
        activity.updatedAt = timestamp || activity.updatedAt;
        continue;
      }

      if (payload.type === 'task_complete') {
        pendingCalls.clear();
        activity.turnId = payload.turn_id || activity.turnId;
        activity.isComplete = true;
        activity.isToolRunning = false;
        activity.completedAt = timestamp || activity.completedAt;
        activity.completionHasFinalMessage = Boolean(payload.last_agent_message);
        activity.status = 'Task complete';
        activity.updatedAt = timestamp || activity.updatedAt;
        continue;
      }

      if (payload.type === 'agent_message') {
        activity.status = cleanText(payload.message);
        activity.updatedAt = timestamp || activity.updatedAt;
        continue;
      }

      if (payload.type === 'mcp_tool_call_begin') {
        const summary = summarizeMcpToolCall(payload.invocation);
        markToolStarted(activity, pendingCalls, payload.call_id, summary, timestamp);
        continue;
      }

      if (payload.type === 'mcp_tool_call_end') {
        markToolFinished(activity, pendingCalls, payload.call_id, payload.result, timestamp);
        continue;
      }
    }

    if (obj.type !== 'response_item') continue;

    if (payload.type === 'message') {
      const message = extractMessageText(payload);
      if (!message) continue;
      const userPrompt = payload.role === 'user' ? extractUserPrompt(message) : null;
      if (userPrompt) {
        if (!activity.task || !isContinuationReply(userPrompt)) {
          activity.task = cleanText(userPrompt);
        }
        activity.updatedAt = timestamp || activity.updatedAt;
      } else if (payload.role === 'assistant') {
        activity.status = cleanText(message);
        activity.updatedAt = timestamp || activity.updatedAt;
      }
      continue;
    }

    if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const rawArgs = payload.arguments ?? payload.input;
      const summary = summarizeToolCall(payload.name, rawArgs);
      markToolStarted(activity, pendingCalls, payload.call_id, summary, timestamp);
      continue;
    }

    if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      markToolFinished(activity, pendingCalls, payload.call_id, payload.output, timestamp);
    }
  }

  if (pendingCalls.size > 0) {
    activity.isToolRunning = true;
    activity.tool = Array.from(pendingCalls.values()).filter(Boolean).at(-1) || activity.tool;
  }
  activity.task = activity.task || 'Current Codex task';
  activity.status = activity.status || (activity.isToolRunning ? 'Running tool' : 'Idle or waiting for next update');
  suppressFreshCompletionDuringContextUpdate(activity, config);
  activity.isActive = Boolean(activity.task && !activity.isComplete);
  return activity;
}

function markToolStarted(activity, pendingCalls, callId, summary, timestamp) {
  activity.tool = summary;
  activity.status = summary ? `Running ${summary}` : 'Running tool';
  activity.isToolRunning = true;
  activity.isComplete = false;
  activity.isFailed = false;
  activity.completedAt = null;
  activity.completionHasFinalMessage = false;
  activity.updatedAt = timestamp || activity.updatedAt;
  if (callId) pendingCalls.set(callId, summary);
}

function markToolFinished(activity, pendingCalls, callId, output, timestamp) {
  const finishedTool = callId ? pendingCalls.get(callId) : activity.tool;
  const failed = toolOutputLooksFailed(output);
  if (callId) pendingCalls.delete(callId);
  if (pendingCalls.size === 0) {
    activity.isToolRunning = false;
    activity.tool = finishedTool || activity.tool;
    activity.isFailed = failed;
    activity.status = failed
      ? `Failed ${finishedTool || 'tool'}`
      : `Finished ${finishedTool || 'tool'}, waiting for next step`;
  }
  activity.updatedAt = timestamp || activity.updatedAt;
}

function suppressFreshCompletionDuringContextUpdate(activity, config) {
  if (!activity.isComplete || !activity.completedAt) return;
  if (activity.completionHasFinalMessage) return;
  const graceMs = Number(config?.usage?.completionGraceMs ?? 10000);
  if (!Number.isFinite(graceMs) || graceMs <= 0) return;
  const completedAtMs = new Date(activity.completedAt).getTime();
  if (!Number.isFinite(completedAtMs)) return;
  if (Date.now() - completedAtMs > graceMs) return;
  activity.isComplete = false;
  activity.status = 'Finishing context update';
}

function toolOutputLooksFailed(output) {
  const text = (typeof output === 'string' ? output : JSON.stringify(output || '')).toLowerCase();
  return (
    /process exited with code\s+([1-9]\d*)/.test(text) ||
    /exit code:\s*([1-9]\d*)/.test(text) ||
    /"iserror"\s*:\s*true/.test(text)
  );
}

function extractMessageText(message) {
  const content = Array.isArray(message.content) ? message.content : [];
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      return part?.text || part?.input_text || part?.output_text || '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractUserPrompt(message) {
  const value = message.trim();
  if (!value || value.startsWith('<environment_context>')) return null;
  if (value.startsWith('The following is the Codex agent history added since your last approval assessment.')) return null;
  const marker = 'My request for Codex:';
  const markerIndex = value.indexOf(marker);
  if (markerIndex >= 0) {
    return value.slice(markerIndex + marker.length).trim();
  }
  if (value.startsWith('# Files mentioned by the user:')) return null;
  return value;
}

function isContinuationReply(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[。.!！?？,，\s]+$/g, '');
  return /^(允许|同意|继续|可以|好|好的|确认|批准|yes|ok|okay|approve|approved)$/.test(normalized);
}

function summarizeToolCall(name, rawArgs) {
  if (!name) return null;
  let args = {};
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch {
    args = {};
  }
  if (name === 'exec_command' && args.cmd) return `terminal: ${cleanText(args.cmd, 80)}`;
  if (name === 'exec') return 'local tools';
  if (name === 'apply_patch') return 'editing files';
  if (name === 'write_stdin') return 'waiting for command';
  return name.replace(/_/g, ' ');
}

function summarizeMcpToolCall(invocation) {
  const server = cleanText(invocation?.server || '', 36);
  const tool = cleanText(invocation?.tool || '', 56);
  if (server && tool) return `${server}: ${tool}`;
  return tool || server || 'connected tool';
}

function cleanText(value, maxLength = 130) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function normalizeLimit(limit) {
  if (!limit) {
    return {
      available: false,
      usedPercent: 0,
      leftPercent: 0,
      windowMinutes: null,
      resetsAt: null,
      resetInMs: null
    };
  }
  const usedPercent = clamp(Number(limit.used_percent || 0), 0, 100);
  const resetsAtMs = Number(limit.resets_at || 0) * 1000;
  return {
    available: true,
    usedPercent,
    leftPercent: clamp(100 - usedPercent, 0, 100),
    windowMinutes: limit.window_minutes || null,
    resetsAt: resetsAtMs ? new Date(resetsAtMs).toISOString() : null,
    resetInMs: resetsAtMs ? Math.max(0, resetsAtMs - Date.now()) : null
  };
}

function makeLevel(tokens, tokensPerLevel) {
  const step = Math.max(1000, Number(tokensPerLevel || 50000));
  const totalTokens = Math.max(0, Number(tokens || 0));
  const level = Math.max(1, Math.ceil(totalTokens / step));
  const levelCap = step * level;
  const levelFloor = Math.max(0, levelCap - step);
  const currentLevelXp = Math.max(0, totalTokens - levelFloor);
  const remainingLevelXp = Math.max(0, levelCap - totalTokens);
  return {
    value: level,
    currentXp: currentLevelXp,
    nextXp: step,
    totalXp: totalTokens,
    levelCap,
    remainingLevelXp,
    percent: clamp((1 - (remainingLevelXp / step)) * 100, 0, 100),
    tokensPerLevel: step
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

if (require.main === module) {
  const usage = collectUsage();
  if (process.argv.includes('--once')) {
    console.log(JSON.stringify(usage, null, 2));
  }
}

module.exports = {
  readConfig,
  collectUsage
};
