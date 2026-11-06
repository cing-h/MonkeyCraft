// MonkeyCraft ape village: background villagers (scenery, never crew) that
// travel a far branch hand over hand. They use the same brachiation engine as
// the crew (swing.js). The gibbons go fast enough to fly between holds. On
// each trip a villager swings to the far end of its stretch, slows and settles
// under its last hold, rests, then turns round and goes back.

import { hash } from './fb.js';
import { AGILE, SPECIES } from './cast.js';
import { backBranchY } from './world.js';
import { makeBrachiator, stepPose, brachiatePose } from './swing.js';

export const VILLAGERS = ['scout', 'smith', 'archivist', 'writer'];

export function makeVillagers(bw) {
  return VILLAGERS.map((k, i) => {
    const sp = SPECIES[k], g = AGILE[sp.canopy], s = 0.7, span = 150 + hash(i, 10) * 90;
    const x0 = 20 + i * (bw - 40 - span) / (VILLAGERS.length - 1) + (hash(i, 11) - 0.5) * 30;
    const fast = sp.canopy === 'brachiate-fast';
    const b = makeBrachiator({ R: (sp.ua + sp.la) * s * 0.9, halfPeriod: g.T * (1.05 + hash(i, 14) * 0.25), amp: g.amp * (0.9 + hash(i, 13) * 0.2), ricochet: fast,
      branchY: x => backBranchY(x) + 0.6, x0: x0 + hash(i, 12) * span, lo: x0, hi: x0 + span, dir: hash(i, 15) < 0.5 ? 1 : -1 });
    return { key: k, s, b, fast, x0, x1: x0 + span, rest: hash(i, 16) * 3 };
  });
}

export function stepVillager(v, dt, rnd) {
  const b = v.b;
  if (b.target === null) {
    v.rest -= dt;
    if (v.rest <= 0) { const right = b.chest()[0] < (v.x0 + v.x1) / 2; b.travelTo(right ? v.x1 - rnd() * 25 : v.x0 + rnd() * 25); }
  } else if (b.arrived()) { b.travelTo(null); v.rest = 1.5 + rnd() * 3.5; }
  const ev = b.step(dt, rnd);
  stepPose(b, SPECIES[v.key], v.s, dt);
  return ev;
}

/** Pose and pelvis for drawing a villager. */
export function villagerPose(v) { return brachiatePose(SPECIES[v.key], v.b, v.s, { fast: v.fast }); }
