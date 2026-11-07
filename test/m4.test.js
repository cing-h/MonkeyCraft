// M4 Crew: the Chief delegates; workers get only their own tools; the family
// shares one spending pool; STOP and cancel reach workers; stuck workers are
// stopped; the Scout's web tools; the Archivist's, Writer's and Inspector's tools.
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
import { makeCrewTools } from '../src/crew/orchestrate.js';
import { makeWebFetch, isPrivateAddress, htmlToText } from '../src/tools/web-fetch.js';
import { makeFsEdit } from '../src/tools/fs-edit.js';
import { makeFsMove } from '../src/tools/fs-move.js';
import { makeFsWrite } from '../src/tools/fs-write.js';
import { isVerifyCommand, makeVerifyRun } from '../src/tools/verify-run.js';
import { makeUndoStore } from '../src/store/undo.js';
import { hardlineRules, checkPath } from '../src/safety/paths.js';
import { makeStreamParser } from '../src/providers/stream-json.js';
import { buildArgs } from '../src/providers/claude-code.js';
import { validateEvent } from '../src/events.js';

// ---------- a whole crew with fake minds ----------
// Each creature's "mind" is a function that gets { call(tool, args), onUsage, onTaint, signal, prompt } and returns its final report.
async function crewWorld(minds, limits = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-m4-'));
  let n = 0, now = 1_000_000;
  const clock = { now: () => now, advance: ms => { now += ms; } };
  const newId = p => `${p}_${++n}`;
  const journal = makeJournal({ fsp, dir: path.join(dir, 'runs'), flushMs: 5 }); await journal.init();
  const ledger = makeLedger({ fsp, file: path.join(dir, 'ledger.ndjson') });
  const bus = makeBus({ clock, journal }), seen = []; bus.subscribe(e => seen.push(e));
  const roster = makeRoster({ workspace: '/ws' });
  const fake = (name, scope, extra = {}) => ({ name, scope, capability: 'x', description: name, inputSchema: { type: 'object', properties: { q: { type: 'string' } }, additionalProperties: false }, run: async a => ({ content: `${name}:${a.q}` }), ...extra });
  const registry = makeRegistry([...makeCrewTools({ roster }), fake('fs.read', 'read'), fake('web.fetch', 'read', { taints: true }), fake('fs.write', 'write'), fake('fs.edit', 'write'), fake('fs.move', 'write'), fake('shell.exec', 'execute'), fake('verify.run', 'execute')]);
  const consent = makeConsentBroker({ newId, grants: makeGrantStore({ fsp: memFs(), file: '/g', clock }) });
  const toolsSeen = {};
  let host;
  const provider = { run: async ({ agent, prompt, mcpConfig, onUsage, onTaint, signal }) => {
    const url = mcpConfig.mcpServers.monkeycraft.url, token = mcpConfig.mcpServers.monkeycraft.headers.Authorization.slice(7);
    const ctx = host.mcpContext(url.split('/').pop(), token);
    toolsSeen[agent.id] = ctx.listTools().map(t => t.name);
    const mind = minds[agent.id] || (async () => 'nothing to do');
    try {
      const text = await mind({ call: (t, a) => ctx.callTool(t, a), onUsage, onTaint, signal, prompt });
      return signal.aborted ? { reason: signal.reason === 'halt' ? 'halted' : ['budget', 'stale'].includes(signal.reason) ? signal.reason : 'cancelled', usd: 0, tokens: 0, turns: 1, billing: 'subscription', text: '' }
        : { reason: 'done', usd: 0.25, tokens: 100, turns: 2, billing: 'subscription', text };
    } catch (e) { return { reason: 'error', usd: 0, tokens: 0, turns: 0, billing: 'subscription', text: e.message }; }
  } };
  host = makeRunHost({ bus, providers: { 'claude-code': provider }, registry, consent, ledger, roster, journal, clock, newId, newToken: () => 'tok' + (++n), mcpUrl: id => `http://x/mcp/${id}`,
    limits: { perRunUsd: 2, perRunTokens: 1e9, dailyUsd: 25, familyUsd: 5, familyTokens: 10_000, maxConcurrent: 2, maxWorkers: 2, ...limits } });
  await host.init();
  return { host, seen, toolsSeen, clock, ledger, consent };
}
const stopped = signal => (signal.aborted ? Promise.resolve() : new Promise(r => signal.addEventListener('abort', r, { once: true })));
const until = (cond, ms = 2000) => new Promise((res, rej) => { const t0 = Date.now(); const tick = () => cond() ? res() : Date.now() - t0 > ms ? rej(new Error('timed out')) : setTimeout(tick, 5); tick(); });

