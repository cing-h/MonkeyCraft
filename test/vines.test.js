// Village revamp, phase 4: long vines with air time and flips (ui/station/ape/vines.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VINES, VINE_STYLE, makeVineRider, makeVineSway, vineChain, floorY } from '../ui/station/ape/vines.js';
import { makeStation, CREW_IDS } from '../ui/station/ape/scene.js';
import { SPECIES, fk } from '../ui/station/ape/cast.js';

const TAU = Math.PI * 2;
const rng = (seed = 7) => () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
// ride one run along a story, recording what happened
function ride(key, lane, { s = 1, flips = true, reduced = false, seed = 7 } = {}) {
  const chain = vineChain(key, s, lane, 20, 940), sway = makeVineSway(), rnd = rng(seed);
  const r = makeVineRider({ key, s, chain, x: VINES[chain[0]].x - 14, dir: 1, sway, rnd, flips, reduced });
  const log = { chain, events: [], jumps: [], spins: [], minClear: Infinity, flights: 0 };
  let prev = r.mid();
  for (let t = 0; t < 40 && !r.done(); t += 0.02) {
    const ev = r.step(0.02), m = r.mid();
    if (ev) log.events.push(ev);
    if (ev === 'release') { log.flights++; log.spins.push({ turns: r.turns, max: r.maxSpin }); }
    if (ev === 'catch' || ev === 'land') log.spins.push({ at: ev, spin: r.spin });
    log.jumps.push(Math.hypot(m[0] - prev[0], m[1] - prev[1])); prev = m;
    if (r.phase === 'swing') { const p = r.pose(), k = fk(SPECIES[key], p.q); for (const f of [k.legs[0][1], k.legs[1][1]]) { const fx = p.px + f[0] * s, fy = p.py + f[1] * s; log.minClear = Math.min(log.minClear, floorY(lane, fx) - fy); } }
    sway.step(0.02, t);
  }
  log.done = r.done(); log.rider = r;
  return log;
}

test('vines: only the swingers ride them, and the Chief and the monkeys walk', () => {
  for (const k of ['chief', 'inspector', 'sage', 'ringer']) assert.deepEqual(vineChain(k, 1, 'ground', 20, 940), []);
  for (const k of Object.keys(VINE_STYLE)) assert.ok(vineChain(k, 1, 'c2', 20, 940).length > 0, `${k} has a vine run on Canopy 2`);
  assert.deepEqual(vineChain('scout', 1, 'ground', 300, 360), [], 'short trips walk');
});

test('vines: every swinger finishes a run on every story, catching each vine in turn and landing on the floor', () => {
  for (const key of Object.keys(VINE_STYLE)) for (const lane of ['ground', 'c1', 'c2']) for (const s of [1, 0.8]) {
    const l = ride(key, lane, { s });
    assert.ok(l.done, `${key} on ${lane} finishes`);
    assert.equal(l.events.at(-1), 'land');
    assert.equal(l.events.filter(e => e === 'catch').length, l.chain.length, `${key} on ${lane} catches each vine`);
    assert.ok(Math.max(...l.jumps) < 4.5, `${key} on ${lane}: the body never jumps (${Math.max(...l.jumps).toFixed(2)} px in a frame)`);
    assert.ok(l.minClear > 0, `${key} on ${lane}: the hanging feet clear the floor`);
  }
});

test('flips: a somersault starts only when whole turns fit the flight, and is always finished by the catch or landing', () => {
  let flipped = 0;
  for (const key of Object.keys(VINE_STYLE)) for (const lane of ['ground', 'c1', 'c2']) for (const seed of [1, 2, 3]) {
    const l = ride(key, lane, { seed });
    for (const sp of l.spins) {
      if ('turns' in sp) { if (sp.turns) flipped++; assert.ok(sp.max <= VINE_STYLE[key].spin + 1e-9, `${key} spins at ${sp.max.toFixed(1)} rad/s`); }
      else assert.ok(Math.abs(sp.spin % TAU) < 1e-6, `${key} ${sp.at}s mid-turn (${sp.spin})`);
    }
    if (key === 'archivist') assert.equal(l.spins.filter(s => s.turns).length, 0, 'the orangutan never flips');
  }
  assert.ok(flipped > 5, `flips happen on long flights (${flipped})`);
  for (const key of Object.keys(VINE_STYLE)) assert.equal(ride(key, 'c1', { flips: false, reduced: true }).spins.filter(s => s.turns).length, 0, 'reduced motion: no flips');
});

test('vines: a released vine swings on by itself and settles', () => {
  const l = ride('scout', 'c1'), sway = makeVineSway();
  sway.st[l.chain[0]].w = 1.5;
  for (let i = 0; i < 50; i++) sway.step(0.02);
  assert.ok(Math.abs(sway.st[l.chain[0]].ang) > 0.05, 'it swings');
  for (let i = 0; i < 600; i++) sway.step(0.02);
  assert.ok(Math.abs(sway.st[l.chain[0]].ang) < 0.03 && Math.abs(sway.st[l.chain[0]].w) < 0.05, 'and settles');
});

test('scene: the crew ride vines while free, and a job still brings them home', () => {
  const canvas = { width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
  let busy = false;
  const st = makeStation(canvas, { modeOf: id => busy && id !== 'chief' ? 'ready' : 'idle' });
  let rides = 0, seen = new Set();
  for (let i = 0; i < 4000; i++) {
    st.step(0, 0.05);
    for (const a of [...Object.values(st._actors), ...st._folk]) if (a.vr && !seen.has(a.vr)) { seen.add(a.vr); rides++; }
    if (rides >= 2 && Object.values(st._actors).some(a => a.vr) && !busy) busy = i;
    if (busy && i > busy + 1400) break;
  }
  assert.ok(rides >= 2, `apes ride the vines (${rides})`);
  assert.ok(busy, 'a crew member was on a vine when the job arrived');
  for (const k of CREW_IDS) if (k !== 'chief') assert.ok(!st._actors[k].vr && st._actors[k].atDoor, `${k} got home`);
});
