// MonkeyCraft ape village: what the Chief does with his free time (final-changes item 6).
//
// While he's free, the Chief mostly rests on his lodge platform. Every 20–60 s he
// shifts to a new spot and settles into a new rest pose (sitting, lying on his side,
// lying on his back, or leaning against the great tree). Rarely, every several
// minutes, he climbs down the rope ladder (or up the great trunk to Canopy 1), strolls,
// has a look round and climbs back. Far less often than the rest of the crew wander.
//
// Pure: the scene calls step(dt) only while he's free and resting on the platform,
// and calls interrupt() when a job sends him back to his station. rnd is injected.

export const REST_POSES = ['sit', 'lieSide', 'lieBack', 'lean'];
export const LADDER_X = 466;                 // the rope ladder down from the lodge platform
export const LEAN_SPOT = { x: 461, facing: -1 };   // back against the great tree's trunk
export const CHIEF_SPOTS = [[414, 452], [497, 524]];      // open planks either side of the trunk and ladder

export const TIMING = {
  normal:  { rest: [20, 60], walk: [240, 480], settle: [1, 3], linger: [4, 9], blend: 0.7 },
  reduced: { rest: [45, 90], walk: [600, 900], settle: [2, 4], linger: [6, 12], blend: 1.4 }   // fewer, slower changes
};

export function makeChiefIdle({ rnd, reduced = false }) {
  const T = reduced ? TIMING.reduced : TIMING.normal;
  const span = ([a, b]) => a + rnd() * (b - a);
  let restT = span(T.settle), walkT = span(T.walk), pose = null;
  const pick = () => {
    const choices = REST_POSES.filter(p => p !== pose);
    pose = choices[Math.floor(rnd() * choices.length)];
    if (pose === 'lean') return { kind: 'rest', pose, ...LEAN_SPOT };
    const [lo, hi] = CHIEF_SPOTS[rnd() < 0.6 ? 0 : 1];
    return { kind: 'rest', pose, x: Math.round(lo + rnd() * (hi - lo)), facing: rnd() < 0.5 ? -1 : 1 };
  };
  return {
    timing: T,
    /** Advance the clock while he rests; returns null, a new rest { pose, x, facing }, or a walk { x, linger }. */
    step(dt) {
      restT -= dt; walkT -= dt;
      if (walkT <= 0) {
        walkT = span(T.walk); restT = span(T.settle); pose = null;
        const up = rnd() < 0.3;   // now and then his stroll takes him up the great trunk to Canopy 1
        return { kind: 'walk', lane: up ? 'c1' : 'ground', x: Math.round(up ? 300 + rnd() * 360 : 130 + rnd() * 700), linger: span(T.linger) };
      }
      if (restT <= 0) { restT = span(T.rest); return pick(); }
      return null;
    },
    /** A job called him away (or he just got back from a walk): settle again shortly once he's free. */
    interrupt() { restT = span(T.settle); pose = null; },
    get pose() { return pose; }
  };
}
