import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeInterview, checkNotes, INTERVIEW, INTERVIEW_TASK } from '../src/crew/interview.js';
import { makeBrain } from '../src/brain/vault.js';
import { parseNote } from '../src/brain/notes.js';
import { makeRegistry } from '../src/tools/registry.js';
import { makeConsentBroker } from '../src/safety/consent.js';
import { makeRoster } from '../src/crew/roster.js';
import { makeBus } from '../src/bus.js';
import { makeJournal } from '../src/store/journal.js';
import { makeLedger } from '../src/money/ledger.js';
import { makeRunHost } from '../src/runs.js';
import { validateEvent } from '../src/events.js';

async function world() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-iv-'));
  let now = Date.UTC(2026, 10, 7, 15), n = 0;
  const clock = { now: () => now }, newId = p => `${p}_${++n}`;
  const brain = makeBrain({ fsp, root, clock, newId }); await brain.init();
  const timers = [];
  const events = [], started = [];
  let endRun;
  const runs = {
    start: opts => { started.push(opts); const done = new Promise(r => { endRun = r; }); return { runId: 'run_iv', done }; },
    emitTo: (runId, type, p) => { events.push({ runId, type, ...p }); return true; },
    emitAfter: async (runId, type, p) => { events.push({ runId, type, after: true, ...p }); return true; },
    cancel: id => { events.push({ type: 'cancelled', id }); return true; }
  };
  const iv = makeInterview({ runs, brain, clock, newId, setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimer: t => { t.cleared = true; } });
  const tool = name => iv.tools.find(t => t.name === name);
  const ask = (question, runId = 'run_iv') => tool('sage.ask').run({ question }, { runId });
  const draft = (notes, runId = 'run_iv') => tool('sage.draft_profile').run({ notes }, { runId });
  return { root, brain, iv, ask, draft, events, started, timers, advance: ms => { now += ms; }, end: () => endRun({ reason: 'done' }), runs };
}
const flush = () => new Promise(r => setImmediate(r));

test('interview: ask → answer → skip → finish → draft → approve writes You/ notes, nothing earlier', async () => {
  const w = await world();
  const s = w.iv.start();
  assert.equal(s.runId, 'run_iv');
  assert.deepEqual({ agentId: w.started[0].agentId, source: w.started[0].source, private: w.started[0].private }, { agentId: 'sage', source: 'interview', private: true });
  assert.match(w.started[0].prompt, /most important questions first/);
  assert.match(w.iv.start().error, /already going/);

  const a1 = w.ask('What are you working towards this year?');
  await flush();
  let v = w.iv.view();
  assert.equal(v.active, true); assert.equal(v.waiting, true); assert.equal(v.secondsLeft, 600);
  assert.equal(v.turns[0].q, 'What are you working towards this year?');
  assert.match(w.iv.answer({ text: '   ' }).error, /Type an answer/);
  w.iv.answer({ text: 'Ship MonkeyCraft Edition 2 and build Shub.' });
  assert.equal((await a1).content, 'Ship MonkeyCraft Edition 2 and build Shub.');
  const a2 = w.ask('How do you like updates?'); await flush();
  w.iv.answer({ skip: true });
  assert.match((await a2).content, /skipped/);
  assert.match(w.iv.answer({ text: 'late' }).error, /isn't waiting/);
  const a3 = w.ask('Anything the crew should never do?'); await flush();
  w.iv.finish();
  assert.match((await a3).content, /wants to finish/);
  assert.match((await w.ask('One more?')).content, /wants to finish/);

  assert.deepEqual((await w.brain.list({ area: 'You' })).notes, [], 'nothing saved during the interview');
  const d = await w.draft([{ title: 'Goals', text: 'The user is shipping MonkeyCraft Edition 2 and building Shub.' }, { title: 'Who the user is', text: 'The user directs; Claude writes the code.' }]);
  assert.match(d.content, /Nothing is saved until they approve/);
  assert.equal(w.iv.view().status, 'drafted');
  assert.deepEqual((await w.brain.list({ area: 'You' })).notes, []);
  assert.match((await w.draft([{ title: 'Again', text: 'x' }])).content, /only works once/);
  w.end(); await flush();
  assert.equal(w.iv.view().status, 'drafted', 'the draft outlives the job');

  // the user edits one note and leaves the other out
  const r = await w.iv.approve({ notes: [{ title: 'Goals', text: 'The user is shipping Edition 2 first, then Shub.' }] });
  assert.deepEqual(r, { saved: ['You/Goals.md'], failed: [] });
  const note = parseNote(await fsp.readFile(path.join(w.root, 'You/Goals.md'), 'utf8'));
  assert.equal(note.body, 'The user is shipping Edition 2 first, then Shub.\n');
  assert.equal(note.meta.kind, 'profile'); assert.equal(note.meta.source_job, 'run_iv');
  assert.equal((await w.brain.history()).changes[0].by, 'sage');
  assert.deepEqual(w.iv.view(), { active: false }, 'the conversation is dropped from memory');
  const states = w.events.filter(e => e.type === 'sage.interview').map(e => e.state);
  assert.deepEqual(states, ['started', 'asked', 'answered', 'asked', 'skipped', 'asked', 'drafted', 'approved']);
  assert.ok(w.events.some(e => e.type === 'brain.write' && e.path === 'You/Goals.md' && e.op === 'create'));
  // events carry counts and states only: no question or answer text
  for (const e of w.events) { assert.doesNotMatch(JSON.stringify(e), /Shub|MonkeyCraft|updates/); if (e.type === 'sage.interview') assert.ok(validateEvent({ v: 1, ts: 1, seq: 0, agentId: 'sage', ...Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'after')) }).ok); }
  // and it can be run again later
  assert.equal(w.iv.start().runId, 'run_iv');
});

