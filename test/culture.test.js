// Final-changes item 5, part 2b: the villagers' culture, trades, gatherings and the lantern ritual (scenery).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RING, TRADES, GATHER, makeGatherings } from '../ui/station/ape/culture.js';
import { trunkR } from '../ui/station/ape/canopy.js';
import { makeStation, CREW_IDS } from '../ui/station/ape/scene.js';

const seeded = (s = 5) => () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
const fakeCanvas = () => { const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData(img) { this.last = img; } }; return { ctx, getContext: () => ctx, getBoundingClientRect: () => ({ width: 1280, height: 720 }) }; };

test('gatherings: the first comes within a couple of minutes, then every 4–7 minutes, each lasting 70–100 s', () => {
  const g = makeGatherings({ rnd: seeded() }), starts = [], ends = [];
  let was = false;
  for (let t = 0; t < 3 * 3600; t += 0.05) { const on = g.step(0.05); if (on && !was) starts.push(t); if (!on && was) ends.push(t); was = on; }
  assert.ok(starts[0] >= GATHER.first[0] - 0.1 && starts[0] <= GATHER.first[1] + 0.1);
  ends.forEach((e, i) => { const d = e - starts[i]; assert.ok(d >= 69.9 && d <= 100.1, `gathering ${i} lasted ${d}`); });
  for (let i = 1; i < starts.length; i++) { const gap = starts[i] - ends[i - 1]; assert.ok(gap >= 239.9 && gap <= 420.1, `gap ${gap}`); }
  assert.ok(starts.length >= 20);
});

test('the Ring has seats either side of the great tree, a drum seat and twelve lanterns', () => {
  for (const s of RING.seats) { assert.ok(s.x > RING.x0 && s.x < RING.x1, 'on the platform'); assert.ok(Math.abs(s.x - 480) > trunkR(480, RING.y) + 4, 'not inside the trunk'); assert.equal(s.facing, s.x < 480 ? 1 : -1, 'facing the tree'); }
  assert.equal(RING.seats.filter(s => s.drum).length, 1);
  assert.equal(RING.lanterns.length, 12);
});

test('a gathering seats free crew and villagers on top of the Ring; a job calls a seated crew member away at once', () => {
  const modes = Object.fromEntries(CREW_IDS.map(k => [k, 'idle'])); modes.sage = 'asleep'; modes.ringer = 'asleep';
  const st = makeStation(fakeCanvas(), { modeOf: id => modes[id] }), all = [...Object.values(st._actors), ...st._folk];
  let seated = [];
  for (let i = 0; i < 20 * 400 && seated.length < 5; i++) { st.step(0, 0.05); seated = all.filter(a => a.tasks?.[0]?.gather && a.tasks[0].arrived); }
  assert.ok(st.gathering() && seated.length >= 5, `a gathering filled up (${seated.length} seated)`);
  for (const a of seated) { assert.equal(a.lane, 'c1'); assert.ok(['sit', 'drum'].includes(a.anim) || a.blend < 1); assert.ok(a.mode === 'idle', 'only the free come'); }
  assert.ok(all.some(a => a.anim === 'drum'), 'someone drums');
  const swinger = seated.find(a => ['scout', 'smith', 'archivist', 'writer'].includes(a.key)); if (swinger) assert.equal(swinger.top, true, 'swingers climb up to sit on the platform');
  const crew = seated.find(a => !a.folk);
  if (crew) {
    modes[crew.key] = 'working'; st.step(0, 0.05);
    assert.equal(crew.tasks, null, 'the job comes first'); assert.ok(crew.legs.at(-1)?.home, 'heading home');
    for (let i = 0; i < 20 * 90 && !crew.inside; i++) st.step(0, 0.05);
    assert.ok(crew.inside, 'and it gets home and goes inside');
  }
});