test('the Chief splits "research X and write a summary file" between the Scout and the Writer', async () => {
  let writerTask = '';
  const w = await crewWorld({
    chief: async ({ call }) => {
      const research = await call('crew_dispatch', { worker: 'scout', task: 'Find the tallest tree species.' });
      assert.match(research.content, /Coast redwood/);
      assert.match(research.content, /read web content/, 'the Chief is told the report came from the web');
      const written = await call('crew_dispatch', { worker: 'writer', task: `Write tallest-trees.txt from these findings: ${research.content.split('--- report ---')[1].trim()}` });
      assert.match(written.content, /finished: done/);
      return 'Done: the summary is in tallest-trees.txt.';
    },
    scout: async ({ call, onTaint }) => { onTaint('web.search'); await call('web_fetch', { q: 'https://example.org/trees' }); return 'The tallest tree species is the Coast redwood (Sequoia sempervirens), up to 116 m.'; },
    writer: async ({ call, prompt }) => { writerTask = prompt; const r = await call('fs_write', { q: 'tallest-trees.txt' }); assert.equal(r.ok, true, 'the Writer is not locked by the Scout\'s web reading'); return 'Wrote tallest-trees.txt.'; }
  });
  w.consent.respond = w.consent.respond.bind(w.consent);
  const job = w.host.start({ agentId: 'chief', prompt: 'Research the tallest trees and write a summary file.' });
  // answer the Writer's permission prompt when it appears
  await until(() => w.seen.some(e => e.type === 'permission.prompt'));
  w.consent.respond(w.seen.find(e => e.type === 'permission.prompt').promptId, 'allow_once');
  const res = await job.done;
  assert.equal(res.reason, 'done');
  assert.match(writerTask, /Coast redwood/, 'the findings were passed on in the task');
  assert.match(writerTask, /^The Chief has given you this task/, 'workers know they are working for the Chief');
  const lead = job.runId, starts = w.seen.filter(e => e.type === 'run.start');
  assert.deepEqual(starts.map(e => [e.agentId, e.trigger, e.parentRunId || null]), [['chief', 'user', null], ['scout', 'crew', lead], ['writer', 'crew', lead]]);
  assert.deepEqual(w.seen.filter(e => e.type === 'crew.dispatch' && e.runId === lead).map(e => e.workerId), ['scout', 'writer']);
  assert.deepEqual(w.seen.filter(e => e.type === 'crew.worker_end').map(e => [e.workerId, e.reason, e.usd]), [['scout', 'done', 0.25], ['writer', 'done', 0.25]]);
  assert.ok(w.seen.some(e => e.type === 'taint.set' && e.agentId === 'scout'));
  assert.ok(!w.seen.some(e => e.type === 'taint.set' && e.agentId !== 'scout'), 'the lockout stays on the Scout');
  assert.deepEqual(w.toolsSeen.scout, ['web_fetch'], 'a worker sees only its own tools');
  assert.deepEqual(w.toolsSeen.writer.sort(), ['fs_edit', 'fs_read', 'fs_write']);
  assert.deepEqual(w.toolsSeen.chief.sort(), ['crew_dispatch', 'crew_spawn', 'crew_status', 'crew_wait', 'fs_read']);
  const rows = await w.ledger.rows();
  assert.deepEqual(rows.map(r => r.agentId).sort(), ['chief', 'scout', 'writer'], 'every member has a ledger row');
  for (const e of w.seen) assert.ok(validateEvent(e).ok, `${e.type}: ${validateEvent(e).errors}`);
});

