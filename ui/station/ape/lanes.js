// MonkeyCraft ape village: the lanes apes travel along, and how to get from one to another.
//
// Lanes: 'ground' (the village path), 'canopy' (the low branch through the ground village),
// 'perch' (the Chief's lodge platform), 'c1' and 'c2' (the walkways of the two canopy stories).
// Swingers hang under the branch and the walkways; everyone else walks on top.
// Connections: trunks (ground / low branch / Canopy 1), the lodge's rope ladder (ground / perch),
// the great trunk beside the lodge (perch / Canopy 1), rope ladders (Canopy 1 / Canopy 2), and
// a swinger can drop from the low branch to the ground.

import { AGILE } from './cast.js';
import { BIG_TRUNK, LADDERS, TRUNKS, trunkR, walkY } from './canopy.js';
import { PERCH_Y, branchY, groundY } from './world.js';
import { LADDER_X } from './chief.js';

export const LANES = ['ground', 'canopy', 'perch', 'c1', 'c2'];
const story = lane => lane === 'c1' ? 1 : 2;
export const surfaceY = (lane, x) => lane === 'ground' ? groundY(x) : lane === 'perch' ? PERCH_Y : lane === 'canopy' ? branchY(x) : walkY(story(lane), x);
/** Does this ape swing under this lane (rather than walk on top)? */
export const hangs = (lane, sp) => lane !== 'ground' && lane !== 'perch' && !!AGILE[sp.canopy];
/** The hold line a swinger hangs from. */
export const holdY = (lane, x) => lane === 'canopy' ? branchY(x) + 1 : walkY(story(lane), x) + 4;
/** Where the pelvis is at each end of a climb. */
export function climbLevel(lane, x, sp) {
  const swing = !!sp.canopy?.startsWith('brachiate');
  if (lane === 'ground') return groundY(x) - 8;
  if (lane === 'perch') return PERCH_Y - 4;
  if (lane === 'canopy') return branchY(x) + (swing ? 12 : -6);
  return walkY(story(lane), x) + (swing ? 14 : -5);
}

// the next lane on the way from one lane to another
const NEXT = {
  ground: { canopy: 'canopy', perch: 'perch', c1: 'c1', c2: 'c1' },
  canopy: { ground: 'ground', perch: 'ground', c1: 'c1', c2: 'c1' },
  perch: { ground: 'ground', canopy: 'ground', c1: 'c1', c2: 'c1' },
  c1: { ground: 'ground', canopy: 'canopy', perch: 'perch', c2: 'c2' },
  c2: { ground: 'c1', canopy: 'c1', perch: 'c1', c1: 'c1' }
};
export const nextLane = (from, to) => from === to ? to : NEXT[from][to];
const nearest = (xs, at, x) => xs.reduce((b, c) => Math.abs(at - c) + Math.abs(c - x) < Math.abs(at - b) + Math.abs(b - x) ? c : b);

/**
 * The legs of a trip from (from, at) to (lane, x). A climb leg carries the connector x and dx, the
 * offset of the climber's body from it (it hangs on the trunk's side, or sits on the ladder), so the
 * walk up to a climb ends exactly where the climb begins.
 */
export function route(from, at, lane, x) {
  const legs = [];
  const climb = (cx, dx, a, b) => { legs.push({ k: 'move', x: cx - dx }, { k: 'climb', x: cx, dx, from: a, to: b }); at = cx - dx; };
  for (let guard = 0; from !== lane && guard < 6; guard++) {
    const to = nextLane(from, lane), key = `${from}>${to}`;
    if (key === 'ground>perch' || key === 'perch>ground') climb(LADDER_X, 4, from, to);
    else if (key === 'perch>c1' || key === 'c1>perch') climb(BIG_TRUNK, trunkR(BIG_TRUNK, 0) + 3, from, to);
    else if (key === 'c1>c2' || key === 'c2>c1') climb(nearest(LADDERS.map(l => l.x), at, x), 4, from, to);
    else if (key === 'canopy>ground') { const lx = Math.max(30, Math.min(930, x + (x > at ? -14 : 14))); legs.push({ k: 'move', x: lx }, { k: 'drop' }); at = lx; }   // swing over, then leap down
    else { const tx = nearest(TRUNKS, at, x); climb(tx, tx === BIG_TRUNK ? 11 : 7, from, to); }   // up or down a great trunk
    from = to;
  }
  legs.push({ k: 'move', x });
  return legs;
}

// where on each lane a wanderer may head for
export const SPAN = { ground: [20, 940], canopy: [40, 920], c1: [30, 930], c2: [30, 930], perch: [414, 524] };
/** Pick a wander destination: often the same lane, otherwise another story (the low branch only for climbers). */
export function pickWander(sp, cur, rnd, home = null) {
  let lane = cur;
  if (cur === 'perch' || rnd() > 0.45) {
    const opts = [['ground', 0.4], ['c1', 0.3], ['c2', 0.2], ...(sp.canopy ? [['canopy', 0.15]] : [])];
    if (home) opts.push([home, 0.35]);                 // villagers who live up in the trees head home more often
    let r = rnd() * opts.reduce((a, [, w]) => a + w, 0);
    for (const [l, w] of opts) { if ((r -= w) <= 0) { lane = l; break; } }
  }
  const [lo, hi] = SPAN[lane];
  return { lane, x: lo + rnd() * (hi - lo) };
}
