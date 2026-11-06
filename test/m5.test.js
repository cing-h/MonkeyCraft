// M5 Finish: the API-key provider runs the same job through the same
// pipeline as Claude Code; settings are validated, saved and applied; and
// after a crash, jobs are closed, the Job log is replayed and Revert works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { memFs } from './helpers/memfs.js';
import { makeBus } from '../src/bus.js';
import { makeJournal } from '../src/store/journal.js';
import { makeLedger } from '../src/money/ledger.js';
import { makeRunHost } from '../src/runs.js';
import { makeRoster } from '../src/crew/roster.js';
import { makeRegistry } from '../src/tools/registry.js';
import { makeConsentBroker } from '../src/safety/consent.js';
import { makeGrantStore } from '../src/safety/grants.js';
import { makeAnthropicProvider, costUsd } from '../src/providers/anthropic.js';
import { validateSettings, makeSettingsStore } from '../src/settings.js';
import { settingsRoutes } from '../src/routes/settings.js';
import { validateEvent } from '../src/events.js';

// ---------- a fake Anthropic client: each call to stream() plays the next scripted turn ----------
function fakeClient(turns, seen = []) {
  const stream = (params, opts) => {
    seen.push({ params: structuredClone({ ...params, messages: params.messages.map(m => ({ role: m.role })) }), messages: params.messages, opts });
    const t = turns.shift();
    if (!t) throw new Error('no more scripted turns');
    if (t.throw) throw t.throw;
    const msg = { id: `msg_${seen.length}`, role: 'assistant', content: t.content, stop_reason: t.stop, stop_details: t.stopDetails || null, usage: t.usage };
    const events = [{ type: 'message_start', message: { ...msg, content: [], usage: { ...t.usage, output_tokens: 1 } } }];
    for (const b of t.content) if (b.type === 'text') events.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: b.text } });
    events.push({ type: 'message_delta', delta: { stop_reason: t.stop }, usage: { output_tokens: t.usage.output_tokens } });
    return { async *[Symbol.asyncIterator]() { for (const e of events) { if (opts?.signal?.aborted) throw new Error('aborted'); yield e; } }, finalMessage: async () => msg };
  };
  return { messages: { stream }, beta: { messages: { stream } } };
}
const U = (i, o) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

async function world({ provider, providerId }) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-m5-'));
  let n = 0, now = 5_000_000; const clock = { now: () => now++ }, newId = p => `${p}_${++n}`;
  const journal = makeJournal({ fsp, dir: path.join(dir, 'runs'), flushMs: 5 }); await journal.init();
  const ledger = makeLedger({ fsp, file: path.join(dir, 'ledger.ndjson') });
  const bus = makeBus({ clock, journal }), seen = []; bus.subscribe(e => seen.push(e));
  const roster = makeRoster({ workspace: '/ws' });
  roster.configure({ smith: { provider: providerId } });
  const tool = (name, scope) => ({ name, scope, capability: 'files', description: name, inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    assess: async a => ({ summary: `${name} ${a.path}`, cacheKey: `${name}:${a.path}` }), run: async a => ({ content: `${name} did ${a.path}`, summary: 'ok' }) });
  const registry = makeRegistry([tool('fs.read', 'read'), tool('fs.write', 'write'), tool('shell.exec', 'execute')]);
  const consent = makeConsentBroker({ newId, grants: makeGrantStore({ fsp: memFs(), file: '/g', clock }) });
  let host;
  host = makeRunHost({ bus, providers: { [providerId]: provider(() => host) }, registry, consent, ledger, roster, journal, clock, newId, newToken: () => 'tok' + (++n), mcpUrl: id => `http://x/mcp/${id}`,
    limits: { perRunUsd: 2, perRunTokens: 1e9, dailyUsd: 25, familyUsd: 5, familyTokens: 1e9, maxConcurrent: 2, maxWorkers: 2 } });
  await host.init();
  return { host, seen, consent, ledger, journal, dir };
}
// answer every permission question "allow once" as it appears
const autoAllow = w => { const answered = new Set(); const t = setInterval(() => { for (const e of w.seen) if (e.type === 'permission.prompt' && !answered.has(e.promptId)) { answered.add(e.promptId); w.consent.respond(e.promptId, 'allow_once'); } }, 2); return () => clearInterval(t); };

