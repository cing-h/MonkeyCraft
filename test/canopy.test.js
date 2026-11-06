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
