// Final-changes item 5, part 2c: the council at the Ring.
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
import { makeCouncil, makeCouncilTools, parsePoints, COUNCIL } from '../src/crew/council.js';
import { makeEvent } from '../src/events.js';

async function world(minds, { now = Date.now() } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-council-'));
  let n = 0, t = now;
  const clock = { now: () => t, set: v => { t = v; } };
  const newId = p => `${p}_${++n}`;
  const journal = makeJournal({ fsp, dir: path.join(dir, 'runs'), flushMs: 5 }); await journal.init();
  const ledger = makeLedger({ fsp, file: path.join(dir, 'ledger.ndjson') });
  const bus = makeBus({ clock, journal }), seen = []; bus.subscribe(e => seen.push(e));
  const roster = makeRoster({ workspace: '/ws' });
  let council = null;
  const fake = (name, scope) => ({ name, scope, capability: 'x', description: name, inputSchema: { type: 'object', properties: { q: { type: 'string' } }, additionalProperties: false }, run: async a => ({ content: `${name}:${a.q}` }) });
  const registry = makeRegistry([...makeCrewTools({ roster }), ...makeCouncilTools({ roster, clock, councils: { get: id => council?.councils.get(id) } }), fake('fs.read', 'read'), fake('fs.write', 'write'), fake('shell.exec', 'execute'), fake('web.fetch', 'read'), fake('fs.edit', 'write'), fake('fs.move', 'write'), fake('verify.run', 'execute')]);
  const consent = makeConsentBroker({ newId, grants: makeGrantStore({ fsp: memFs(), file: '/g', clock }) });
  const agents = [];
  let host;
  const provider = { run: async ({ agent, prompt, mcpConfig, signal }) => {
    const url = mcpConfig.mcpServers.monkeycraft.url, token = mcpConfig.mcpServers.monkeycraft.headers.Authorization.slice(7);
    const ctx = host.mcpContext(url.split('/').pop(), token);
    agents.push({ id: agent.id, model: agent.model, grants: [...agent.grantSet], builtins: agent.builtinTools || [], tools: ctx.listTools().map(x => x.name), prompt });
    const mind = minds[agent.id] || (async () => 'ok');
    try { const text = await mind({ call: (x, a) => ctx.callTool(x, a), prompt, agent }); return { reason: 'done', usd: 0.01, tokens: 10, turns: 1, billing: 'subscription', text }; }
    catch (e) { return { reason: 'error', usd: 0, tokens: 0, turns: 0, billing: 'subscription', text: e.message }; }
  } };
  host = makeRunHost({ bus, providers: { 'claude-code': provider }, registry, consent, ledger, roster, journal, clock, newId, newToken: () => 'tok' + (++n), mcpUrl: id => `http://x/mcp/${id}`,
    limits: { perRunUsd: 2, perRunTokens: 1e9, dailyUsd: 25, familyUsd: 5, familyTokens: 1e9, maxConcurrent: 2, maxWorkers: 2 } });
  await host.init();
  const fs = memFs();
  council = makeCouncil({ fsp: fs, file: '/council.json', clock, runs: host, roster, ledger, journal });
  await council.load();
  return { host, seen, council, agents, clock, journal, fs };
}
const isCouncil = p => /Hold the council/.test(p);
const chiefHolds = (members, significant) => async ({ call, prompt }) => {
  if (!isCouncil(prompt)) { await call('crew_dispatch', { worker: 'writer', task: 'Write a poem about mangoes.' }); return 'The Writer wrote a mango poem in poem.txt.'; }
  for (const m of members) await call('council_hear', { member: m });
  await call('council_report', { significant, report: significant ? 'The Smith keeps hitting the same failing test; worth a look.' : 'All routine.' });
  return 'Goodbye.';
};

test('parsePoints reads all the members\' marked points, and keeps unmarked replies as one routine point', () => {
  assert.deepEqual(parsePoints('SIGNIFICANT: The tests keep failing.\n- ROUTINE: Nice poem.\nchit-chat'), [{ significant: true, point: 'The tests keep failing.' }, { significant: false, point: 'Nice poem.' }]);
  assert.deepEqual(parsePoints('**Significant**: bold works too'), [{ significant: true, point: 'bold works too' }]);
  assert.deepEqual(parsePoints('just talking'), [{ significant: false, point: 'just talking' }]);
  assert.equal(parsePoints(Array(9).fill('ROUTINE: x').join('\n')).length, 9, 'no cap on how many points');
});