test('the same job runs on both providers through the same pipeline', async () => {
  const job = 'Read a.txt, then write b.txt.';
  // Claude Code: the CLI calls MonkeyCraft's tools over MCP
  const cc = await world({ providerId: 'claude-code', provider: getHost => ({ run: async ({ mcpConfig, emit }) => {
    const url = mcpConfig.mcpServers.monkeycraft.url, ctx = getHost().mcpContext(url.split('/').pop(), mcpConfig.mcpServers.monkeycraft.headers.Authorization.slice(7));
    await ctx.callTool('fs_read', { path: 'a.txt' }); await ctx.callTool('fs_write', { path: 'b.txt' });
    emit('agent.token', { text: 'Done.' });
    emit('agent.cost', { usd: 0.01, priced: true, inputTokens: 100, outputTokens: 20, billing: 'subscription' });
    return { reason: 'done', usd: 0.01, tokens: 120, turns: 3, billing: 'subscription', text: 'Done.' };
  } }) });
  // Anthropic API: MonkeyCraft's own loop calls the same tools directly
  const calls = [];
  const client = fakeClient([
    { content: [{ type: 'tool_use', id: 'tu1', name: 'fs_read', input: { path: 'a.txt' } }], stop: 'tool_use', usage: U(100, 10) },
    { content: [{ type: 'tool_use', id: 'tu2', name: 'fs_write', input: { path: 'b.txt' } }], stop: 'tool_use', usage: U(150, 10) },
    { content: [{ type: 'text', text: 'Done.' }], stop: 'end_turn', usage: U(200, 5) }
  ], calls);
  const api = await world({ providerId: 'anthropic-api', provider: () => makeAnthropicProvider({ apiKey: 'sk-test', makeClient: () => client }) });
  for (const w of [cc, api]) { const stop = autoAllow(w); const r = await w.host.start({ agentId: 'smith', prompt: job }).done; stop(); assert.equal(r.reason, 'done'); }
  const shape = w => w.seen.filter(e => !['agent.token', 'agent.cost'].includes(e.type)).map(e => e.type === 'agent.tool_call' || e.type === 'agent.tool_result' ? `${e.type}:${e.tool}` : e.type);
  assert.deepEqual(shape(api), shape(cc), 'the same events, in the same order, from the same pipeline');
  assert.deepEqual(shape(api), ['run.start', 'agent.tool_call:fs.read', 'agent.tool_result:fs.read', 'agent.tool_call:fs.write', 'permission.prompt', 'permission.response', 'agent.tool_result:fs.write', 'run.end']);
  assert.equal(api.seen[0].provider, 'anthropic-api');
  for (const e of api.seen) assert.ok(validateEvent(e).ok, e.type);
  assert.equal((await api.ledger.rows())[0].billing, 'api');
  assert.equal((await cc.ledger.rows())[0].billing, 'subscription');
  // what was sent to the API
  const p = calls[0].params;
  assert.equal(p.model, 'claude-sonnet-5-5');
  assert.deepEqual(p.cache_control, { type: 'ephemeral' }, 'prompt caching is on');
  assert.deepEqual([p.fallbacks, p.betas], ['default', ['server-side-fallback-2026-07-01']], 'the refusal fallback is on');
  assert.ok(p.tools.every(t => t.eager_input_streaming === true), 'tool inputs stream eagerly');
  assert.deepEqual(p.tools.map(t => t.name).sort(), ['fs_read', 'fs_write', 'shell_exec']);
  const last = calls[2].messages;
  assert.deepEqual(last.map(m => m.role), ['user', 'assistant', 'user', 'assistant', 'user'], 'tool results go back as user messages, each turn appended');
  assert.equal(last[4].content[0].tool_use_id, 'tu2'); assert.match(last[4].content[0].content, /fs.write did b.txt/);
  assert.equal(api.seen.find(e => e.type === 'run.end').usd, costUsd('claude-sonnet-5-5', { input: 450, output: 25, cacheRead: 0, cacheWrite: 0 }).usd);
});

test('API provider: web search is reported and taints the job; a denied write is fed back', async () => {
  const client = fakeClient([
    { content: [{ type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'tallest tree' } }, { type: 'web_search_tool_result', tool_use_id: 'srv1', content: [{ type: 'web_search_result', url: 'https://x', title: 'x' }] }, { type: 'tool_use', id: 'tu1', name: 'fs_write', input: { path: 'b.txt' } }], stop: 'tool_use', usage: U(10, 10) },
    { content: [{ type: 'text', text: 'I could not write after reading the web.' }], stop: 'end_turn', usage: U(10, 10) }
  ]);
  const w = await world({ providerId: 'anthropic-api', provider: () => makeAnthropicProvider({ apiKey: 'k', makeClient: () => client }) });
  const r = await w.host.start({ agentId: 'smith', prompt: 'x' }).done;
  assert.equal(r.reason, 'done');
  const t = w.seen.map(e => e.type === 'agent.tool_call' || e.type === 'agent.tool_result' ? `${e.type}:${e.tool}` : e.type);
  assert.ok(t.includes('agent.tool_call:web.search') && t.includes('agent.tool_result:web.search') && t.includes('taint.set'));
  const res = w.seen.find(e => e.type === 'agent.tool_result' && e.tool === 'fs.write');
  assert.match(res.summary, /locked/, 'the lockout applies to the API provider too');
});

