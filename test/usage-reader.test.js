const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { collectUsage } = require('../src/usage-reader');

function makeHarness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-usage-pet-'));
  const sessions = path.join(root, 'sessions', '2026', '07', '10');
  fs.mkdirSync(sessions, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  return {
    root,
    write(name, records) {
      const filePath = path.join(sessions, name);
      fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
      return filePath;
    },
    config: {
      pet: { name: 'Test', atlasPath: __filename },
      usage: {
        codexHome: root,
        maxSessionFiles: 24,
        preferredLimitId: 'codex',
        includeArchivedSessions: false,
        tailBytes: 2 * 1024 * 1024,
        tokensPerLevel: 100000,
        refreshMs: 5000,
        completionGraceMs: 0,
        profileStats: { enabled: false }
      }
    }
  };
}

function sessionMeta(id, options = {}) {
  return {
    timestamp: options.timestamp || '2026-07-10T07:00:00.000Z',
    type: 'session_meta',
    payload: {
      id,
      parent_thread_id: options.parentThreadId || null,
      thread_source: options.threadSource || 'user',
      source: options.source || 'vscode',
      cwd: options.cwd || `/tmp/${id}`
    }
  };
}

function tokenCount(timestamp, limitId, primaryUsed, secondaryUsed) {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { total_tokens: 1000 },
        last_token_usage: { total_tokens: 100 }
      },
      rate_limits: {
        limit_id: limitId,
        plan_type: 'prolite',
        primary: { used_percent: primaryUsed, window_minutes: 300, resets_at: 2000000000 },
        secondary: { used_percent: secondaryUsed, window_minutes: 10080, resets_at: 2000600000 }
      }
    }
  };
}

function message(timestamp, role, text) {
  return {
    timestamp,
    type: 'response_item',
    payload: { type: 'message', role, content: [{ type: 'input_text', text }] }
  };
}

test('prefers the standard codex limit over a newer bengalfox zero-usage event', (t) => {
  const harness = makeHarness(t);
  const codexFile = harness.write('codex.jsonl', [
    sessionMeta('codex-task'),
    tokenCount('2026-07-10T07:00:10.000Z', 'codex', 28, 4)
  ]);
  harness.write('bengalfox.jsonl', [
    sessionMeta('bengalfox-task'),
    tokenCount('2026-07-10T07:00:20.000Z', 'codex_bengalfox', 0, 0)
  ]);

  const usage = collectUsage(harness.config);

  assert.equal(usage.limitId, 'codex');
  assert.equal(usage.primary.leftPercent, 72);
  assert.equal(usage.secondary.leftPercent, 96);
  assert.equal(usage.sourceFile, codexFile);
  assert.deepEqual(new Set(usage.scan.availableLimitIds), new Set(['codex', 'codex_bengalfox']));
});

test('ignores guardian activity and keeps the user task when approval replies arrive', (t) => {
  const harness = makeHarness(t);
  harness.write('user.jsonl', [
    sessionMeta('user-task', { cwd: '/tmp/product-work' }),
    tokenCount('2026-07-10T07:00:01.000Z', 'codex', 20, 3),
    message('2026-07-10T07:00:02.000Z', 'user', '修复剩余用量和当前执行内容'),
    message('2026-07-10T07:00:03.000Z', 'user', '允许')
  ]);
  harness.write('guardian.jsonl', [
    sessionMeta('guardian-task', {
      timestamp: '2026-07-10T07:00:04.000Z',
      parentThreadId: 'user-task',
      threadSource: 'subagent',
      source: { subagent: { other: 'guardian' } }
    }),
    message(
      '2026-07-10T07:00:05.000Z',
      'user',
      'The following is the Codex agent history added since your last approval assessment.'
    )
  ]);

  const usage = collectUsage(harness.config);

  assert.equal(usage.activity.task, '修复剩余用量和当前执行内容');
  assert.equal(usage.activity.sessionId, 'user-task');
  assert.equal(usage.activity.workspace, 'product-work');
});

test('tracks new custom tool call events until their output arrives', (t) => {
  const harness = makeHarness(t);
  const filePath = harness.write('custom-tool.jsonl', [
    sessionMeta('custom-tool-task'),
    tokenCount('2026-07-10T07:00:01.000Z', 'codex', 10, 2),
    message('2026-07-10T07:00:02.000Z', 'user', '检查日志'),
    {
      timestamp: '2026-07-10T07:00:03.000Z',
      type: 'response_item',
      payload: { type: 'custom_tool_call', name: 'exec', input: 'await tools.exec_command({})', call_id: 'call-1' }
    }
  ]);

  let usage = collectUsage(harness.config);
  assert.equal(usage.activity.isToolRunning, true);
  assert.equal(usage.activity.tool, 'local tools');

  fs.appendFileSync(filePath, `${JSON.stringify({
    timestamp: '2026-07-10T07:00:04.000Z',
    type: 'response_item',
    payload: { type: 'custom_tool_call_output', call_id: 'call-1', output: 'ok' }
  })}\n`);

  usage = collectUsage(harness.config);
  assert.equal(usage.activity.isToolRunning, false);
  assert.match(usage.activity.status, /^Finished local tools/);
});

test('tracks MCP begin and end events', (t) => {
  const harness = makeHarness(t);
  const filePath = harness.write('mcp-tool.jsonl', [
    sessionMeta('mcp-tool-task'),
    tokenCount('2026-07-10T07:00:01.000Z', 'codex', 10, 2),
    message('2026-07-10T07:00:02.000Z', 'user', '检查设计'),
    {
      timestamp: '2026-07-10T07:00:03.000Z',
      type: 'event_msg',
      payload: {
        type: 'mcp_tool_call_begin',
        call_id: 'mcp-1',
        invocation: { server: 'pencil', tool: 'get_editor_state', arguments: {} }
      }
    }
  ]);

  let usage = collectUsage(harness.config);
  assert.equal(usage.activity.isToolRunning, true);
  assert.equal(usage.activity.tool, 'pencil: get_editor_state');

  fs.appendFileSync(filePath, `${JSON.stringify({
    timestamp: '2026-07-10T07:00:04.000Z',
    type: 'event_msg',
    payload: { type: 'mcp_tool_call_end', call_id: 'mcp-1', result: { ok: true } }
  })}\n`);

  usage = collectUsage(harness.config);
  assert.equal(usage.activity.isToolRunning, false);
  assert.match(usage.activity.status, /^Finished pencil: get_editor_state/);
});