test('interview: the ten-minute clock, the unanswered question, and the backstop', async () => {
  const w = await world();
  w.iv.start();
  const backstop = w.timers[0];
  assert.equal(backstop.ms, (INTERVIEW.minutes + INTERVIEW.graceMinutes) * 60_000);
  const a = w.ask('First?'); await flush();
  w.advance(9 * 60_000 + 20_000);
  w.iv.answer({ text: 'yes' });
  assert.match((await a).content, /^yes\n\n\[About 40 seconds left\.\]/);
  const b = w.ask('Second?'); await flush();
  w.advance(5 * 60_000);
  w.timers.at(-1).fn();   // the question's own timer: the user never answered
  assert.match((await b).content, /time is up and the user didn't answer/);
  assert.match((await w.ask('Third?')).content, /^Time is up/);
  backstop.fn();
  assert.ok(w.events.some(e => e.type === 'cancelled' && e.id === 'run_iv'), 'a Sage that never wraps up is stopped');
  w.end(); await flush();
  assert.equal(w.iv.view().status, 'ended');
  assert.deepEqual(w.iv.view().turns, [], 'no draft: nothing is kept');
});

test('interview: tools only work in the interview job; drafts are checked; locks and discards hold', async () => {
  const w = await world();
  assert.match((await w.ask('Hi?', 'run_other')).content, /only works during the user's interview/);
  w.iv.start();
  assert.match((await w.ask('Hi?', 'run_other')).content, /only works/);
  for (const [notes, re] of [[[], /at least one/], [[{ title: '', text: 'x' }], /usable title/], [[{ title: 'A', text: '' }], /empty/],
    [[{ title: 'A', text: 'x' }, { title: 'a', text: 'y' }], /two notes/], [[{ title: 'Keys', text: 'password: hunter22' }], /password or key/], [Array(9).fill(0).map((_, i) => ({ title: `N${i}`, text: 'x' })), /at most/]])
    assert.match(checkNotes(notes).error, re);
  // the user locked their Goals note: approving can't change it
  await w.brain.write({ rel: 'You/Goals.md', meta: { locked: true }, body: 'Mine.\n', by: 'user' });
  await w.draft([{ title: 'Goals', text: 'Something else.' }, { title: 'Style', text: 'Short answers.' }]);
  const r = await w.iv.approve();
  assert.deepEqual(r.saved, ['You/Style.md']);
  assert.match(r.failed[0].error, /locked/);
  assert.match(await fsp.readFile(path.join(w.root, 'You/Goals.md'), 'utf8'), /Mine\./);
  // discard keeps nothing
  w.iv.start(); await w.draft([{ title: 'Temp', text: 'x' }]);
  assert.match(w.iv.start().error, /approve or discard/);
  assert.deepEqual(await w.iv.discard(), { ok: true });
  assert.equal((await w.brain.read({ rel: 'You/Temp.md' })).error, 'no such note');
  assert.ok(INTERVIEW_TASK.includes('no topic is off-limits'));
});

test('privacy: private jobs never emit their words, and private tools never show their arguments', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-iv-run-'));
  let n = 0; const clock = { now: () => 1000 + n }, newId = p => `${p}_${++n}`;
  const journal = makeJournal({ fsp, dir: path.join(dir, 'runs'), flushMs: 5 }); await journal.init();
  const bus = makeBus({ clock, journal }), seen = []; bus.subscribe(e => seen.push(e));
  const roster = makeRoster({ workspace: '/ws' });
  const secretTool = { name: 'sage.ask', capability: 'interview', scope: 'read', privateArgs: true, description: 'd', inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] }, run: async () => ({ content: 'my private answer', summary: 'the user answered' }) };
  let runs;
  const provider = { run: async ({ emit, tools }) => {
    emit('agent.token', { text: 'You told me about your family…' });
    emit('agent.reasoning', { text: 'thinking about the family' });
    const r = await tools.callTool('sage_ask', { question: 'Tell me about your family?' });
    assert.equal(r.content, 'my private answer', 'the Sage still gets the answer');
    return { reason: 'done', usd: 0, tokens: 1, turns: 1, billing: 'subscription' };
  } };
  runs = makeRunHost({ bus, providers: { 'claude-code': provider }, registry: makeRegistry([secretTool]), consent: makeConsentBroker({ newId }), ledger: makeLedger({ fsp, file: path.join(dir, 'l.ndjson') }), roster, journal, clock, newId, newToken: () => 'tok', mcpUrl: id => id, limits: { perRunUsd: 2, maxConcurrent: 2 } });
  const { runId, done } = runs.start({ agentId: 'sage', prompt: 'interview', source: 'interview', private: true });
  await done; await journal.flush();
  const onDisk = await fsp.readFile(path.join(dir, 'runs', `${runId}.ndjson`), 'utf8');
  assert.doesNotMatch(onDisk, /family|private answer/);
  assert.deepEqual(seen.find(e => e.type === 'agent.tool_call').args, { private: true });
  assert.ok(!seen.some(e => e.type === 'agent.token' || e.type === 'agent.reasoning'));
  // emitAfter adds to a job that has ended, after its last event
  await runs.emitAfter(runId, 'sage.interview', { state: 'approved', asked: 3 });
  const evs = await journal.read(runId);
  assert.equal(evs.at(-1).type, 'sage.interview'); assert.equal(evs.at(-1).seq, evs.at(-2).seq + 1);
});