test('API provider: a refusal, a cut-off tool request, the spending limit, STOP and a missing key all end cleanly', async () => {
  const run = async (turns, extra = {}) => {
    const client = fakeClient(turns);
    const w = await world({ providerId: 'anthropic-api', provider: () => makeAnthropicProvider({ apiKey: extra.noKey ? '' : 'k', makeClient: () => client }) });
    const j = w.host.start({ agentId: 'smith', prompt: 'x' });
    if (extra.halt) setTimeout(() => w.host.halt('user'), 5);
    return { r: await j.done, w };
  };
  let { r, w } = await run([{ content: [], stop: 'refusal', stopDetails: { category: 'cyber' }, usage: U(5, 0) }]);
  assert.equal(r.reason, 'error'); assert.match(w.seen.find(e => e.type === 'run.error').message, /declined.*cyber/);
  ({ r, w } = await run([{ content: [{ type: 'tool_use', id: 't', name: 'fs_write', input: { path: 'half' } }], stop: 'max_tokens', usage: U(5, 64000) }]));
  assert.equal(r.reason, 'error'); assert.ok(!w.seen.some(e => e.type === 'agent.tool_call'), 'a cut-off tool request never runs');
  const loop = Array.from({ length: 5 }, (_, i) => ({ content: [{ type: 'tool_use', id: `t${i}`, name: 'fs_read', input: { path: `f${i}` } }], stop: 'tool_use', usage: U(400_000, 1000) }));
  ({ r, w } = await run(loop));
  assert.equal(r.reason, 'budget', 'stops once the job has spent its $2');
  ({ r } = await run([{ content: [{ type: 'tool_use', id: 't', name: 'shell_exec', input: { path: 'ls' } }], stop: 'tool_use', usage: U(5, 5) }], { halt: true }));
  assert.equal(r.reason, 'halted', 'STOP during a permission question');
  ({ r, w } = await run([], { noKey: true }));
  assert.equal(r.reason, 'error'); assert.match(w.seen.find(e => e.type === 'run.error').message, /No Anthropic API key/);
});

test('API provider: the refusal fallback is only requested on models that support it', async () => {
  const calls = [];
  const client = fakeClient([{ content: [{ type: 'text', text: 'hi' }], stop: 'end_turn', usage: U(1, 1) }], calls);
  const p = makeAnthropicProvider({ apiKey: 'k', makeClient: () => client });
  await p.run({ agent: { model: 'claude-haiku-5-5', systemPrompt: 's' }, prompt: 'x', emit: () => {}, tools: { listTools: () => [] } });
  assert.equal(calls[0].params.fallbacks, undefined);
  assert.equal(costUsd('claude-opus-5-5', { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }).usd, 4 + 20 + 0.2 + 5);
});

// ---------- settings ----------
test('settings: validated, saved durably, reloaded and applied to the roster', async () => {
  const ids = makeRoster({ workspace: '/ws' }).ids();
  assert.equal(validateSettings({ crew: { smith: { provider: 'openai' } } }, { crewIds: ids }).ok, false);
  assert.equal(validateSettings({ crew: { smith: { model: 'gpt-5' } } }, { crewIds: ids }).ok, false);
  assert.equal(validateSettings({ crew: { ghost: {} } }, { crewIds: ids }).ok, false);
  assert.equal(validateSettings({ limits: { perRunUsd: 0 } }, { crewIds: ids }).ok, false);
  assert.equal(validateSettings({ limits: { dailyUsd: 'lots' } }, { crewIds: ids }).ok, false);
  assert.equal(validateSettings({ limits: { hack: 1 } }, { crewIds: ids }).ok, false);
  const ok = validateSettings({ crew: { chief: { model: 'claude-opus-5-5' } }, limits: { perRunUsd: 1.234, perRunTokens: 300000.7 } }, { crewIds: ids });
  assert.deepEqual(ok.value, { crew: { chief: { model: 'claude-opus-5-5' } }, limits: { perRunUsd: 1.23, perRunTokens: 300001 } });
  const fs = memFs(), s = makeSettingsStore({ fsp: fs, file: '/d/settings.json', crewIds: ids });
  await s.save(ok.value);
  const s2 = makeSettingsStore({ fsp: fs, file: '/d/settings.json', crewIds: ids }); await s2.load();
  assert.deepEqual(s2.get(), ok.value);
  const roster = makeRoster({ workspace: '/ws' });
  roster.configure(s2.get().crew);
  assert.equal(roster.get('chief').model, 'claude-opus-5-5'); assert.equal(roster.get('smith').model, 'claude-sonnet-5-5');
  roster.configure({});
  assert.equal(roster.get('chief').model, 'claude-sonnet-5-5', 'clearing a setting goes back to the default');
});

