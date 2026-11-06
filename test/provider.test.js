import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { makeStreamParser } from '../src/providers/stream-json.js';
import { makeClaudeCodeProvider, buildArgs } from '../src/providers/claude-code.js';
import { handleMcp } from '../src/mcp/handler.js';

const INIT = { type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', apiKeySource: 'none', mcp_servers: [{ name: 'monkeycraft', status: 'connected' }], tools: ['mcp__monkeycraft__shell_exec'] };
const RESULT = { type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0.0123, num_turns: 2, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 } };

test('stream parser: init, deltas, no double text, result', () => {
  const p = makeStreamParser();
  assert.deepEqual(p.feed(INIT)[0], { kind: 'init', model: 'claude-sonnet-5-5', apiKeySource: 'none', mcpStatus: 'connected', tools: ['mcp__monkeycraft__shell_exec'] });
  p.feed({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } });
  assert.deepEqual(p.feed({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } }), [{ kind: 'token', text: 'Hel' }]);
  assert.deepEqual(p.feed({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hello' }] } }), [], 'already streamed');
  assert.deepEqual(p.feed({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Whole' }, { type: 'tool_use', id: 't', name: 'x', input: {} }] } }), [{ kind: 'token', text: 'Whole' }]);
  const [r] = p.feed(RESULT);
  assert.equal(r.reason, 'done'); assert.equal(r.usd, 0.0123); assert.equal(r.cacheReadTokens, 1000); assert.equal(r.turns, 2);
  assert.equal(p.feed({ ...RESULT, subtype: 'error_max_turns', is_error: true })[0].reason, 'max_iters');
  assert.equal(p.feed({ ...RESULT, subtype: 'error_max_budget_usd', is_error: true })[0].reason, 'budget');
  assert.equal(p.feed({ ...INIT, mcp_servers: [] })[0].mcpStatus, 'missing');
  assert.deepEqual(p.feed(null), []); assert.deepEqual(p.feed({ type: 'weird' }), []);
});

test('CLI args: built-in tools off, only the MonkeyCraft MCP server', () => {
  const a = buildArgs({ agent: { model: 'm', systemPrompt: 'sp' }, mcpConfig: { mcpServers: {} }, maxBudgetUsd: 2 });
  const val = f => a[a.indexOf(f) + 1];
  assert.equal(val('--tools'), ''); assert.ok(a.includes('--strict-mcp-config'));
  assert.equal(val('--allowedTools'), 'mcp__monkeycraft'); assert.equal(val('--permission-mode'), 'dontAsk');
  assert.equal(val('--max-budget-usd'), '2'); assert.equal(val('--system-prompt'), 'sp');
  assert.ok(!a.some(x => x.includes('dangerously')));
});

function fakeSpawn(lines, { exitCode = 0, hang = false } = {}) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdin = new PassThrough(); c.pid = 4242;
    let input = ''; c.stdin.on('data', d => { input += d; });
    c.kill = () => { setImmediate(() => c.emit('close', null, 'SIGTERM')); };
    calls.push({ cmd, args, opts, input: () => input });
    setImmediate(() => {
      for (const l of lines) c.stdout.write(JSON.stringify(l) + '\n');
      if (!hang) setImmediate(() => c.emit('close', exitCode));
    });
    return c;
  };
  return { spawn, calls };
}
const agent = { id: 'smith', model: 'claude-sonnet-5-5', systemPrompt: 'sp' };

test('provider: maps a run to events, strips the API key, sends the prompt on stdin', async () => {
  const { spawn, calls } = fakeSpawn([INIT, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } }, RESULT]);
  const p = makeClaudeCodeProvider({ spawn, claudePath: '/x/claude', baseEnv: { ANTHROPIC_API_KEY: 'sk-secret', CLAUDECODE: '1', PATH: '/bin' }, killProcessGroup: () => {}, cwd: '/ws' });
  const events = [];
  const r = await p.run({ agent, prompt: 'list files', mcpConfig: {}, emit: (t, x) => events.push({ type: t, ...x }) });
  assert.equal(r.reason, 'done'); assert.equal(r.billing, 'subscription'); assert.equal(r.tokens, 1160);
  assert.deepEqual(events.map(e => e.type), ['agent.token', 'agent.cost']);
  assert.equal(events[1].billing, 'subscription');
  assert.equal(calls[0].opts.env.ANTHROPIC_API_KEY, undefined); assert.equal(calls[0].opts.env.CLAUDECODE, undefined); assert.equal(calls[0].opts.env.PATH, '/bin');
  assert.equal(calls[0].input(), 'list files');
});

test('provider: no result → error event; MCP not connected → error event; abort → halted', async () => {
  let s = fakeSpawn([], { exitCode: 1 });
  let events = [];
  let p = makeClaudeCodeProvider({ spawn: s.spawn, claudePath: 'c', baseEnv: {}, killProcessGroup: () => {}, cwd: '/' });
  let r = await p.run({ agent, prompt: 'x', mcpConfig: {}, emit: (t, x) => events.push({ type: t, ...x }) });
  assert.equal(r.reason, 'error'); assert.equal(events[0].code, 'cli_failed');

  s = fakeSpawn([{ ...INIT, mcp_servers: [{ name: 'monkeycraft', status: 'failed' }] }, { ...RESULT, subtype: 'error_during_execution', is_error: true, result: 'boom' }]);
  events = [];
  p = makeClaudeCodeProvider({ spawn: s.spawn, claudePath: 'c', baseEnv: {}, killProcessGroup: () => {}, cwd: '/' });
  r = await p.run({ agent, prompt: 'x', mcpConfig: {}, emit: (t, x) => events.push({ type: t, ...x }) });
  assert.equal(r.reason, 'error'); assert.equal(events[0].code, 'mcp_unavailable');

  s = fakeSpawn([INIT], { hang: true });
  p = makeClaudeCodeProvider({ spawn: s.spawn, claudePath: 'c', baseEnv: {}, killProcessGroup: () => {}, cwd: '/' });
  const ac = new AbortController();
  const pr = p.run({ agent, prompt: 'x', mcpConfig: {}, signal: ac.signal, emit: () => {} });
  setTimeout(() => ac.abort('halt'), 10);
  assert.equal((await pr).reason, 'halted');
});

test('MCP handler: initialize, list, call, notifications, errors', async () => {
  const deps = { listTools: () => [{ name: 'fs_read', description: 'd', inputSchema: {} }], callTool: async (n, a) => ({ content: `${n}:${a.path}`, isError: false }) };
  const init = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, deps);
  assert.equal(init.result.protocolVersion, '2025-06-18'); assert.ok(init.result.capabilities.tools);
  assert.equal((await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, deps)).result.protocolVersion, '2025-11-25');
  assert.equal(await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps), null);
  assert.equal((await handleMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, deps)).result.tools[0].name, 'fs_read');
  const call = await handleMcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fs_read', arguments: { path: 'a' } } }, deps);
  assert.deepEqual(call.result, { content: [{ type: 'text', text: 'fs_read:a' }], isError: false });
  assert.equal((await handleMcp({ jsonrpc: '2.0', id: 4, method: 'nope' }, deps)).error.code, -32601);
  assert.equal((await handleMcp({ id: 5 }, deps)).error.code, -32600);
  const boom = await handleMcp({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'x' } }, { ...deps, callTool: async () => { throw new Error('kaput'); } });
  assert.equal(boom.error.code, -32603);
});
