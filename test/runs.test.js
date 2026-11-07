import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeBus } from '../src/bus.js';
import { makeJournal } from '../src/store/journal.js';
import { makeLedger } from '../src/money/ledger.js';
import { makeRunHost } from '../src/runs.js';
import { makeRoster } from '../src/crew/roster.js';
import { makeRegistry } from '../src/tools/registry.js';
import { makeConsentBroker } from '../src/safety/consent.js';
import { validateEvent } from '../src/events.js';

async function world(provider) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'monkeycraft-test-'));
  let n = 0, now = 1000;
  const clock = { now: () => now++ };
  const newId = p => `${p}_${++n}`;
  const journal = makeJournal({ fsp, dir: path.join(dir, 'runs'), flushMs: 5 }); await journal.init();
  const ledger = makeLedger({ fsp, file: path.join(dir, 'ledger.ndjson') });
  const bus = makeBus({ clock, journal });
  const seen = []; bus.subscribe(e => seen.push(e));
  const registry = makeRegistry([{ name: 'fs.read', scope: 'read', capability: 'files', description: 'd', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, run: async a => ({ content: `read ${a.path}` }) }]);
  const consent = makeConsentBroker({ newId });
  const runs = makeRunHost({ bus, providers: { 'claude-code': provider }, registry, consent, ledger, roster: makeRoster({ workspace: '/ws' }), journal, clock, newId, newToken: () => 'tok' + n, mcpUrl: id => `http://x/mcp/${id}`, limits: { perRunUsd: 2, maxConcurrent: 2 } });
  return { dir, journal, ledger, bus, runs, seen, clock, newId };
}

test('a job: run.start → tool via MCP context → run.end, journaled and in the ledger', async () => {
  let seenConfig;
  const provider = { run: async ({ mcpConfig, emit }) => {
    seenConfig = mcpConfig;
    emit('agent.token', { text: 'Looking…' });
    // what Claude Code would do over MCP:
    const url = mcpConfig.mcpServers.monkeycraft.url, token = mcpConfig.mcpServers.monkeycraft.headers.Authorization.slice(7);
    const ctx = w.runs.mcpContext(url.split('/').pop(), token);
    assert.deepEqual(ctx.listTools().map(t => t.name), ['fs_read']);
    const r = await ctx.callTool('fs_read', { path: 'a.txt' });
    assert.equal(r.content, 'read a.txt');
    return { reason: 'done', usd: 0.01, tokens: 500, turns: 2, billing: 'subscription' };
  } };
  const w = await world(provider);
  const { runId, done } = w.runs.start({ agentId: 'smith', prompt: 'read a.txt' });
  await done; await w.journal.flush();
  assert.equal(seenConfig.mcpServers.monkeycraft.type, 'http');
  const types = w.seen.map(e => e.type);
  assert.deepEqual(types, ['run.start', 'agent.token', 'agent.tool_call', 'agent.tool_result', 'run.end']);
  for (const e of w.seen) assert.ok(validateEvent(e).ok);
  assert.deepEqual(w.seen.map(e => e.seq), [0, 1, 2, 3, 4]);
  assert.deepEqual((await w.journal.read(runId)).map(e => e.type), types);
  const rows = await w.ledger.rows();
  assert.equal(rows.length, 1); assert.equal(rows[0].billing, 'subscription'); assert.equal(rows[0].tokens, 500);
  assert.equal(w.runs.mcpContext(runId, 'tok1'), null, 'MCP access ends with the run');
});

test('MCP context refuses a wrong token or unknown run', async () => {
  let release; const provider = { run: () => new Promise(r => { release = r; }) };
  const w = await world(provider);
  const { runId, done } = w.runs.start({ agentId: 'smith', prompt: 'x' });
  assert.equal(w.runs.mcpContext(runId, 'wrong'), null);
  assert.equal(w.runs.mcpContext('run_nope', 'tok'), null);
  release({ reason: 'done', usd: 0, tokens: 0, turns: 0, billing: 'unknown' }); await done;
});

test('start refuses sleeping crew, empty jobs, and too many at once', async () => {
  const provider = { run: () => new Promise(() => {}) };
  const w = await world(provider);
  assert.match(w.runs.start({ agentId: 'ringer', prompt: 'x' }).error, /asleep/);
  assert.match(w.runs.start({ agentId: 'ghost', prompt: 'x' }).error, /No crew member/);
  assert.match(w.runs.start({ agentId: 'smith', prompt: '  ' }).error, /Empty/);
  w.runs.start({ agentId: 'smith', prompt: 'a' }); w.runs.start({ agentId: 'smith', prompt: 'b' });
  assert.match(w.runs.start({ agentId: 'smith', prompt: 'c' }).error, /busy/);
});

test('STOP aborts running jobs and they end as halted', async () => {
  const provider = { run: ({ signal }) => new Promise(r => signal.addEventListener('abort', () => r({ reason: signal.reason === 'halt' ? 'halted' : 'cancelled', usd: 0, tokens: 0, turns: 0, billing: 'unknown' }))) };
  const w = await world(provider);
  const { done } = w.runs.start({ agentId: 'smith', prompt: 'long job' });
  assert.equal(w.runs.halt('user'), 1);
  await done;
  assert.deepEqual(w.seen.map(e => e.type), ['run.start', 'station.halt', 'run.end']);
  assert.equal(w.seen.at(-1).reason, 'halted');
});

test('crash recovery: a journal with no run.end (and a torn last line) is closed and recorded unsettled', async () => {
  const w = await world({ run: async () => ({}) });
  const file = path.join(w.dir, 'runs', 'run_crashed.ndjson');
  const ev = (seq, type, extra) => JSON.stringify({ v: 1, type, ts: 5, seq, runId: 'run_crashed', agentId: 'smith', ...extra }) + '\n';
  await fsp.writeFile(file, ev(0, 'run.start', { trigger: 'user', provider: 'claude-code', model: 'm' }) + ev(1, 'agent.token', { text: 'hi' }) + '{"v":1,"type":"agent.tok');
  assert.deepEqual(await w.runs.recover(), ['run_crashed']);
  await w.journal.flush();
  const evs = await w.journal.read('run_crashed');
  assert.deepEqual(evs.map(e => e.type), ['run.start', 'agent.token', 'run.error', 'run.end']);
  assert.deepEqual(evs.map(e => e.seq), [0, 1, 2, 3]);
  const [row] = await w.ledger.rows();
  assert.equal(row.settled, false); assert.equal(row.reason, 'interrupted');
  assert.deepEqual(await w.runs.recover(), [], 'only once');
});