test('a council: the Chief hears members who have no tools at all, their points become events, and the significant report reaches the user', async () => {
  const w = await world({
    chief: chiefHolds(['smith', 'writer'], true),
    smith: async ({ call, prompt }) => { const r = await call('fs_write', { q: 'sneaky' }); assert.ok(r.isError, 'a council member cannot use tools'); assert.match(prompt, /mango poem|mangoes/); return 'SIGNIFICANT: The same test failed three times.\nROUTINE: The forge is warm.'; },
    writer: async () => 'ROUTINE: I liked writing the poem.'
  });
  await w.host.start({ agentId: 'chief', prompt: 'Write a poem about mangoes.' }).done;
  const c = await w.council.call({ trigger: 'user' });
  assert.ok(c.runId, c.error); await c.done; assert.equal(c.jobs, 1, 'the digest has the one job since the last council');
  const start = w.seen.find(e => e.type === 'run.start' && e.runId === c.runId);
  assert.equal(start.source, 'council'); assert.equal(start.trigger, 'user');
  const chief = w.agents.find(a => a.id === 'chief' && isCouncil(a.prompt));
  assert.deepEqual(chief.tools.sort(), ['council_hear', 'council_report'], 'at a council the Chief can only hear and report');
  for (const m of ['smith', 'writer']) {
    const a = w.agents.findLast(x => x.id === m);   // the council member, not the Writer's earlier poem job
    assert.deepEqual([a.tools, a.grants, a.builtins], [[], [], []], `${m} has no tools`); assert.equal(a.model, COUNCIL.memberModel);
    assert.ok(w.seen.findLast(e => e.type === 'run.start' && e.agentId === m).parentRunId === c.runId, 'members speak inside the council job');
  }
  const says = w.seen.filter(e => e.type === 'council.say');
  assert.deepEqual(says.map(e => [e.memberId, e.significant]), [['smith', true], ['smith', false], ['writer', false]]);
  const rep = w.seen.find(e => e.type === 'council.report');
  assert.equal(rep.significant, true); assert.match(rep.report, /failing test/);
  assert.ok(makeEvent('council.say', { memberId: 'smith', point: 'x', significant: true }, { runId: 'r', agentId: 'chief', seq: 0, ts: 1 }).ok);
  assert.ok(makeEvent('council.report', { significant: false, report: 'x' }, { runId: 'r', agentId: 'chief', seq: 0, ts: 1 }).ok);
  assert.ok((await w.council.status()).lastTs, 'it remembers when it met');
  assert.equal((await w.council.status()).jobsSince, 0, 'and starts counting again');
});

test('nothing significant: the report says so, and it reports only once', async () => {
  let second;
  const w = await world({ chief: async ({ call }) => { await call('council_hear', { member: 'inspector' }); await call('council_report', { significant: false, report: 'All routine.' }); second = await call('council_report', { significant: true, report: 'again' }); return 'bye'; }, inspector: async () => 'ROUTINE: Nothing to add.' });
  const c = await w.council.call(); await c.done;
  const reps = w.seen.filter(e => e.type === 'council.report');
  assert.equal(reps.length, 1); assert.equal(reps[0].significant, false); assert.ok(second.isError);
  const again = await w.council.call(); assert.equal(again.error, undefined, 'once it has ended, another can be called'); await again.done;
  assert.ok(c.runId);
});

test('the daily council: only after 3 finished jobs, at most once a day, and never while something is running', async () => {
  const day = new Date(2026, 10, 6, 9, 0, 0).getTime();
  const w = await world({ chief: chiefHolds(['writer'], false) }, { now: day });
  assert.equal(await w.council.tick(), null, 'no jobs yet');
  for (let i = 0; i < 2; i++) { w.clock.set(w.clock.now() + 1000); await w.host.start({ agentId: 'chief', prompt: `job ${i}` }).done; }
  assert.equal(await w.council.tick(), null, 'two jobs are not enough');
  w.clock.set(w.clock.now() + 1000);
  await w.host.start({ agentId: 'chief', prompt: 'job 3' }).done;
  const origActive = w.host.active; w.host.active = () => [{ runId: 'x' }];
  assert.equal(await w.council.tick(), null, 'not while a job is running');
  w.host.active = origActive;
  const first = await w.council.tick();
  assert.ok(first?.runId, 'enough jobs, nothing running: the council meets');
  const st = w.seen.find(e => e.type === 'run.start' && e.runId === first.runId); assert.equal(st.trigger, 'schedule');
  await first.done;
  for (let i = 0; i < 3; i++) { w.clock.set(w.clock.now() + 1000); await w.host.start({ agentId: 'chief', prompt: `more ${i}` }).done; }
  assert.equal(await w.council.tick(), null, 'only once a day');
  w.clock.set(day + 26 * 3600 * 1000);
  const next = await w.council.tick(); assert.ok(next?.runId, 'the next day it can meet again'); await next.done;
});