test('villagers ply their trades: work poses at their spots, and the courier carries a basket up and puts it down', () => {
  const modes = Object.fromEntries(CREW_IDS.map(k => [k, 'asleep']));
  const st = makeStation(fakeCanvas(), { modeOf: id => modes[id] });
  st._gatherings.step = () => false;   // no gatherings in this test
  const worked = new Set(), carried = { up: false, put: false };
  for (let i = 0; i < 20 * 600; i++) {
    st.step(0, 0.05);
    for (const f of st._folk) {
      const tr = TRADES[f.trade];
      if (f.anim === tr.anim && f.tasks?.[0]?.arrived && f.lane === tr.lane && Math.abs(f.x - tr.x) < 1) worked.add(f.trade);
      if (f.trade === 'courier') { if (f.carry && f.lane !== 'ground') carried.up = true; if (carried.up && !f.carry) carried.put = true; }
    }
  }
  for (const t of ['vendor', 'painter', 'carver', 'weaver']) assert.ok(worked.has(t), `the ${t} worked at its spot`);
  assert.ok(carried.up && carried.put, 'the courier took a basket up into the trees and put it down');
});

test('the lantern ritual: one lit per job today, and a finished job lights the next', () => {
  const st = makeStation(fakeCanvas(), { modeOf: () => 'idle' });
  assert.equal(st._lanterns(), 0, 'dark until the job count arrives');
  st.lanterns(5); assert.equal(st._lanterns(), 5);
  st.notify({ type: 'job_done', agentId: 'smith', name: 'The Smith' }); assert.equal(st._lanterns(), 6, 'a finished job lights the next lantern');
  st.notify({ type: 'job_failed', agentId: 'smith', name: 'The Smith' }); assert.equal(st._lanterns(), 6, 'a failed job lights none');
  st.lanterns(99); assert.equal(st._lanterns(), 12, 'there are twelve'); st.lanterns(-3); assert.equal(st._lanterns(), 0);
  st.lanterns(12); st.notify({ type: 'job_done', agentId: 'smith', name: 'The Smith' }); assert.equal(st._lanterns(), 12);
  st.scrollTo(475, -64); assert.doesNotThrow(() => st.step(0, 0.05));
});

test('a real council sends its members to their seats at the Ring, villagers come to watch, and it ends when the job does', () => {
  const modes = Object.fromEntries(CREW_IDS.map(k => [k, 'idle'])); modes.sage = 'asleep'; modes.ringer = 'asleep';
  const council = new Set();
  const st = makeStation(fakeCanvas(), { modeOf: id => modes[id], councilOf: id => council.has(id) });
  for (let i = 0; i < 200; i++) st.step(0, 0.05);
  for (const k of ['chief', 'smith', 'writer']) { modes[k] = 'ready'; council.add(k); }
  const A = st._actors;
  let ok = false;
  for (let i = 0; i < 20 * 120 && !ok; i++) { st.step(0, 0.05); ok = ['chief', 'smith', 'writer'].every(k => A[k].atSeat && A[k].lane === 'c1'); }
  assert.ok(ok, 'the members reached their seats at the Ring');
  assert.equal(st._council(), true);
  for (let i = 0; i < 20 * 3; i++) st.step(0, 0.05);
  for (const k of ['chief', 'smith', 'writer']) { assert.equal(A[k].anim, 'sit'); assert.equal(A[k].inside, false, 'not indoors'); }
  assert.equal(A.smith.top, true, 'the Smith (a swinger) sits on the platform, not under it');
  modes.smith = 'talking'; for (let i = 0; i < 20; i++) st.step(0, 0.05); assert.equal(A.smith.anim, 'talk', 'it talks while it really speaks');
  modes.chief = 'working'; for (let i = 0; i < 20; i++) st.step(0, 0.05); assert.equal(A.chief.inside, false, 'the Chief stays at the Ring while hearing a member');
  assert.ok(st._folk.some(f => f.tasks?.[0]?.audience), 'villagers come to watch');
  // the council job ends: everyone goes back to their own business
  for (const k of ['chief', 'smith', 'writer']) { modes[k] = 'idle'; council.delete(k); }
  for (let i = 0; i < 20; i++) st.step(0, 0.05);
  assert.equal(st._council(), false); assert.ok(st._folk.every(f => !f.tasks?.[0]?.audience));
  assert.ok(!A.smith.atSeat);
});
