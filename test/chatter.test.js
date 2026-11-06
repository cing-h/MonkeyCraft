// Village chatter is scenery, and it stays truthful.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeChatter } from '../ui/station/ape/chatter.js';
import { CONVERSATIONS, EVENT_LINES, SLEEP_SOUNDS, SOUNDS } from '../ui/station/ape/chatter-lines.js';
import { makeStation, CREW_IDS } from '../ui/station/ape/scene.js';

const seeded = (s = 3) => () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
const crew = (k, mode, x, y = 100) => ({ ref: `crew:${k}`, kind: 'crew', species: k, mode, x, y });
const vill = (i, k, x, y = 60) => ({ ref: `v:${i}`, kind: 'villager', species: k, mode: 'idle', x, y });
function run(ch, speakers, seconds, onStep = () => {}) {
  const said = [];
  for (let t = 0; t < seconds; t += 0.05) { const bs = ch.step(0.05, { speakers: typeof speakers === 'function' ? speakers(t) : speakers }); for (const b of bs) if (b.age === 0.05 || b.age < 0.051) said.push(b); onStep(bs, t); }
  return said;
}
const workLine = m => Object.values(EVENT_LINES).flat().some(l => new RegExp('^' + l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{name\\}', '.+') + '$').test(m));

test('a busy crew member never speaks; free ones and villagers do', () => {
  const ch = makeChatter({ rnd: seeded() });
  const said = run(ch, [crew('smith', 'working', 100), crew('writer', 'asking', 120), crew('scout', 'idle', 140), vill(0, 'smith', 150), vill(1, 'writer', 180)], 400);
  assert.ok(said.length > 10, `chatter happened (${said.length} lines)`);
  assert.ok(!said.some(b => b.ref === 'crew:smith' || b.ref === 'crew:writer'), 'busy crew stay quiet');
  assert.ok(said.some(b => b.ref === 'crew:scout'), 'the free crew member chats');
  assert.ok(said.every(b => SOUNDS[b.ref.startsWith('crew:') ? b.ref.slice(5) : (b.ref === 'v:0' ? 'smith' : 'writer')].includes(b.sound)), 'each speaks in its own species\' sounds');
});

test('two villagers near each other hold a conversation, taking turns', () => {
  const ch = makeChatter({ rnd: seeded(9) });
  const said = run(ch, [vill(0, 'scout', 100), vill(1, 'archivist', 130)], 300);
  const convo = CONVERSATIONS.find(c => c.includes(said[0].meaning) || c[0] === said[0].meaning);
  assert.ok(convo, 'lines come from a written conversation');
  for (let i = 1; i < said.length && i < 3; i++) if (convo.includes(said[i].meaning) && convo.indexOf(said[i].meaning) === convo.indexOf(said[i - 1].meaning) + 1) assert.notEqual(said[i].ref, said[i - 1].ref, 'they take turns');
  assert.ok(!said.some(b => workLine(b.meaning)), 'no work talk without a real event');
});

test('lines about work only follow a real event, from someone else, while it is fresh', () => {
  const ch = makeChatter({ rnd: seeded(5) });
  const speakers = [crew('smith', 'idle', 100), crew('scout', 'idle', 200), vill(0, 'writer', 150)];
  assert.ok(!run(ch, speakers, 200).some(b => workLine(b.meaning)), 'nothing about work before any event');
  ch.notify({ type: 'job_done', agentId: 'smith', name: 'The Smith' });
  const after = run(ch, speakers, 7);
  const remark = after.find(b => workLine(b.meaning));
  assert.ok(remark && /The Smith/.test(remark.meaning), 'someone remarks on the finished job');
  assert.notEqual(remark.ref, 'crew:smith', 'not the Smith itself');
  ch.notify({ type: 'asking', agentId: 'smith', name: 'The Smith' });
  const ask = run(ch, [crew('smith', 'asking', 100), crew('scout', 'idle', 120), vill(0, 'writer', 250)], 7).find(b => workLine(b.meaning));
  assert.ok(ask && ask.ref === 'v:0', 'only someone well away from the asker mentions the question, so bubbles never pile up on it');
});

test('never more than two bubbles; sleepers only sleep-talk; a bubble ends as soon as its speaker gets busy', () => {
  const ch = makeChatter({ rnd: seeded(11) });
  let max = 0;
  run(ch, [vill(0, 'scout', 50), vill(1, 'smith', 70), vill(2, 'writer', 90), vill(3, 'archivist', 110), crew('sage', 'asleep', 200)], 600, bs => { max = Math.max(max, bs.length); });
  assert.ok(max <= 2, `at most two at once (${max})`);
  const ch2 = makeChatter({ rnd: seeded(2) });
  const sleepy = run(ch2, [crew('sage', 'asleep', 160), crew('ringer', 'asleep', 220)], 400);
  assert.ok(sleepy.length > 0 && sleepy.every(b => SLEEP_SOUNDS.includes(b.sound)), 'sleepers only mumble in their sleep');
  const ch3 = makeChatter({ rnd: seeded(4) });
  let mode = 'idle', cutAt = null, speakingAt = null;
  run(ch3, () => [crew('scout', mode, 150)], 120, (bs, t) => {
    if (speakingAt === null && bs.some(b => b.ref === 'crew:scout')) { speakingAt = t; mode = 'working'; }
    else if (speakingAt !== null && cutAt === null && !bs.some(b => b.ref === 'crew:scout')) cutAt = t;
  });
  assert.ok(speakingAt !== null && cutAt !== null && cutAt - speakingAt < 0.11, 'the bubble disappears the moment the Scout gets a job');
});

test('the village produces chatter bubbles placed over the speakers\' heads', () => {
  const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
  const cv = { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
  const modes = Object.fromEntries(CREW_IDS.map(k => [k, 'idle'])); modes.sage = 'asleep'; modes.ringer = 'asleep';
  const st = makeStation(cv, { modeOf: id => modes[id] });
  let seen = null;
  for (let i = 0; i < 4000 && !seen; i++) { st.step(0, 0.05); const c = st.chatter(); if (c.length) seen = c[0]; }
  assert.ok(seen, 'someone said something');
  assert.ok(seen.x > 0 && seen.x < 1280 && seen.y > 0 && seen.y < 720 && seen.sound && seen.meaning, 'placed on the canvas, with a sound and a meaning');
  const quiet = makeStation(cv, { modeOf: () => 'working', reduced: true });
  for (let i = 0; i < 600; i++) quiet.step(0, 0.05);
  assert.deepEqual(quiet.chatter(), [], 'no chatter when reduced motion is asked for');
});

test('every written conversation and mutter is well-formed (a missing comma in the list would silently break one)', async () => {
  const { CONVERSATIONS, MUTTERS } = await import('../ui/station/ape/chatter-lines.js');
  for (const c of CONVERSATIONS) { assert.ok(Array.isArray(c) && c.length >= 2 && c.length <= 4, JSON.stringify(c)); for (const l of c) assert.equal(typeof l, 'string'); }
  for (const m of MUTTERS) assert.equal(typeof m, 'string');
});
