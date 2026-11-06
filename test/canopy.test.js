// Final-changes item 5: the two canopy stories above the ground village.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALK, PLOTS, LADDERS, STORY_Y, TRUNKS, walkY, trunkR } from '../ui/station/ape/canopy.js';
import { STORIES, TOP, WORLD } from '../ui/station/ape/fb.js';
import { makeStation, CREW_IDS } from '../ui/station/ape/scene.js';

const fakeCanvas = () => { const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData(img) { this.last = img; } }; return { ctx, getContext: () => ctx, getBoundingClientRect: () => ({ width: 1280, height: 720 }) }; };
const station = () => { const cv = fakeCanvas(), modes = Object.fromEntries(CREW_IDS.map(k => [k, 'idle'])); return { cv, st: makeStation(cv, { modeOf: id => modes[id] }) }; };

test('the camera stays inside the three-story world, and story jumps land exactly on a story', () => {
  const { st } = station();
  assert.equal(st.cameraY(), 0, 'it opens on the ground village');
  assert.equal(st.story(), 0);
  st.scrollBy(0, -10_000); assert.equal(st.cameraY(), TOP, 'no higher than the top of Canopy 2');
  st.scrollBy(0, 10_000); assert.equal(st.cameraY(), 0, 'no lower than the ground village');
  st.scrollBy(-10_000); assert.equal(st.camera(), 0); st.scrollBy(10_000); assert.equal(st.camera(), WORLD - 320);
  for (const k of [2, 1, 0, 2]) {
    st.toStory(k); assert.equal(st.story(), k, 'the indicator shows where it is heading at once');
    for (let i = 0; i < 60; i++) st.step(0, 0.05);
    assert.equal(st.cameraY(), STORIES[k].camY, `it glides to ${STORIES[k].name} and stops there`);
  }
  st.toStory(9); for (let i = 0; i < 60; i++) st.step(0, 0.05); assert.equal(st.cameraY(), TOP, 'out-of-range jumps clamp');
  st.scrollBy(0, 50); assert.equal(st.story(), 2); st.scrollBy(0, 60); assert.equal(st.story(), 1, 'the nearest story is the one shown');
  st.focus('smith'); for (let i = 0; i < 80; i++) st.step(0, 0.05); assert.equal(st.story(), 0, 'focusing on a crew member on the ground brings the ground into view');
});

test('each canopy story has one unbroken walkway from end to end', () => {
  for (const s of [1, 2]) {
    let prev = walkY(s, 22);
    for (let x = 23; x <= WORLD - 22; x++) { const y = walkY(s, x); assert.ok(Math.abs(y - prev) < 1.5, `story ${s}: no step at x=${x}`); prev = y; }
    for (const g of WALK[s]) if (g.kind === 'bridge') { assert.ok(walkY(s, (g.x0 + g.x1) / 2) > Math.max(g.y0, g.y1), 'rope bridges sag'); assert.ok(g.x1 - g.x0 >= 20, 'each bridge spans a real gap'); }
    const ys = Array.from({ length: 80 }, (_, i) => walkY(s, 30 + i * 11));
    assert.ok(ys.every(y => y > STORY_Y[s] - 12 && y < STORY_Y[s] + 12), 'the walkway stays at its story');
    const cam = STORIES[s].camY; assert.ok(ys.every(y => y - cam > 90 && y - cam < 150), 'and sits in the lower half of that story\'s view');
  }
});

test('plots: four free bough platforms on each canopy story, clear of the trunks and each other', () => {
  assert.equal(PLOTS.length, 8);
  assert.equal(new Set(PLOTS.map(p => p.id)).size, 8, 'unique ids');
  for (const s of [1, 2]) assert.equal(PLOTS.filter(p => p.story === s).length, 4);
  for (const p of PLOTS) {
    assert.ok(p.w >= 40, 'room for a tree house');
    assert.equal(walkY(p.story, p.x), p.y, 'the plot is on the walkway');
    assert.ok(p.x - p.w / 2 > 22 && p.x + p.w / 2 < WORLD - 22);
    for (const tx of TRUNKS) assert.ok(Math.abs(p.x - tx) > p.w / 2 + trunkR(tx, p.y) + 2, `plot ${p.id} is clear of the trunk at ${tx}`);
  }
  for (const a of PLOTS) for (const b of PLOTS) if (a !== b && a.story === b.story) assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 + 40, 'plots don\'t crowd each other');
  assert.ok(PLOTS.some(p => p.story === 1), 'Canopy 1 has a plot ready for the Clerk');
});

test('ladders between the canopy stories stand on platforms at both ends', () => {
  for (const l of LADDERS) for (const s of [1, 2]) {
    const g = WALK[s].find(g => l.x >= g.x0 && l.x <= g.x1);
    assert.equal(g.kind, 'trunk', `the ladder at ${l.x} starts and ends on a platform`);
    assert.ok(Math.abs(l.x - g.tx) > trunkR(g.tx, g.y) + 4, 'beside the trunk, not inside it');
  }
});

test('every story is painted', () => {
  const { cv, st } = station();
  const colours = () => { const d = cv.ctx.last.data, set = new Set(); for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); return set.size; };
  for (const k of [0, 1, 2]) { st.toStory(k); for (let i = 0; i < 40; i++) st.step(0, 0.05); assert.ok(colours() > 400, `${STORIES[k].name} is fully painted`); }
});

