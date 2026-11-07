// Village revamp, phase 3: climbing as primates really climb. Grips are pinned to the bark (no sliding),
// going up uses a diagonal sequence with three limbs gripping, and going down is slower and led by a foot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES, CREW, P, fk, climbSpeed, climbRise, CLIMB_STYLE } from '../ui/station/ape/cast.js';

const TAU = Math.PI * 2;
// world position of each hand and foot while the body climbs at its own speed (pelvis rises speed px/s)
function track(k, down, steps = 400) {
  const sp = SPECIES[k], f = sp.cl.freq, v = climbSpeed(sp), out = [];
  for (let i = 0; i < steps; i++) {
    const t = i / steps * (TAU / f), p = f * t, q = P.climb(sp, p, down), j = fk(sp, q), py = (down ? 1 : -1) * v * t;
    out.push({ u: p / TAU, ends: [j.arms[0][1], j.arms[1][1], j.legs[0][1], j.legs[1][1]].map(e => [e[0], e[1] + py]), q });
  }
  return out;
}
const gripping = (sp, u, off, down) => { let x = ((u + off) % 1 + 1) % 1; if (down) x = 1 - x; return x < sp.cl.duty; };

test('climbing: every gripping hand stays put on the bark (within a pixel) while the body climbs past it', () => {
  for (const k of CREW) for (const down of [false, true]) {
    const sp = SPECIES[k], order = down ? sp.cl.down : sp.cl.up, fr = track(k, down);
    const limbs = sp.cl.tuck ? [0, 1] : [0, 1, 2, 3];
    for (const L of limbs) {
      let run = [];
      const check = () => { if (run.length > 4) { const ys = run.map(e => e[1]), xs = run.map(e => e[0]); assert.ok(Math.max(...ys) - Math.min(...ys) < 1.2 && Math.max(...xs) - Math.min(...xs) < 1.2, `${k} ${down ? 'down' : 'up'} limb ${L} slides ${(Math.max(...ys) - Math.min(...ys)).toFixed(2)} px`); } run = []; };
      for (const fm of fr) { if (gripping(sp, fm.u, order[L], down)) run.push(fm.ends[L]); else check(); }
      check();
    }
  }
});

test('climbing up is a diagonal sequence: a hand moves with the opposite foot, and three limbs always grip', () => {
  const s = CLIMB_STYLE.ape;
  // near hand 0 and far foot (index 3) are a quarter-cycle apart; far hand and near foot likewise
  assert.equal(Math.abs(s.up[0] - s.up[3]) % 0.5, 0.25);
  for (let u = 0; u < 1; u += 0.01) {
    const free = s.up.filter(off => { const x = ((u + off) % 1 + 1) % 1; return x >= s.duty; }).length;
    assert.ok(free <= 1, `at u=${u.toFixed(2)} ${free} limbs are off the bark`);
  }
  // going down the foot leads: the near foot reaches before the near hand
  assert.ok(s.down[2] < s.down[0]);
});

test('each species climbs at its own pace: the gibbon fastest, the gorilla among the slowest; down is slower', () => {
  const v = Object.fromEntries(CREW.map(k => [k, climbSpeed(SPECIES[k])]));
  assert.equal(Object.entries(v).sort((a, b) => b[1] - a[1])[0][0], 'scout');
  assert.ok(v.chief < v.smith && v.archivist < v.smith);
  for (const k of CREW) assert.ok(climbRise(SPECIES[k]) > 0 && v[k] > 4 && v[k] < 25, `${k} ${v[k]}`);
  const head = (k, d) => P.climb(SPECIES[k], 0, d).head;
  assert.ok(head('smith', true) > head('smith', false), 'looks down on the way down');
  assert.equal(P.climb(SPECIES.chief, 1).climb, true, 'props are put away while climbing');
});
