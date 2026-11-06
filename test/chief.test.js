// Final-changes item 6: the Chief roams. Rest poses on his platform often, walks rarely, and a job always comes first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeChiefIdle, REST_POSES, TIMING, LADDER_X } from '../ui/station/ape/chief.js';
import { makeStation, CREW_IDS } from '../ui/station/ape/scene.js';
import { PERCH_Y } from '../ui/station/ape/world.js';

const seeded = (s = 7) => () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;

function run(reduced, hours = 3) {
  const b = makeChiefIdle({ rnd: seeded(), reduced }), rests = [], walks = [];
  let lastPose = null, sameTwice = 0;
  for (let t = 0; t < hours * 3600; t += 0.05) {
    const a = b.step(0.05); if (!a) continue;
    if (a.kind === 'rest') { if (a.pose === lastPose) sameTwice++; lastPose = a.pose; rests.push({ t, ...a }); }
    else { lastPose = null; walks.push({ t, ...a }); }
  }
  return { rests, walks, sameTwice };
}
const gaps = ts => ts.slice(1).map((t, i) => t - ts[i]);

test('he changes rest pose every 20–60 s, walks every 4–8 minutes, and never repeats a pose', () => {
  const { rests, walks, sameTwice } = run(false);
  assert.equal(sameTwice, 0, 'each change is a new pose');
  assert.deepEqual([...new Set(rests.map(r => r.pose))].sort(), [...REST_POSES].sort(), 'all four rest poses get used');
  // between two pose changes with no walk in between, the gap is 20–60 s
  const restGaps = gaps(rests.map(r => r.t)).filter((g, i) => !walks.some(w => w.t > rests[i].t && w.t < rests[i + 1].t));
  assert.ok(restGaps.every(g => g >= 19.9 && g <= 60.1), `rest gaps in range (${Math.min(...restGaps)}–${Math.max(...restGaps)})`);
  const walkGaps = gaps(walks.map(w => w.t));
  assert.ok(walkGaps.every(g => g >= 240 && g <= 480.1), 'walks are 4–8 minutes apart');
  assert.ok(rests.length > walks.length * 4, 'he shifts pose far more often than he walks');
  assert.ok(Math.min(...walkGaps) > 6 * 10, 'he walks far less often than the crew, who set off every 2–6 s');
  for (const r of rests) assert.ok(r.pose === 'lean' ? r.x === 461 : (r.x >= 414 && r.x <= 452) || (r.x >= 497 && r.x <= 524), 'rest spots are on the platform');
});

test('reduced motion: fewer, slower changes', () => {
  const n = run(false), r = run(true);
  assert.ok(r.rests.length < n.rests.length * 0.75 && r.walks.length < n.walks.length * 0.6);
  assert.ok(TIMING.reduced.blend > TIMING.normal.blend, 'poses blend more slowly');
});

const fakeCanvas = () => { const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }; return { getContext: () => ctx, getBoundingClientRect: () => ({ width: 1280, height: 720 }) }; };

test('the Chief walks down the ladder and back, and a job sends him straight home at every stage of a walk', () => {
  const modes = Object.fromEntries(CREW_IDS.map(k => [k, 'asleep'])); modes.chief = 'idle';
  const st = makeStation(fakeCanvas(), { modeOf: id => modes[id] }), a = st._actors.chief, brain = st._chiefIdle;
  const real = brain.step.bind(brain);
  const walkNow = () => { let once = true; brain.step = dt => once ? (once = false, { kind: 'walk', x: 300, linger: 6 }) : real(dt); };
  const until = (cond, secs) => { for (let i = 0; i < secs * 20; i++) { st.step(0, 0.05); if (cond()) return true; } return false; };
  const homeCheck = label => {
    modes.chief = 'working';
    let pose = false;
    const ok = until(() => { if (REST_POSES.includes(a.anim)) pose = true; return a.inside; }, 40);
    assert.ok(ok, `${label}: he got home and went inside`);
    assert.equal(pose, false, `${label}: no lying about while a job is on`);
    assert.equal(a.lane, 'perch'); assert.equal(a.x, 446);
    modes.chief = 'idle'; st.step(0, 0.05);
  };

  // a whole walk: down the ladder, along the ground, look round, back up
  walkNow();
  assert.ok(until(() => a.anim === 'climb', 30), 'he heads for the ladder and climbs');
  assert.equal(a.x, LADDER_X);
  assert.ok(until(() => a.lane === 'ground' && a.anim !== 'climb', 30), 'down on the ground');
  assert.ok(until(() => a.anim === 'look', 30), 'he stops for a look round');
  assert.ok(until(() => a.lane === 'perch' && !a.legs.length, 60), 'and climbs back up to his platform');
  assert.ok(until(() => REST_POSES.includes(a.anim) && a.blend >= 1, 30), 'then settles into a rest pose');

  homeCheck('resting on the platform');
  walkNow(); assert.ok(until(() => a.anim === 'climb' && a.climbY > PERCH_Y + 10, 30)); homeCheck('halfway down the ladder');
  walkNow(); assert.ok(until(() => a.lane === 'ground' && a.anim === 'walk', 40)); homeCheck('out on the village path');
});
