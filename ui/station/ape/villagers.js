// MonkeyCraft ape village: background villagers (scenery, never crew) that travel a far branch hand over hand.

import { hash, lerp } from './fb.js';
import { AGILE, SPECIES, fk } from './cast.js';
import { backBranchY } from './world.js';

// Each villager owns a stretch of the far branch and travels it end to end, hand over hand.
// The body is a real pendulum hanging from the gripping hand, and both arms are solved to touch
// real points: the grip arm holds the branch, and late in each swing the free arm reaches out and
// closes on the next hold, so when the hands swap nothing jumps. The released hand lets go from
// where it was and drops back to hang loose. A trip: lean back to gather the swing, swing hold to
// hold (each swing a little longer or shorter than the last), then on arrival swing back and settle
// like a damped pendulum, rest, turn round and go back.
export const VILLAGERS = ['scout', 'smith', 'archivist', 'writer'];
export const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
export function makeVillagers(bw) {
  return VILLAGERS.map((k, i) => {
    const sp = SPECIES[k], g = AGILE[sp.canopy], s = 0.7, span = 150 + hash(i, 10) * 90;
    const x0 = 20 + i * (bw - 40 - span) / (VILLAGERS.length - 1) + (hash(i, 11) - 0.5) * 30, gx = x0 + hash(i, 12) * span;
    return { key: k, s, R: (sp.ua + sp.la) * s * 0.9, amp: g.amp * (0.9 + hash(i, 13) * 0.2), T: g.T * (1.05 + hash(i, 14) * 0.3), x0, x1: x0 + span, gx, target: gx,
      dir: hash(i, 15) < 0.5 ? 1 : -1, phase: 'rest', timer: hash(i, 16) * 3, th: 0, w: 0, thv: 0, a: 0, na: 0, u: 0, th0: 0, hand: 0, tor: 0, torv: 0, catchNext: false, rel: null, fast: sp.canopy === 'brachiate-fast' };
  });
}
export function stepVillager(v, dt, rnd) {
  const th0 = v.th;
  if (v.rel) v.rel.t += dt;
  if (v.phase === 'rest') {
    const k = (Math.PI / v.T) ** 2 * 0.55;                                   // the hanging body's own pendulum
    v.w += (-k * Math.sin(v.th) - 1.6 * v.w) * dt; v.th += v.w * dt;
    v.timer -= dt;
    if (v.timer <= 0 && Math.abs(v.w) < 0.6) {
      const right = v.gx < (v.x0 + v.x1) / 2, nd = right ? 1 : -1;          // head for the far end of its stretch
      v.target = right ? v.x1 - rnd() * 25 : v.x0 + rnd() * 25;
      if (nd !== v.dir) { v.th = -v.th; v.w = -v.w; v.tor = -v.tor; v.torv = -v.torv; v.thv = -v.thv; v.dir = nd; v.rel = null; }   // turn round without moving the body
      v.phase = 'pump'; v.u = 0; v.th0 = v.th; v.a = v.amp * (0.85 + rnd() * 0.3);
    }
  } else if (v.phase === 'pump') {                                           // lean back under the hold, gathering the swing
    v.u += dt / (v.T * 0.8);
    v.th = lerp(v.th0, -v.a, Math.sin(Math.PI / 2 * Math.min(1, v.u)));
    if (v.u >= 1) { v.phase = 'swing'; v.u = 0; planSwing(v, rnd); }
  } else {
    v.u += dt / v.T;
    v.th = -v.a * Math.cos(Math.PI * Math.min(1, v.u));                    // fastest at the bottom of the arc
    if (v.u >= 1) {
      if (v.catchNext) {                                                     // the free hand is on the next hold: swap hands
        v.rel = { x: v.gx, t: 0 };
        v.gx = v.nextX; v.a = v.na; v.th = -v.na; v.u -= 1; v.hand ^= 1; planSwing(v, rnd);
      } else { v.phase = 'rest'; v.w = 0; v.th = v.a; v.timer = 1.5 + rnd() * 3.5; }   // arrived: swing back and settle
    }
  }
  v.thv = lerp(v.thv, (v.th - th0) / dt, Math.min(1, dt * 10));
  // the body follows the swing on a spring, so after a catch it rotates round to hang under the new hand
  const want = -v.th * 0.8 - v.thv * 0.03;
  v.torv += ((want - v.tor) * 90 - v.torv * 14) * dt; v.tor += v.torv * dt;
}
export function planSwing(v, rnd) {
  v.na = v.amp * (0.85 + rnd() * 0.3);
  const step = v.R * (Math.sin(v.a) + Math.sin(v.na));
  v.nextX = v.gx + v.dir * step;
  v.catchNext = (v.target - v.gx) * v.dir > step * 0.6;
}
/** Two-bone reach: shoulder angle and elbow bend (fk conventions) so the hand lands on (dx, dy), elbow bending back. */
export function reachArm(ua, la, dx, dy) {
  const d = Math.min(Math.hypot(dx, dy), (ua + la) * 0.999), base = Math.atan2(dx, dy);
  const al = Math.acos(Math.max(-1, Math.min(1, (ua * ua + d * d - la * la) / (2 * ua * d || 1))));
  const sh = base + al, ex = Math.sin(sh) * ua, ey = Math.cos(sh) * ua;
  return [sh, Math.atan2(dx - ex, dy - ey) - sh];
}
/** Pose and pelvis position for a villager, from its pendulum and the points its hands are holding or reaching for. */
export function villagerPose(v) {
  const sp = SPECIES[v.key], s = v.s, f = v.dir, by = backBranchY(v.gx) + 0.6;
  const cx = v.gx + f * v.R * Math.sin(v.th), cy = by + v.R * Math.cos(v.th);   // the chest swings on the gripping arm
  const torso = v.tor;                                                           // body hangs along the arm, on a spring
  const loose = [cx + f * sp.ua * s * 0.35, cy + sp.ua * s * 0.85];              // where a free hand hangs
  let free = loose;
  if (v.phase === 'swing' && v.catchNext) { const w = smooth((v.u - 0.4) / 0.6); free = [lerp(loose[0], v.nextX, w), lerp(loose[1], backBranchY(v.nextX) + 0.6, w)]; }   // reach for the next hold
  if (v.rel && v.rel.t < 0.3) { const w = smooth(v.rel.t / 0.3); free = [lerp(v.rel.x, free[0], w), lerp(backBranchY(v.rel.x) + 0.6, free[1], w)]; }               // let go of the last one
  const arm = ([tx, ty]) => reachArm(sp.ua, sp.la, (tx - cx) * f / s, (ty - cy) / s);
  const g = v.hand, gr = arm([v.gx, by]), fr = arm(free), sh = [0, 0], el = [0, 0];
  sh[g] = gr[0]; el[g] = gr[1]; sh[1 - g] = fr[0]; el[1 - g] = fr[1];
  const lag = Math.max(-0.5, Math.min(0.5, -v.thv * 0.08)), tuck = v.fast ? [0.75, 0.5] : [0.3, 0.12];
  const leg = -torso * 0.9 + lag;
  const q = { torso, head: -0.2 + v.th * 0.2, sh, el, hip: [leg + tuck[0], leg + tuck[1]], kn: v.fast ? [-1.5, -1.25] : [-0.55, -0.35], plant: 'none', tail: 0, lift: 0 };
  return { q, px: cx - f * Math.sin(torso) * sp.tl * s, py: cy + Math.cos(torso) * sp.tl * s };
}