test('two at once with spawn + wait; a third is refused, and so is a busy crew member', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const w = await crewWorld({
    chief: async ({ call }) => {
      const a = await call('crew_spawn', { worker: 'scout', task: 'a' }), b = await call('crew_spawn', { worker: 'smith', task: 'b' });
      assert.match(a.content, /Started scout/); assert.match(b.content, /Started smith/);
      const c = await call('crew_spawn', { worker: 'writer', task: 'c' });
      assert.match(c.content, /2 crew members are already working/);
      const status = await call('crew_status', {});
      assert.match(status.content, /scout \(The Scout\): busy/); assert.match(status.content, /writer \(The Writer\): free/);
      release();
      const ids = [a, b].map(r => r.content.match(/job (run_\w+)/)[1]);
      const all = await call('crew_wait', { jobs: ids });
      assert.match(all.content, /scout .* finished: done/); assert.match(all.content, /smith .* finished: done/);
      return 'ok';
    },
    scout: async () => { await gate; return 'a done'; },
    smith: async () => { await gate; return 'b done'; }
  });
  assert.equal((await w.host.start({ agentId: 'chief', prompt: 'two things' }).done).reason, 'done');
});

test('the family shares one spending pool: going over stops the lead and every worker', async () => {
  const w = await crewWorld({
    chief: async ({ call, onUsage }) => { onUsage({ input: 4000 }); return (await call('crew_dispatch', { worker: 'smith', task: 'big' })).content; },
    smith: async ({ onUsage, signal }) => { onUsage({ input: 7000 }); await stopped(signal); return ''; }
  });
  const res = await w.host.start({ agentId: 'chief', prompt: 'expensive' }).done;
  const fam = w.seen.filter(e => e.type === 'budget.threshold' && e.scope === 'family');
  assert.deepEqual(fam.map(e => e.hard), [false, true]);
  assert.equal(w.seen.find(e => e.type === 'crew.worker_end').reason, 'budget');
  assert.equal(res.reason, 'budget', 'the lead stops too');
});

test('STOP and cancelling the lead reach its workers', async () => {
  const waiter = async ({ signal }) => { await stopped(signal); return ''; };
  const w = await crewWorld({ chief: async ({ call }) => (await call('crew_dispatch', { worker: 'archivist', task: 'sort files' })).content, archivist: waiter });
  const job = w.host.start({ agentId: 'chief', prompt: 'sort my files' });
  await until(() => w.seen.some(e => e.type === 'run.start' && e.agentId === 'archivist'));
  w.host.halt('user');
  assert.equal((await job.done).reason, 'halted');
  assert.equal(w.seen.find(e => e.type === 'crew.worker_end').reason, 'halted');
  const w2 = await crewWorld({ chief: async ({ call }) => (await call('crew_dispatch', { worker: 'inspector', task: 'check' })).content, inspector: waiter });
  const job2 = w2.host.start({ agentId: 'chief', prompt: 'check things' });
  await until(() => w2.seen.some(e => e.type === 'run.start' && e.agentId === 'inspector'));
  w2.host.cancel(job2.runId);
  await job2.done;
  assert.equal(w2.seen.find(e => e.type === 'crew.worker_end').reason, 'cancelled');
});

