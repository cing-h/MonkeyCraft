// MonkeyCraft ape village: brachiation (swinging arm over arm), shared by the
// crew and the background villagers.
//
// The ape is a real pendulum hanging from its grip: angle th from straight
// down (+ = ahead in the facing direction) and angular speed w, under its own
// gravity G, chosen so its natural swing time matches the species. Nothing
// sets positions directly: the ape pumps energy in or out to reach a target
// swing, and position and speed stay continuous through every change.
//   continuous (slow): at the forward peak of a swing (w = 0) the free hand
//     takes the next hold, and the next swing starts from the same spot.
//   ricochetal (fast, gibbons most of all): near the top of the forward swing
//     the ape lets go and flies on a ballistic arc under the same gravity.
//     It catches the first hold ahead that comes within arm's reach, and its
//     velocity carries straight into the new swing. On the catch, the arm
//     stretches and springs back (a dip), and the leaves shake.
// Pure: no clock, no randomness of its own (rnd is injected).

export const smoothstep = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

/**
 * opts: { R (arm reach, px), halfPeriod (s), amp (normal swing, rad), ricochet (bool: can fly),
 *         branchY(x), x0, lo, hi (stretch of branch it may use), dir }
 */
export function makeBrachiator(o) {
  const G = o.R * (Math.PI / o.halfPeriod) ** 2;           // pendulum of length R with that half-period
  const b = {
    R: o.R, G, amp: o.amp, ricochet: !!o.ricochet, branchY: o.branchY, lo: o.lo ?? -Infinity, hi: o.hi ?? Infinity,
    hx: o.x0, dir: o.dir || 1, th: 0, w: 0, mode: 'hang',  // 'hang' | 'flight'
    target: null, urgent: false, hand: 0,
    fx: 0, fy: 0, fvx: 0, fvy: 0,                          // flight: chest position and velocity
    dip: 0, dipV: 0,                                      // catch spring (stretch of the arm, fraction of R)
    rel: null,                                            // { x, y, t } the hand that just let go
    catches: 0, lastCatchX: null, idleT: 0, air: 0, flights: 0
  };
  const hy = x => b.branchY(x);

  /** Where the chest is now, in world coordinates. */
  b.chest = () => b.mode === 'flight' ? [b.fx, b.fy] : [b.hx + b.dir * b.R * (1 + b.dip) * Math.sin(b.th), hy(b.hx) + b.R * (1 + b.dip) * Math.cos(b.th)];
  /** Chest velocity (px/s), for handing off to a jump or a fall. */
  b.velocity = () => b.mode === 'flight' ? [b.fvx, b.fvy] : [b.dir * b.R * b.w * Math.cos(b.th), -b.R * b.w * Math.sin(b.th)];
  /** The angle this swing will reach at its forward peak (from its energy). */
  b.peak = () => { const c = 1 - energy() / (b.G * b.R); return c <= -1 ? Math.PI / 2 : Math.acos(Math.max(-1, Math.min(1, c))); };
  /** Where the next hold will be if this swing catches at its peak. */
  b.nextHold = () => { const p = Math.min(b.peak(), 1.3); return b.hx + b.dir * 2 * b.R * Math.sin(p); };
  const energy = () => 0.5 * b.R * b.R * b.w * b.w + b.G * b.R * (1 - Math.cos(b.th));
  const energyAt = a => b.G * b.R * (1 - Math.cos(a));

  /** Head somewhere along the branch (null = come to rest). urgent = hurry (home for a job). */
  b.travelTo = (x, urgent = false) => {
    b.target = x === null ? null : Math.max(b.lo, Math.min(b.hi, x)); b.urgent = urgent;
    if (b.target !== null) {
      const nd = Math.sign(b.target - b.chest()[0]) || b.dir;
      if (nd !== b.dir && b.mode === 'hang') { b.dir = nd; b.th = -b.th; b.w = -b.w; }   // turn round without moving the body
    }
  };
  b.arrived = () => b.target === null || (b.mode === 'hang' && Math.abs(b.target - b.chest()[0]) < b.R * 0.9 && Math.abs(b.w) < 1.2);

  function catchAt(x, cx, cy, vx, vy) {
    const y = hy(x), dx = (cx - x) * b.dir, dy = cy - y;
    b.rel = { x: b.hx, y: hy(b.hx), t: 0 };
    b.hx = x; b.mode = 'hang'; b.hand ^= 1;
    b.th = Math.atan2(dx, dy);
    const d = Math.hypot(dx, dy);
    b.dip = Math.max(-0.08, Math.min(0.12, d / b.R - 1));          // whatever stretch the catch needs, then it springs back
    // keep the tangential part of the velocity; the arm absorbs the rest (that's the dip)
    const tx = b.dir * Math.cos(b.th), ty = -Math.sin(b.th);
    b.w = (vx * tx + vy * ty) / b.R;
    b.dipV = Math.max(0, vx * Math.sin(b.th) * b.dir + vy * Math.cos(b.th)) / b.R * 0.6;   // radial speed into the arm
    b.catches++; b.lastCatchX = x;
  }

  /** Advance dt seconds. Returns an event or null: 'catch' | 'release'. */
  b.step = (dt, rnd = Math.random) => {
    let ev = null;
    if (b.rel) { b.rel.t += dt; if (b.rel.t > 0.35) b.rel = null; }
    // the catch spring: the arm stretches, then settles
    b.dipV += (-b.dip * 260 - b.dipV * 16) * dt; b.dip += b.dipV * dt;
    const n = Math.max(1, Math.ceil(dt / 0.005)), h = dt / n;       // small steps keep the pendulum honest
    for (let i = 0; i < n; i++) {
      if (b.mode === 'flight') {
        b.fvy += b.G * h; b.fx += b.fvx * h; b.fy += b.fvy * h;
        // catch the first hold ahead that's within arm's reach, once the ape has stopped rising
        b.air += h;
        if (b.fvy > -b.R * 1.5 && b.air > 0.07) {   // near or past the top of the arc, and properly airborne
          // of the points ahead within arm's reach, take the one nearest where the reaching hand is
          const reach = b.R * 1.04, lead = b.handPos?.[1 - b.hand];
          let best = null, bestD = Infinity;
          for (let k = 0; k <= 16; k++) {
            const x = b.fx + b.dir * reach * (0.98 - k * 0.06);
            if (x < b.lo || x > b.hi || (x - b.fx) * b.dir < -reach * 0.2) continue;
            if (Math.hypot(b.fx - x, b.fy - hy(x)) > reach || b.fy <= hy(x)) continue;
            const dl = lead ? Math.abs(x - lead[0]) : -k;
            if (dl < bestD) { bestD = dl; best = x; }
          }
          if (best !== null) { catchAt(best, b.fx, b.fy, b.fvx, b.fvy); ev = 'catch'; }
        }
        if (b.mode === 'flight' && b.fvy > 0 && b.fy - hy(b.fx) >= b.R * 0.98) {   // about to fall out of reach: grab the branch right overhead
          catchAt(b.fx, b.fx, b.fy, b.fvx, b.fvy); ev = 'catch';
        }
        continue;
      }
      // hanging: a pendulum, with the ape pumping toward the swing it wants
      const want = b.target === null ? 0 : b.amp * (b.urgent ? 1.15 : 1) * Math.min(1, 0.35 + Math.abs(b.target - b.chest()[0]) / (b.R * 4));
      const e = energy(), eWant = energyAt(want);
      const pump = Math.max(-14, Math.min(14, (eWant - e) / (b.G * b.R) * 16)) * Math.sign(b.w || b.dir);
      const damp = b.target === null ? 1.4 : 0.15;
      const prevW = b.w;
      b.w += (-(b.G / b.R) * Math.sin(b.th) + pump - damp * b.w) * h;
      b.th += b.w * h;
      if (b.target === null) continue;
      const left = (b.target - b.chest()[0]) * b.dir;
      if (left < b.R * 0.9) continue;                                // close enough: let this swing finish
      // fast travel: let go near the top of the forward swing, rising
      if (b.ricochet && b.th > want * 0.6 && b.w > 0 && want > 0.7 * b.amp && left > b.R * 3) {
        const [cx, cy] = b.chest(), [vx, vy] = b.velocity();
        b.rel = { x: b.hx, y: hy(b.hx), t: 0 };
        b.mode = 'flight'; b.fx = cx; b.fy = cy; b.fvx = vx; b.fvy = vy; b.air = 0; ev = 'release'; b.flights++;
        continue;
      }
      // continuous: at the forward peak, take the next hold ahead
      if (prevW > 0 && b.w <= 0 && b.th > 0.15) {
        const [cx, cy] = b.chest();
        const nx = cx + b.dir * b.R * Math.sin(b.th);
        if (nx >= b.lo && nx <= b.hi) { catchAt(nx, cx, cy, 0, 0); ev = 'catch'; }
      }
    }
    if (b.target === null) b.idleT += dt; else b.idleT = 0;
    return ev;
  };

  return b;
}

