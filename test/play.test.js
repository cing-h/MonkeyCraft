// Village revamp, phase 6: the playground (ui/station/ape/play.js) and the crew's rule for playing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAMES, makePlay, makeTag, stepTag } from '../ui/station/ape/play.js';
import { makeVineSway } from '../ui/station/ape/vines.js';
import { WATER, groundY } from '../ui/station/ape/world.js';
import { makeStation, CREW_IDS } from '../ui/station/ape/scene.js';

const TAU = Math.PI * 2;
const rng = (seed = 5) => () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
const KEYS = ['scout', 'smith', 'writer', 'inspector', 'sage', 'ringer', 'clerk', 'archivist', 'chief'];
function run(kind, key, opts = {}) {
  const p = makePlay(kind, { key, s: 1, x: GAMES[kind].x, rnd: rng(opts.seed), sway: makeVineSway(), reduced: opts.reduced, game: opts.game });
  const out = { events: [], phases: new Set(), spins: [], p };
  for (let t = 0; t < 60 && !p.done(); t += 0.05) {
    if (opts.stopAt !== undefined && t >= opts.stopAt) p.stop();
    const e = p.step(0.05); if (e) out.events.push(e); out.phases.add(p.phase);
    if (p.phase === 'squash' || p.phase === 'land') out.spins.push(p.pose().q.roll || 0);
  }
  return out;
}

test('playground: every game finishes for every ape allowed to play it', () => {
  for (const kind of ['swing', 'net', 'slide', 'toss']) for (const key of KEYS) {
    if (!GAMES[kind].ok(key)) continue;
    const r = run(kind, key);
    assert.ok(r.p.done(), `${key} finishes the ${kind}`);
  }
  assert.ok(!GAMES.swing.ok('chief') && !GAMES.net.ok('chief') && GAMES.toss.ok('chief'), 'the Chief keeps his dignity: fruit toss only');
});

test('the river swing: let go, splash into the water, swim back and climb out onto the bank', () => {
  for (const key of ['scout', 'smith', 'clerk', 'archivist']) {
    const r = run('swing', key);
    assert.ok(r.events.includes('splash'), `${key} splashes in`);
    for (const ph of ['ride', 'swim', 'climbout', 'shake']) assert.ok(r.phases.has(ph), `${key} ${ph}s`);
    assert.ok(r.p.swimY > WATER, 'it swims in the water');
    assert.ok(Math.abs(r.p.pose().at.y - groundY(r.p.x)) < 0.01, 'and ends on the bank');
  }
});

test('the net: bounces, and somersaults only whole turns that fit (never on reduced motion)', () => {
  let flips = 0;
  for (const key of ['scout', 'smith', 'inspector', 'clerk']) for (const seed of [1, 2, 3, 4]) {
    const r = run('net', key, { seed });
    assert.ok(r.events.filter(e => e === 'bounce').length >= 3, `${key} bounces`);
    for (const s of r.spins) assert.ok(Math.abs(s % TAU) < 1e-6, `${key} comes down mid-turn (${s})`);
    flips += r.p.flips;
  }
  assert.ok(flips > 3, `flips happen (${flips})`);
  assert.equal(run('net', 'scout', { reduced: true }).p.flips, 0);
  assert.equal(run('net', 'archivist').p.flips, 0, 'the orangutan just bounces');
});

test('the fruit toss goes through the hoop, and a game of tag passes "it" around', () => {
  const r = run('toss', 'sage');
  assert.equal(r.events.filter(e => e === 'throw').length, r.events.filter(e => e === 'hoop').length);
  const gm = makeTag(10), rnd = rng(3), ps = ['writer', 'smith', 'scout'].map((k, i) => makePlay('tag', { key: k, s: 0.8, x: 40 + i * 30, rnd, sway: makeVineSway(), game: gm }));
  gm.players.push(...ps); let tags = 0;
  for (let t = 0; t < 30 && !gm.over; t += 0.05) { stepTag(gm, 0.05); for (const p of ps) if (p.step(0.05) === 'tag') tags++; }
  assert.ok(gm.over && tags >= 1, `tags: ${tags}`);
});

test('a stopped game ends quickly and safely (a job has started)', () => {
  for (const kind of ['swing', 'net', 'slide', 'toss']) {
    const r = run(kind, 'smith', { stopAt: 3 });
    assert.ok(r.p.done(), `${kind} ends`);
    assert.ok(Math.abs(r.p.pose().at.y - groundY(r.p.x)) < 0.01 || r.p.phase === 'done', 'on its feet');
  }
});

test('scene: the crew play only when no job is running or waiting; villagers play any time', () => {
  const canvas = { width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
  let job = false;
  const st = makeStation(canvas, { modeOf: () => 'idle', jobsActive: () => job });
  let crewPlayed = false, folkPlayedDuringJob = false, crewPlayedDuringJob = false, stoppedAt = null;
  for (let i = 0; i < 9000; i++) {
    st.step(0, 0.05);
    const crewNow = CREW_IDS.some(k => st._actors[k].play || st._actors[k].tasks?.some(t => t.play));
    if (!job && crewNow && st._playing().length) { crewPlayed = true; if (i > 600) { job = true; stoppedAt = i; } }
    if (job) {
      if (st._folk.some(a => a.play)) folkPlayedDuringJob = true;
      if (i > stoppedAt + 400 && CREW_IDS.some(k => st._actors[k].play || st._actors[k].tasks?.some(t => t.play))) crewPlayedDuringJob = true;
      if (i > stoppedAt + 3000 && folkPlayedDuringJob) break;
    }
  }
  assert.ok(crewPlayed, 'free crew play when nothing is running');
  assert.ok(job, 'a job started while a crew member was playing');
  assert.ok(!crewPlayedDuringJob, 'the crew stop playing within 20 s and never start again while a job runs');
  assert.ok(folkPlayedDuringJob, 'villagers keep playing');
});