test('liveness: a worker with no progress is stopped as stale (longer while a tool is running)', async () => {
  let toolGate;
  const stuck = async ({ signal }) => { await stopped(signal); return ''; };
  const w = await crewWorld({
    chief: async ({ call }) => { const a = await call('crew_spawn', { worker: 'smith', task: 'x' }), b = await call('crew_spawn', { worker: 'writer', task: 'y' }); return (await call('crew_wait', { jobs: [a, b].map(r => r.content.match(/job (run_\w+)/)[1]) })).content; },
    smith: stuck,
    writer: async ({ call, signal }) => { call('fs_read', { q: 'slow' }); await stopped(signal); return ''; }
  });
  const job = w.host.start({ agentId: 'chief', prompt: 'p' });
  await until(() => w.seen.filter(e => e.type === 'run.start').length === 3);
  // the writer's fs.read finished instantly, so make it look like a tool is still open
  const writerRun = w.seen.find(e => e.type === 'run.start' && e.agentId === 'writer').runId;
  w.clock.advance(451_000);
  const stale = w.host.checkLiveness();
  assert.equal(stale.length, 2, 'both idle workers are stale after 450 s');
  await job.done;
  assert.ok(w.seen.some(e => e.type === 'breaker.trip' && e.kind === 'no_progress'));
  assert.ok(w.seen.filter(e => e.type === 'crew.worker_end').every(e => e.reason === 'stale'));
  void writerRun; void toolGate;
});

test('liveness gives a worker with a running tool 1,200 s', async () => {
  let finish;
  const w = await crewWorld({
    chief: async ({ call }) => (await call('crew_dispatch', { worker: 'smith', task: 'x' })).content,
    smith: async ({ call, signal }) => { call('shell_exec', { q: 'long build' }); await stopped(signal); return ''; }
  });
  const job = w.host.start({ agentId: 'chief', prompt: 'p' });
  await until(() => w.seen.some(e => e.type === 'permission.prompt'));   // the command is waiting for the user: a tool is open
  w.clock.advance(600_000);
  assert.deepEqual(w.host.checkLiveness(), [], 'not stale yet: a tool is running');
  w.clock.advance(601_000);
  assert.equal(w.host.checkLiveness().length, 1);
  await job.done; void finish;
});

// ---------- the Scout's tools ----------
test('web.fetch: only public addresses, at every redirect; HTML becomes text; it taints the job', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
  const dns = { 'example.org': [{ address: '93.184.216.34' }], 'evil.test': [{ address: '93.184.216.35' }, { address: '127.0.0.1' }], 'redir.test': [{ address: '93.184.216.36' }] };
  const lookup = async h => { if (!dns[h]) throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); return dns[h]; };
  const page = (status, body, headers = {}) => new Response(body, { status, headers });
  const fetchImpl = async url => url.startsWith('http://redir.test') ? page(302, '', { location: 'http://127.0.0.1:8787/api/runs' })
    : page(200, '<html><head><title>Trees</title><script>steal()</script></head><body><h1>Redwoods</h1><p>Up to 116&nbsp;m &amp; more.</p></body></html>', { 'content-type': 'text/html; charset=utf-8' });
  const tool = makeWebFetch({ fetchImpl, lookup });
  assert.equal(tool.taints, true); assert.equal(tool.scope, 'read');
  const reg = makeRegistry([tool]); const events = []; let n = 0;
  const ctx = { emit: (t, p) => events.push({ type: t, ...p }), newId: p => `${p}_${++n}`, grants: new Set(['web.fetch']), interactive: true, runId: 'r', consent: { request: async () => true }, taint: (await import('../src/safety/taint.js')).makeTaint() };
  const ok = await reg.dispatch({ tool: 'web.fetch', args: { url: 'https://example.org/trees' } }, ctx);
  assert.match(ok.content, /Title: Trees/); assert.match(ok.content, /Up to 116 m & more\./); assert.doesNotMatch(ok.content, /steal/);
  assert.ok(events.some(e => e.type === 'taint.set'));
  for (const url of ['http://localhost:8787/api/runs', 'http://127.0.0.1/', 'http://[::1]/', 'http://evil.test/', 'http://169.254.169.254/latest/meta-data']) {
    const r = await reg.dispatch({ tool: 'web.fetch', args: { url } }, ctx);
    assert.equal(r.isError, true, url);
  }
  assert.match((await reg.dispatch({ tool: 'web.fetch', args: { url: 'http://redir.test/' } }, ctx)).content, /redirected somewhere that can't be read/);
  assert.match((await reg.dispatch({ tool: 'web.fetch', args: { url: 'file:///etc/passwd' } }, ctx)).content, /only http and https/);
  assert.equal(htmlToText('<p>a</p><p>b</p>'), 'a\nb');
});