test('settings API: choosing the API without a key is refused; good changes are saved and applied', async () => {
  const roster = makeRoster({ workspace: '/ws' }), fs = memFs(), store = makeSettingsStore({ fsp: fs, file: '/s.json', crewIds: roster.ids() });
  const limits = { perRunUsd: 2 }; let applied = null;
  const routes = settingsRoutes({ store, roster, providers: { 'anthropic-api': { available: false } }, limits, apply: v => { applied = v; roster.configure(v.crew); Object.assign(limits, v.limits); } });
  const call = async (method, body) => { let status, out; const res = { writeHead: s => { status = s; }, end: b => { out = JSON.parse(b); } }; await routes.find(r => r.method === method).handle({ res, body }); return { status, out }; };
  let r = await call('POST', { crew: { smith: { provider: 'anthropic-api' } } });
  assert.equal(r.status, 400); assert.match(r.out.error, /No Anthropic API key/);
  r = await call('POST', { crew: { smith: { model: 'claude-haiku-5-5' } }, limits: { perRunUsd: 1 } });
  assert.equal(r.status, 200);
  assert.equal(roster.get('smith').model, 'claude-haiku-5-5'); assert.equal(limits.perRunUsd, 1);
  assert.equal(r.out.effective.crew.find(c => c.id === 'smith').model, 'claude-haiku-5-5');
  r = await call('GET');
  assert.equal(r.out.options.providers.find(p => p.id === 'anthropic-api').available, false);
});

// ---------- recovery after a crash ----------
test('after a crash: unfinished jobs are closed, the Job log is replayed, and history keeps its order', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-m5r-'));
  const jdir = path.join(dir, 'runs'); await fsp.mkdir(jdir, { recursive: true });
  const ev = (runId, seq, type, extra = {}) => JSON.stringify({ v: 1, type, ts: 1000 + seq, seq, runId, agentId: 'smith', ...extra }) + '\n';
  // a finished job, and one that was waiting for permission when the computer shut down (plus a torn last line)
  await fsp.writeFile(path.join(jdir, 'run_done.ndjson'), ev('run_done', 0, 'run.start', { trigger: 'user', provider: 'claude-code', model: 'm' }) + ev('run_done', 1, 'run.end', { reason: 'done', usd: 0, tokens: 1, turns: 1 }));
  await fsp.writeFile(path.join(jdir, 'run_cut.ndjson'), ev('run_cut', 0, 'run.start', { trigger: 'user', provider: 'claude-code', model: 'm' }) + ev('run_cut', 1, 'permission.prompt', { promptId: 'p', callId: 'c', tool: 'shell.exec', capability: 'shell', scope: 'execute', summary: '$ ls', outsideWorkspace: false }) + '{"v":1,"type":"agent.tok');
  let now = 9_000_000; const clock = { now: () => now++ };
  const journal = makeJournal({ fsp, dir: jdir, flushMs: 5 }); await journal.init();
  const ledger = makeLedger({ fsp, file: path.join(dir, 'ledger.ndjson') });
  const bus = makeBus({ clock, journal });
  const host = makeRunHost({ bus, providers: {}, registry: makeRegistry([]), consent: {}, ledger, roster: makeRoster({ workspace: '/ws' }), journal, clock, newId: p => p, newToken: () => 't', mcpUrl: () => '', limits: { perRunUsd: 2, maxConcurrent: 2 } });
  assert.deepEqual(await host.recover(), ['run_cut']);
  await journal.flush();
  const cut = await journal.read('run_cut');
  assert.deepEqual(cut.map(e => e.type), ['run.start', 'permission.prompt', 'run.error', 'run.end'], 'closed after the torn line, with the job marked as interrupted');
  assert.equal((await ledger.rows())[0].settled, false);
  bus.seed(await journal.history(30));
  const replay = bus.recent();
  assert.ok(replay.some(e => e.runId === 'run_done' && e.type === 'run.end') && replay.some(e => e.runId === 'run_cut' && e.type === 'run.end'));
  for (let i = 1; i < replay.length; i++) assert.ok(replay[i - 1].ts <= replay[i].ts, 'history is in time order');
});