// ---------- 2a: roaming between the stories ----------
import { LANES, route, nextLane, pickWander } from '../ui/station/ape/lanes.js';
import { SPECIES } from '../ui/station/ape/cast.js';

test('there is a route from every lane to every other, and walks always end where climbs begin', () => {
  for (const from of LANES) for (const to of LANES) {
    const legs = route(from, 300, to, 700);
    let lane = from;
    for (let i = 0; i < legs.length; i++) {
      const g = legs[i];
      if (g.k === 'climb') { assert.equal(g.from, lane, `${from}→${to}: a climb starts on the lane it's on`); assert.equal(legs[i - 1].k, 'move'); assert.equal(legs[i - 1].x, g.x - g.dx, 'the walk ends at the foot of the climb'); lane = g.to; }
      if (g.k === 'drop') { assert.equal(lane, 'canopy', 'only the low branch is low enough to drop from'); lane = 'ground'; }
    }
    assert.equal(lane, to, `${from}→${to} arrives`); assert.deepEqual(legs.at(-1), { k: 'move', x: 700 });
  }
  assert.equal(nextLane('c2', 'ground'), 'c1', 'Canopy 2 is reached only through Canopy 1');
});

test('wanderers visit every story; only climbers use the low branch', () => {
  let s = 3; const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  const seen = sp => { const n = {}; for (let i = 0; i < 2000; i++) { const g = pickWander(SPECIES[sp], 'ground', rnd); n[g.lane] = (n[g.lane] || 0) + 1; } return n; };
  const chimp = seen('smith'), gorilla = seen('chief');
  for (const l of ['ground', 'c1', 'c2', 'canopy']) assert.ok(chimp[l] > 50, `the chimp goes to ${l}`);
  assert.equal(gorilla.canopy, undefined, 'a gorilla never tries the low branch');
});

test('villagers roam all stories and are never busy; a job brings every crew member home from any story', () => {
  const modes = Object.fromEntries(CREW_IDS.map(k => [k, 'idle'])); modes.sage = 'asleep'; modes.ringer = 'asleep';
  const cv = fakeCanvas(), st = makeStation(cv, { modeOf: id => modes[id] });
  const lanes = new Set(), crewUp = new Set();
  for (let i = 0; i < 4000; i++) {
    st.step(0, 0.05);
    for (const f of st._folk) lanes.add(f.lane);
    for (const k of CREW_IDS) if (/^c[12]$/.test(st._actors[k].lane)) crewUp.add(k);
  }
  assert.ok(lanes.has('c1') && lanes.has('c2') && lanes.has('ground'), 'villagers live on every story');
  assert.ok(crewUp.size >= 3, 'idle crew wander up into the canopy');
  assert.ok(st._folk.every(f => f.folk && f.mode === 'idle' && f.s < 1), 'villagers are always free, and smaller than the crew');
  for (const k of CREW_IDS) if (modes[k] === 'idle') modes[k] = 'working';
  const far = CREW_IDS.filter(k => /^c[12]$/.test(st._actors[k].lane));
  let done = false;
  for (let i = 0; i < 20 * 90 && !done; i++) { st.step(0, 0.05); done = CREW_IDS.filter(k => modes[k] === 'working').every(k => st._actors[k].inside); }
  assert.ok(done, `every working crew member got home within 90 s (from the canopy: ${far.join(', ') || 'none'})`);
});

test('zoom: from the normal view out to the whole village, keeping the middle of the view where it was', () => {
  const { cv, st } = station();
  st.scrollTo(480, -64);
  assert.deepEqual(st.view(), [320, 180]); assert.equal(st.zoom(), 1);
  const mid = () => [st.camera() + st.view()[0] / 2, st.cameraY() + st.view()[1] / 2];
  const before = mid();
  st.zoomBy(1); assert.equal(st.zoom(), 1.5); assert.deepEqual(st.view(), [480, 270]);
  assert.ok(Math.abs(mid()[0] - before[0]) < 1 && Math.abs(mid()[1] - before[1]) < 1, 'zooming keeps the middle in place');
  st.zoomBy(1); st.zoomBy(1); st.zoomBy(1);
  assert.equal(st.zoom(), 3); assert.deepEqual(st.view(), [960, 540], 'the whole village fits');
  assert.deepEqual([st.camera(), st.cameraY()], [0, TOP], 'and nothing is left out');
  st.scrollBy(500, 500); assert.deepEqual([st.camera(), st.cameraY()], [0, TOP], 'no scrolling past the edges');
  st.step(0, 0.05); assert.equal(cv.ctx.last.data.length, 960 * 540 * 4, 'the canvas grows to the bigger view');
  st.toStory(0); assert.equal(st.zoom(), 1, 'a story button zooms back in'); for (let i = 0; i < 60; i++) st.step(0, 0.05); assert.equal(st.cameraY(), 0);
  st.setZoom(2); st.zoomBy(-5); assert.equal(st.zoom(), 1, 'never closer than normal'); st.setZoom(7); assert.equal(st.zoom(), 3);
});