test('the Scout\'s own web search is reported from the stream, and Claude Code is allowed only that built-in', () => {
  const p = makeStreamParser();
  const call = p.feed({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'ws1', name: 'WebSearch', input: { query: 'tallest tree' } }, { type: 'tool_use', id: 'mc1', name: 'mcp__monkeycraft__web_fetch', input: {} }] } });
  assert.deepEqual(call.filter(a => a.kind === 'builtin_call'), [{ kind: 'builtin_call', id: 'ws1', name: 'WebSearch', input: { query: 'tallest tree' } }]);
  assert.equal(p.feed({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'ws1', name: 'WebSearch', input: {} }] } }).length, 0, 'reported once');
  const res = p.feed({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'ws1', content: 'Coast redwood…' }] } });
  assert.deepEqual([res[0].kind, res[0].name, res[0].isError], ['builtin_result', 'WebSearch', false]);
  assert.deepEqual(p.openBuiltins(), []);
  const roster = makeRoster({ workspace: '/ws' });
  const a = buildArgs({ agent: roster.get('scout'), mcpConfig: {}, maxBudgetUsd: 1 });
  assert.equal(a[a.indexOf('--tools') + 1], 'WebSearch'); assert.equal(a[a.indexOf('--allowedTools') + 1], 'mcp__monkeycraft,WebSearch');
  const s = buildArgs({ agent: roster.get('smith'), mcpConfig: {}, maxBudgetUsd: 1 });
  assert.equal(s[s.indexOf('--tools') + 1], '', 'no built-ins for anyone else');
});

test('roster: the working crew is awake with the planned tools; the Sage and Bell-ringer sleep', () => {
  const r = makeRoster({ workspace: '/ws' });
  const brainTools = ['brain.note', 'brain.read', 'brain.search'];   // Edition 2: every awake ape has the Brain
  for (const id of r.ids().filter(i => r.get(i).awake)) assert.deepEqual([...r.get(id).grantSet].filter(t => t.startsWith('brain.')).sort(), brainTools, id);
  const g = id => [...r.get(id).grantSet].filter(t => !t.startsWith('brain.')).sort();
  assert.deepEqual(g('chief'), ['claude.ask', 'claude.check', 'crew.dispatch', 'crew.spawn', 'crew.status', 'crew.wait', 'fs.read']);
  assert.deepEqual(g('scout'), ['web.fetch']);
  assert.deepEqual(g('smith'), ['fs.read', 'fs.write', 'shell.exec']);
  assert.deepEqual(g('archivist'), ['fs.move', 'fs.read', 'fs.write']);
  assert.deepEqual(g('writer'), ['fs.edit', 'fs.read', 'fs.write']);
  assert.deepEqual(g('inspector'), ['fs.read', 'verify.run']);
  assert.equal(r.get('sage').awake, false); assert.equal(r.get('ringer').awake, false);
  assert.deepEqual(r.ids().filter(i => r.get(i).network), ['scout'], 'only the Scout can reach the web');
});

// ---------- the Archivist's, Writer's and Inspector's tools ----------
async function fileWorld() {
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-m4f-')));
  const home = path.join(root, 'home'), ws = path.join(home, 'MonkeyCraftWorkspace'), dataDir = path.join(root, 'data');
  for (const d of [ws, dataDir, path.join(home, '.ssh')]) await fsp.mkdir(d, { recursive: true });
  const pathEnv = { home, workspace: ws, dataDir, rules: hardlineRules({ home, dataDir }), realpath: p => fsp.realpath(p) };
  let n = 0; const newId = p => `${p}_${++n}`;
  const undo = makeUndoStore({ fsp, dir: path.join(dataDir, 'undo'), newId, clock: { now: () => 1 } });
  const reg = makeRegistry([makeFsEdit({ fsp, pathEnv, undo }), makeFsMove({ fsp, pathEnv, undo }), makeFsWrite({ fsp, pathEnv, undo })]);
  const ctx = { emit: () => {}, newId, grants: new Set(['fs.edit', 'fs.move', 'fs.write']), interactive: true, runId: 'run_f1', consent: { request: async () => true } };
  const guard = async p => { const c = await checkPath(p, pathEnv); return c.error || c.hardline || null; };
  return { ws, home, undo, call: (tool, args) => reg.dispatch({ tool, args }, ctx), guard };
}

