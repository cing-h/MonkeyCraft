// The brachiation engine: real pendulum swings, ricochetal flight for fast apes,
// continuous position and speed through every catch, and hands on the holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBrachiator, stepPose, brachiatePose } from '../ui/station/ape/swing.js';
import { SPECIES, AGILE, fk } from '../ui/station/ape/cast.js';

function trip(key, from, to, seconds = 40) {
  const sp = SPECIES[key], g = AGILE[sp.canopy], fast = sp.canopy === 'brachiate-fast';
  const branchY = x => 56 + Math.sin(x / 41) * 3;
  const b = makeBrachiator({ R: (sp.ua + sp.la) * 0.9, halfPeriod: g.T, amp: g.amp, ricochet: fast, branchY, x0: from, lo: 0, hi: 1000, dir: 1 });
  b.travelTo(to);
  const dt = 0.05, out = { flights: 0, maxBody: 0, maxGripOff: 0, arrived: null, maxSpeed: 0 };
  let prev = null, rnd = (() => { let s = 7; return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296; })();
  for (let i = 0; i < seconds / dt; i++) {
    if (b.step(dt, rnd) === 'release') out.flights++;
    stepPose(b, sp, 1, dt);
    const { q, px, py } = brachiatePose(sp, b, 1, { fast }), k = fk(sp, q), hand = k.arms[b.hand][1];
    if (b.mode === 'hang') out.maxGripOff = Math.max(out.maxGripOff, Math.hypot(px + hand[0] * b.dir - b.hx, py + hand[1] - b.branchY(b.hx) - 0.6));
    const c = b.chest();
    if (prev) { const j = Math.hypot(c[0] - prev[0], c[1] - prev[1]); out.maxBody = Math.max(out.maxBody, j); out.maxSpeed = Math.max(out.maxSpeed, Math.abs(c[0] - prev[0]) / dt); }
    prev = c;
    if (out.arrived === null && b.arrived()) out.arrived = i * dt;
  }
  return { ...out, b, sp };
}

test('a gibbon flies between holds (ricochetal); an orangutan swings hand over hand', () => {
  const gib = trip('scout', 100, 700), ora = trip('archivist', 100, 400, 60);
  assert.ok(gib.flights >= 10, `the gibbon flew ${gib.flights} times`);
  assert.equal(ora.flights, 0, 'the orangutan never lets go of both hands');
  assert.ok(gib.arrived !== null && ora.arrived !== null, 'both get where they were going');
  assert.ok(gib.maxSpeed > 2 * ora.maxSpeed, 'the gibbon is much faster');
});

test('no teleporting: the body moves smoothly, and the gripping hand stays on its hold', () => {
  for (const [k, to] of [['scout', 700], ['smith', 500], ['archivist', 400], ['writer', 500]]) {
    const r = trip(k, 100, to, 40);
    assert.ok(r.maxBody <= r.maxSpeed * 0.05 * 1.6 + 0.5, `${k}: the body never jumps (max ${r.maxBody.toFixed(2)} px a frame at up to ${r.maxSpeed.toFixed(0)} px/s)`);
    assert.ok(r.maxGripOff < 1, `${k}: the holding hand stays on the branch (${r.maxGripOff.toFixed(2)} px)`);
  }
});

test('at rest, a swing dies down like a damped pendulum', () => {
  const { b } = trip('smith', 100, 400, 25);
  b.travelTo(null);
  for (let i = 0; i < 120; i++) b.step(0.05);
  assert.ok(Math.abs(b.th) < 0.05 && Math.abs(b.w) < 0.2, `settled (th ${b.th.toFixed(3)}, w ${b.w.toFixed(3)})`);
});