/** Two-bone reach (fk conventions): shoulder angle and elbow bend so the hand lands on (dx, dy), elbow bending back. */
export function reachArm(ua, la, dx, dy) {
  const d = Math.min(Math.hypot(dx, dy), (ua + la) * 0.999), base = Math.atan2(dx, dy);
  const al = Math.acos(Math.max(-1, Math.min(1, (ua * ua + d * d - la * la) / (2 * ua * d || 1))));
  const sh = base + al, ex = Math.sin(sh) * ua, ey = Math.cos(sh) * ua;
  return [sh, Math.atan2(dx - ex, dy - ey) - sh];
}
const lerp = (a, c, t) => a + (c - a) * t;

/**
 * Per-frame body dynamics for a brachiator, drawn with species proportions sp at scale s:
 * the torso swings on a spring, the legs tuck on the upswing and trail in flight, and
 * each hand eases toward where it wants to be (only the gripping hand is pinned to the hold).
 */
export function stepPose(b, sp, s, dt) {
  const [cx, cy] = b.chest(), f = b.dir;
  const want = b.mode === 'flight' ? lerp(-0.45, 0.35, smoothstep((b.fvy + b.R * 6) / (b.R * 12))) : -b.th * 0.8 - b.w * 0.03;
  b.torv = (b.torv || 0) + ((want - (b.tor || 0)) * 90 - (b.torv || 0) * 14) * dt; b.tor = (b.tor || 0) + b.torv * dt;
  const tuckWant = b.mode === 'flight' ? -0.5 : b.th * b.w > 0 ? 1 : 0.15;   // tuck rising, stretch falling, trail in the air
  b.tuck = (b.tuck ?? 0) + (tuckWant - (b.tuck ?? 0)) * Math.min(1, dt * 7);
  const loose = [cx + f * sp.ua * s * 0.35, cy + sp.ua * s * 0.85], back = [cx - f * sp.ua * s * 0.55, cy + sp.ua * s * 0.6];
  const g = b.hand, free = 1 - g, tgt = [null, null], rate = [8, 8];   // a hand drifts to rest gently; reaching is quicker
  if (b.mode === 'flight') { const ax = b.fx + f * b.R * (b.fvy > 0 ? 0.55 : 0.85); tgt[free] = [ax, b.branchY(ax)]; tgt[g] = back; rate[free] = 22; rate[g] = 7; }
  else {
    tgt[g] = [b.hx, b.branchY(b.hx) + 0.6];
    let ft = loose;
    if (b.target !== null) {                                       // late in a forward swing, reach for the next hold
      const k = smoothstep((b.th - 0.05) / Math.max(0.2, b.peak() * 0.85)) * (b.w > -0.2 ? 1 : 0.3);
      const nx = b.nextHold();
      ft = [lerp(loose[0], nx, k), lerp(loose[1], b.branchY(nx), k)];
      rate[free] = 8 + 12 * k;
    }
    tgt[free] = ft;
  }
  b.handPos = b.handPos || [tgt[0].slice(), tgt[1].slice()];
  for (const i of [0, 1]) {
    if (b.mode === 'hang' && i === g) { b.handPos[i] = tgt[i].slice(); continue; }
    const ease = 1 - Math.exp(-dt * rate[i]);
    b.handPos[i] = [lerp(b.handPos[i][0], tgt[i][0], ease), lerp(b.handPos[i][1], tgt[i][1], ease)];
  }
}