test('fs.edit replaces text that appears exactly once, refuses cut-off text, and can be reverted', async () => {
  const w = await fileWorld(), f = path.join(w.ws, 'letter.txt');
  await fsp.writeFile(f, 'Dear Sam,\nThanks for the bananas.\nBest, Chief');
  assert.match((await w.call('fs.edit', { path: 'letter.txt', old: 'a', new: 'b', newChars: 1 })).content, /appears \d+ times/);
  assert.match((await w.call('fs.edit', { path: 'letter.txt', old: 'bananas', new: 'mangoes', newChars: 3 })).content, /cut off/);
  assert.equal((await w.call('fs.edit', { path: 'letter.txt', old: 'bananas', new: 'mangoes', newChars: 7 })).ok, true);
  assert.match(await fsp.readFile(f, 'utf8'), /Thanks for the mangoes\./);
  await w.undo.revert('run_f1', { guard: w.guard });
  assert.match(await fsp.readFile(f, 'utf8'), /Thanks for the bananas\./);
});

test('fs.move never overwrites, refuses hardlined ends, and Revert moves things back', async () => {
  const w = await fileWorld();
  await fsp.writeFile(path.join(w.ws, 'a.txt'), 'A'); await fsp.writeFile(path.join(w.ws, 'b.txt'), 'B'); await fsp.mkdir(path.join(w.ws, 'archive'));
  assert.match((await w.call('fs.move', { from: 'a.txt', to: 'b.txt' })).content, /already exists/);
  assert.match((await w.call('fs.move', { from: 'a.txt', to: '~/.ssh/a.txt' })).content, /safety rule/);
  assert.match((await w.call('fs.move', { from: '.', to: 'x' })).content, /safety rule/);
  assert.equal((await w.call('fs.move', { from: 'a.txt', to: 'archive/a-2026.txt' })).ok, true);
  await assert.rejects(fsp.stat(path.join(w.ws, 'a.txt')));
  const res = await w.undo.revert('run_f1', { guard: w.guard });
  assert.equal(res[0].result, 'moved back');
  assert.equal(await fsp.readFile(path.join(w.ws, 'a.txt'), 'utf8'), 'A');
});

test('verify.run accepts test and check commands only, with no shell punctuation', async () => {
  for (const c of ['npm test', 'npm run lint', 'node --test', 'node --check src/a.js', 'pytest -q tests', 'python -m pytest', 'cargo test', 'go test ./...', 'make test', 'npx vitest run']) assert.equal(isVerifyCommand(c), true, c);
  for (const c of ['rm -rf /', 'npm test; rm -rf ~', 'npm test && curl x', 'pytest | sh', 'npm run build > out', 'node -e "x"', 'npm install evil', 'make', 'echo $HOME', 'npm test `id`']) assert.equal(isVerifyCommand(c), false, c);
  const shell = { name: 'shell.exec', scope: 'execute', capability: 'shell', inputSchema: { type: 'object', properties: { command: { type: 'string' } } }, assess: async a => ({ summary: `$ ${a.command}`, cacheKey: `shell:/ws:${a.command}`, facts: {} }), run: async () => ({ content: 'ok' }) };
  const v = makeVerifyRun({ shell });
  assert.equal(v.name, 'verify.run'); assert.equal(v.scope, 'execute', 'it still asks the user');
  assert.equal((await v.assess({ command: 'npm test' })).cacheKey, 'verify:/ws:npm test');
  assert.match((await v.assess({ command: 'npm test; rm -rf ~' })).error, /isn't a recognised test/);
});