test('the digest leaves out crew tasks and earlier councils, and the council remembers across a restart', async () => {
  const w = await world({ chief: chiefHolds(['writer'], false) });
  await w.host.start({ agentId: 'chief', prompt: 'Write a poem about mangoes.' }).done;
  const c = await w.council.call(); await c.done;
  const prompt = w.agents.find(a => a.id === 'chief' && isCouncil(a.prompt)).prompt;
  assert.match(prompt, /1 job\)/); assert.match(prompt, /Write a poem about mangoes/); assert.match(prompt, /Crew sent: The Writer \(done\)/);
  const again = makeCouncil({ fsp: w.fs, file: '/council.json', clock: w.clock, runs: w.host, roster: makeRoster({ workspace: '/ws' }), ledger: { rows: async () => [] }, journal: w.journal });
  await again.load(); assert.ok((await again.status()).lastTs, 'remembered after a restart');
  assert.ok(c.runId);
});

test('no cap but the meeting\'s time: members hear what was said so far, follow-ups are allowed, and when time is up the Chief is asked for his verdict', async () => {
  let w, late, prompts = {};
  w = await world({
    chief: async ({ call }) => {
      await call('council_hear', { member: 'smith' });
      await call('council_hear', { member: 'writer' });
      await call('council_hear', { member: 'smith', question: 'Do you agree with the Writer?' });   // a follow-up: hearing someone again is fine
      w.clock.set(w.clock.now() + COUNCIL.meetingMs + 1000);
      late = await call('council_hear', { member: 'inspector' });
      await call('council_report', { significant: false, report: 'Routine.' });
      return 'bye';
    },
    smith: async ({ prompt }) => { (prompts.smith ||= []).push(prompt); return Array.from({ length: 7 }, (_, i) => `ROUTINE: point ${i + 1}`).join('\n'); },
    writer: async ({ prompt }) => { prompts.writer = prompt; return 'SIGNIFICANT: I disagree with point 3.'; }
  });
  const c = await w.council.call(); await c.done;
  assert.equal(w.seen.filter(e => e.type === 'council.say' && e.memberId === 'smith').length, 14, 'all seven points, twice: no cap on how much is said');
  assert.match(prompts.writer, /What has been said at the council so far:[\s\S]*The Smith \(routine\): point 7/, 'the Writer hears what the Smith said');
  assert.match(prompts.smith[1], /The Chief asks you: Do you agree with the Writer\?[\s\S]*/); assert.match(prompts.smith[1], /The Writer \(significant\): I disagree/);
  assert.match(prompts.smith[0], /no limit on how much you may say|minutes? of the meeting are left/);
  assert.ok(late.isError && /time is up/.test(late.content), 'after the meeting time, no more hearing: give the verdict');
  assert.ok(w.agents.find(a => a.id === 'chief' && isCouncil(a.prompt)).prompt.includes('the only limit is the meeting\'s time, about 3 minutes'), 'the default meeting is 3 minutes');
  assert.equal(COUNCIL.meetingMs, 3 * 60_000);
});

test('the user chooses how long a meeting lasts; the length is checked', async () => {
  const w = await world({ chief: async ({ call }) => { await call('council_report', { significant: false, report: 'ok' }); return 'bye'; } });
  for (const bad of [0, 61, 2.5, 'ten']) assert.match((await w.council.call({ minutes: bad })).error, /1 to 60 minutes/);
  const c = await w.council.call({ minutes: 10 }); assert.equal(c.minutes, 10); await c.done;
  assert.match(w.agents.find(a => a.id === 'chief').prompt, /about 10 minutes/);
});