/** The pose (fk conventions) and pelvis position for drawing a brachiator. */
export function brachiatePose(sp, b, s, { fast = false } = {}) {
  const f = b.dir, [cx, cy] = b.chest(), torso = b.tor || 0;
  const hands = b.handPos || [[cx, cy + sp.ua * s], [cx, cy + sp.ua * s]];
  const sh = [0, 0], el = [0, 0];
  for (const i of [0, 1]) { const r = reachArm(sp.ua, sp.la, (hands[i][0] - cx) * f / s, (hands[i][1] - cy) / s); sh[i] = r[0]; el[i] = r[1]; }
  const tk = b.tuck ?? 0, base = fast ? [0.75, 0.5] : [0.3, 0.12];
  const lag = Math.max(-0.5, Math.min(0.5, -(b.mode === 'flight' ? 0 : b.w) * 0.08)), leg = -torso * 0.9 + lag;
  const hip = [leg + base[0] * Math.max(0, tk) + Math.min(0, tk) * 0.6, leg + base[1] * Math.max(0, tk) + Math.min(0, tk) * 0.9];
  const kn = [lerp(-0.25, fast ? -1.5 : -0.6, Math.max(0, tk)), lerp(-0.2, fast ? -1.3 : -0.4, Math.max(0, tk))];
  const q = { torso, head: -0.15 - torso * 0.6, sh, el, hip, kn, plant: 'none', tail: 0, lift: 0 };
  return { q, px: cx - f * Math.sin(torso) * sp.tl * s, py: cy + Math.cos(torso) * sp.tl * s };
}
