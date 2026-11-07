// Village revamp, phase 5: every house redone, and the Chief's great lodge (ui/station/ape/houses.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLayers, DOORS, PERCH_Y } from '../ui/station/ape/world.js';
import { LODGE } from '../ui/station/ape/houses.js';
import { CHIEF_SPOTS } from '../ui/station/ape/chief.js';
import { makeStation, CREW_IDS } from '../ui/station/ape/scene.js';

const L = buildLayers();

test('houses: every crew member has windows that light in its colour, and the Chief\'s lodge has the most', () => {
  for (const k of CREW_IDS) assert.ok(L.lights.some(l => l.key === k), `${k} has a window`);
  const chief = L.lights.filter(l => l.key === 'chief' && !l.bell && !l.chimney && !l.forge);
  assert.ok(chief.length >= 6, `the great lodge has hall, upper chamber and cupola windows (${chief.length})`);
  assert.ok(Math.min(...chief.map(l => l.y0)) < -30, 'one of them is up in the cupola');
  assert.ok(L.lights.some(l => l.key === 'smith' && l.forge) && L.lights.some(l => l.key === 'smith' && l.chimney), 'the smithy has a forge and a chimney');
});

test('houses: the stations are where they were, and the lodge leaves the Chief room to rest', () => {
  assert.equal(DOORS.chief.x, 446); assert.equal(DOORS.smith.x, 166); assert.equal(DOORS.writer.x, 398);
  for (const [lo, hi] of CHIEF_SPOTS) assert.ok(hi < LODGE.gong - 8 && lo > 400, 'his rest spots are on open planks, clear of the gong');
  assert.ok(LODGE.bannerX <= LODGE.plat1, 'the council banner stands on the platform');
  assert.equal(PERCH_Y, 34);
});

function shot(modes) {
  let img; const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData(i) { img = i; } };
  const canvas = { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
  const st = makeStation(canvas, { modeOf: id => modes[id] || 'asleep' });
  st.scrollTo(200, 60); for (let i = 0; i < 40; i++) st.step(0, 0.05); st.scrollTo(200, 60); st.redraw(0);
  const at = (x, y) => { const sx = x - st.camera(), sy = y - Math.round(st.cameraY()), o = (sy * canvas.width + sx) * 4; return img.data[o] + img.data[o + 1] + img.data[o + 2]; };
  return at;
}
test('houses: the forge roars only while the Smith is really working', () => {
  const work = shot({ smith: 'working' }), rest = shot({ smith: 'idle' });
  const glow = at => [[198, 103], [200, 104], [202, 103]].reduce((s, [x, y]) => s + at(x, y), 0);
  assert.ok(glow(work) > glow(rest) + 300, `forge mouth: ${glow(work)} working vs ${glow(rest)} idle`);
});
