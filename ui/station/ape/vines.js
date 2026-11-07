// MonkeyCraft ape village: long lianas the swingers ride across a story (village revamp, phase 4).
//
// Each story has a few long vines hanging over its floor: on the ground from the low branch, and on
// Canopy 1 and 2 from the leaves above the walkway. A swinger standing on the floor jumps up and grabs
// one, pumps the swing, lets go near the top of a forward swing and flies on a real ballistic arc to
// the next vine or back down to the floor. Everything runs under one gravity, VINE_G.
//
//   hanging:  the ape is a pendulum from its grip (angle phi from straight down, + ahead in the travel
//             direction; the chest hangs an arm's reach R below the hand, along the vine). It pumps
//             energy in until the swing is big enough, exactly like swing.js.
//   release:  each step of a forward, rising swing it predicts the flight in closed form. It lets go at
//             the first moment the arc reaches the next vine within its length (or lands ahead on the
//             floor, for the last vine) and the flight is then followed exactly, so the catch is where
//             and when it was predicted.
//   flips:    the flight time is known at release, so a somersault is only started when it fits:
//             n whole turns (backward, carrying on the way the swing rotates the body), spinning fastest
//             mid-air while tucked and slowing as it opens out to catch or land (tuck-to-spin, open-to-
//             land). The peak spin rate never exceeds the species' limit, so there is never a half-flip.
//   the vine: swings with the ape while it's held, and after a release swings back on its own and settles.
// Pure: no clock and no randomness of its own (rnd is injected).

import { SPECIES } from './cast.js';
import { branchY, groundY } from './world.js';
import { walkY } from './canopy.js';
import { reachArm, smoothstep } from './swing.js';

export const VINE_G = 240;   // px/s² (about real gravity at the apes' scale: ~25 px to the metre)
const TAU = Math.PI * 2;

/** Who rides vines and how: the swing they pump to (rad), and their top spin rate in a flip (rad/s; 0 = never flips). */
export const VINE_STYLE = {
  scout: { amp: 1.25, spin: 26, double: 0.4 },   // gibbon: the boldest flier, now and then a double
  smith: { amp: 1.05, spin: 21 },                // chimpanzee
  writer: { amp: 1.05, spin: 21 },               // bonobo
  clerk: { amp: 1.1, spin: 24 },                 // capuchin: quick and springy
  archivist: { amp: 0.85, spin: 0 }              // orangutan: slow, careful swings, no acrobatics
};
export const ridesVines = key => !!VINE_STYLE[key];

/** The floor a vine story's apes stand on: the ground, or the top of a canopy walkway. */
export const floorY = (lane, x) => lane === 'ground' ? groundY(x) : walkY(lane === 'c1' ? 1 : 2, x);

// the vines: anchor x, and length. Ground vines hang from the low branch; canopy vines from the leaves
// about 88 px above the walkway, ending a little above it.
const LAYOUT = {
  ground: { xs: [256, 300, 344, 388, 640, 684, 728, 772], len: 34 },
  c1: { xs: [110, 172, 234, 296, 358, 420, 560, 622, 684, 746, 808], len: 70, over: 90 },
  c2: { xs: [90, 154, 218, 282, 346, 410, 560, 624, 688, 752, 816, 880], len: 72, over: 92 }
};
export const VINES = Object.entries(LAYOUT).flatMap(([lane, L]) => L.xs.map(x => ({
  lane, x, len: L.len, ay: lane === 'ground' ? branchY(x) + 1 : floorY(lane, x) - L.over
}))).map((v, id) => ({ ...v, id }));
export const vinesOn = lane => VINES.filter(v => v.lane === lane);

/** The vines' own motion: each swings as a damped rope pendulum when no ape holds it. */
export function makeVineSway() {
  const st = VINES.map(() => ({ ang: 0, w: 0, held: null }));
  return {
    st,
    step(dt, t = 0) {
      VINES.forEach((v, i) => {
        const s = st[i]; if (s.held) return;
        const Lp = v.len * 2 / 3, n = Math.max(1, Math.ceil(dt / 0.01)), h = dt / n;
        const breeze = 0.012 * Math.sin(t * 0.7 + v.x * 0.05);
        for (let k = 0; k < n; k++) { s.w += (-(VINE_G / Lp) * Math.sin(s.ang - breeze) - 0.9 * s.w) * h; s.ang += s.w * h; }
      });
    }
  };
}

// ---------- the ape on a vine ----------
const dims = (key, s) => {
  const sp = SPECIES[key];
  return { sp, R: (sp.ua + sp.la) * 0.9 * s, tl: sp.tl * s, hang: (sp.tl + (sp.ul + sp.ll) * 0.95) * s, foot: (sp.ul + sp.ll) * 0.88 * s };
};
// how high the grip is, so the hanging feet clear the floor by 3 px at the bottom of the swing
const gripR = (v, d) => Math.max(6, Math.min(v.len - 1, floorY(v.lane, v.x) - 3 - d.hang - d.R - v.ay));

/** Predict a flight from point P with velocity V (the body's middle) to vine w (hanging at angle ang).
 *  Returns { t, x, y, r } of the catch (r = where the hand grips), or null when it can't be caught. */
function predictCatch(P, V, w, ang, d) {
  const dx = Math.sin(ang), dy = Math.cos(ang), cy0 = P[1] - d.tl * 0.5;        // the chest is half a torso above the middle
  const a = -0.5 * VINE_G * dx, b = V[0] * dy - V[1] * dx, c = (P[0] - w.x) * dy - (cy0 - w.ay) * dx;
  let ts = [];
  if (Math.abs(a) < 1e-6) { if (Math.abs(b) > 1e-6) ts = [-c / b]; }
  else { const D = b * b - 4 * a * c; if (D < 0) return null; const q = Math.sqrt(D); ts = [(-b - q) / (2 * a), (-b + q) / (2 * a)]; }
  const t = ts.filter(x => x > 0.12).sort((p, q) => p - q)[0]; if (t === undefined) return null;
  const x = P[0] + V[0] * t, y = P[1] + V[1] * t + 0.5 * VINE_G * t * t, lam = (x - w.x) * dx + (y - d.tl * 0.5 - w.ay) * dy, r = lam - d.R;
  const hi = gripR(w, d); if (r < Math.min(w.len * 0.4, hi - 6) || r > hi) return null;   // low enough for a good swing, high enough that the feet clear the floor
  return { t, x, y, r };
}
/** Predict a flight down onto the floor: when the feet touch. */
function predictLand(P, V, lane, d) {
  let t = 0.3;
  for (let i = 0; i < 4; i++) {   // the floor's height depends a little on where it lands
    const Y = floorY(lane, P[0] + V[0] * t) - d.foot - d.tl * 0.5, D = V[1] * V[1] - 2 * VINE_G * (P[1] - Y);
    if (D < 0) return null; t = (-V[1] + Math.sqrt(D)) / VINE_G;
  }
  return { t, x: P[0] + V[0] * t, y: P[1] + V[1] * t + 0.5 * VINE_G * t * t };
}

/** Can this ape get from vine i to vine j (in direction dir) at its full swing? (used to choose a chain) */
const linkCache = new Map();
export function canLink(key, s, i, j) {
  const id = `${key}:${s}:${i}:${j}`; if (linkCache.has(id)) return linkCache.get(id);
  const d = dims(key, s), v = VINES[i], w = VINES[j], dir = Math.sign(w.x - v.x), A = VINE_STYLE[key].amp * 0.92, Lc = gripR(v, d) + d.R;
  let ok = false;
  for (let phi = 0.1; phi < A && !ok; phi += 0.02) {
    const sp = Math.sqrt(Math.max(0, 2 * VINE_G * Lc * (Math.cos(phi) - Math.cos(A))));
    const C = [v.x + dir * Lc * Math.sin(phi), v.ay + Lc * Math.cos(phi)], P = [C[0] - dir * Math.sin(-phi) * d.tl * 0.5, C[1] + Math.cos(phi) * d.tl * 0.5];
    const V = [dir * sp * Math.cos(phi), -sp * Math.sin(phi)];
    if (predictCatch(P, V, w, 0, d)) ok = true;
  }
  linkCache.set(id, ok); return ok;
}

/**
 * Choose a run of vines for a trip along `lane` from x0 to x1: consecutive vines ahead that this ape can
 * link, leaving room to land before x1. Returns the vine ids (maybe empty). busy: ids held by someone.
 */
export function vineChain(key, s, lane, x0, x1, busy = new Set()) {
  if (!ridesVines(key) || !LAYOUT[lane] || Math.abs(x1 - x0) < 110) return [];
  const dir = Math.sign(x1 - x0), room = lane === 'ground' ? 46 : 70;
  const ahead = vinesOn(lane).filter(v => (v.x - x0) * dir > 24 && (x1 - v.x) * dir > room).sort((a, b) => (a.x - b.x) * dir);
  const out = [];
  for (const v of ahead) {
    if (busy.has(v.id)) break;
    if (out.length && !canLink(key, s, out[out.length - 1], v.id)) break;
    out.push(v.id);
  }
  return out;
}

/**
 * One trip on the vines. o: { key, s, chain (vine ids), x (where it stands), dir, sway (makeVineSway),
 *   rnd, flips (bool), hurry (bool) }. step(dt) → null | 'grab' | 'release' | 'catch' | 'land' | 'done'.
 * pose() → { q, px, py } (pelvis), and x/y of the body for the camera.
 */
export function makeVineRider(o) {
  const d = dims(o.key, o.s), style = VINE_STYLE[o.key], dir = o.dir, lane = VINES[o.chain[0]].lane, g = VINE_G;
  const r = {
    key: o.key, dir, chain: o.chain.slice(), i: 0, phase: 'crouch', t: 0,
    phi: 0, w: 0, len: 0, dip: 0, dipV: 0,                 // hanging: angle, angular speed, grip distance, arm stretch
    P: [o.x, floorY(lane, o.x) - d.foot - d.tl * 0.5], V: [0, 0], P0: null, ft: 0, T: 0,   // flight: the body's middle
    spin: 0, turns: 0, flips: 0, maxSpin: 0, landing: false, tor: 0, tor0: 0, tor1: 0, tuck: 0, hands: null,
    stop: false, events: []
  };
  const vine = () => VINES[r.chain[r.i]];
  const hold = () => o.sway.st[r.chain[r.i]];
  const Lc = () => r.len + d.R * (1 + r.dip);
  const chest = () => { const v = vine(); return [v.x + dir * Lc() * Math.sin(r.phi), v.ay + Lc() * Math.cos(r.phi)]; };
  const handAt = () => { const v = vine(); return [v.x + dir * r.len * Math.sin(r.phi), v.ay + r.len * Math.cos(r.phi)]; };
  const amp = () => style.amp * (o.hurry ? 1.05 : 1) * (o.reduced ? 0.75 : 1);
  const last = () => r.i === r.chain.length - 1;
  const lift = (ph) => { r.phase = ph; r.t = 0; };

  /** Cut the trip short: finish on this vine (or the one being flown to) and drop to the floor. */
  r.finish = () => { r.stop = true; if (r.phase !== 'fly' || r.landing) r.chain.length = r.i + 1; else r.chain.length = Math.min(r.chain.length, r.i + 2); };

  function grab(i, P, V) {   // take hold of vine chain[i] with the body's middle at P moving at V
    const prev = r.phase === 'fly' || r.phase === 'jump' ? null : r.chain[r.i];
    if (prev !== null && o.sway.st[prev]) o.sway.st[prev].held = null;
    r.i = i; const v = vine(), s = hold();
    for (let k = 0; k < 2; k++) {   // the chest sits half a torso above the middle, along the body
      const c = [P[0] - dir * Math.sin(r.phi) * d.tl * 0.5, P[1] - Math.cos(r.phi) * d.tl * 0.5], dx = (c[0] - v.x) * dir, dy = c[1] - v.ay;
      r.phi = Math.atan2(dx, dy); r.len = Math.max(4, Math.min(gripR(v, d), Math.hypot(dx, dy) - d.R));
      r.dip = Math.max(-0.1, Math.min(0.15, (Math.hypot(dx, dy) - r.len) / d.R - 1));
    }
    const L = Lc(), tx = dir * Math.cos(r.phi), ty = -Math.sin(r.phi);
    r.w = (V[0] * tx + V[1] * ty) / L;
    r.dipV = Math.max(0, V[0] * Math.sin(r.phi) * dir + V[1] * Math.cos(r.phi)) / d.R * 0.5;
    s.held = r; s.ang = r.phi * dir; s.w = r.w * dir;
    lift('swing'); r.spin = 0; r.events.push('catch');
  }
  function letGo(target) {   // fly: target = { t, x, y } of the catch or the landing
    const s = hold(); s.held = null; s.w = r.w * dir * 0.8;   // the vine swings on without the ape
    const C = chest(), L = Lc();
    r.P = [C[0] - dir * Math.sin(-r.phi) * d.tl * 0.5, C[1] + Math.cos(r.phi) * d.tl * 0.5];
    r.V = [dir * L * r.w * Math.cos(r.phi), -L * r.w * Math.sin(r.phi)];
    r.P0 = r.P.slice(); r.ft = 0; r.T = target.t; r.landing = !!target.land;
    r.tor0 = -r.phi * 0.8; r.tor1 = r.landing ? -0.15 : 0.25;
    // a flip only if a whole number of turns fits: spin up tucked, open out ~0.16 s before the catch or landing
    const win = r.T - 0.06 - 0.14;
    let n = 0;
    if (o.flips && style.spin > 0) {
      const fits = k => win > 0 && 1.5 * TAU * k / win <= style.spin;
      if (fits(2) && style.double && o.rnd() < style.double) n = 2; else if (fits(1) && o.rnd() < 0.7) n = 1;
    }
    r.turns = n; if (n) r.flips++; r.maxSpin = n ? 1.5 * TAU * n / win : 0;
    lift('fly'); r.events.push('release');
  }

  r.step = (dt) => {
    r.events.length = 0; r.t += dt;
    r.dipV += (-r.dip * 260 - r.dipV * 16) * dt; r.dip += r.dipV * dt;
    if (r.phase === 'crouch') {                          // a quick crouch, then the jump up to the first vine
      if (r.t >= 0.14) {
        const v = vine(), rg = gripR(v, d), tj = 0.36;
        const C = [v.x - dir * 4, v.ay + rg + d.R], M = [C[0], C[1] + d.tl * 0.5];
        r.P0 = r.P.slice(); r.V = [(M[0] - r.P[0]) / tj, (M[1] - r.P[1] - 0.5 * g * tj * tj) / tj]; r.T = tj; r.ft = 0;
        lift('jump'); r.events.push('jump');
      }
    } else if (r.phase === 'jump' || r.phase === 'fly') {
      r.ft = Math.min(r.T, r.ft + dt);
      const t = r.ft; r.P = [r.P0[0] + r.V[0] * t, r.P0[1] + r.V[1] * t + 0.5 * g * t * t];
      if (r.phase === 'fly') {
        const win0 = 0.06, win1 = r.T - 0.14, u = (t - win0) / Math.max(0.01, win1 - win0);
        r.spin = -TAU * r.turns * smoothstep(u);             // backward somersault(s), fastest in the middle
        r.tuck = r.turns ? Math.sin(Math.PI * Math.max(0, Math.min(1, u))) : 0;
        r.tor = r.tor0 + (r.tor1 - r.tor0) * smoothstep(t / r.T);
      }
      if (r.ft >= r.T) {
        const V = [r.V[0], r.V[1] + g * r.T];
        if (r.phase === 'fly' && r.landing) { r.P[1] = floorY(lane, r.P[0]) - d.foot - d.tl * 0.5; r.spin = 0; lift('done'); r.events.push('land'); r.vland = V; }
        else grab(r.phase === 'jump' ? 0 : r.i + 1, r.P, V);
      }
    } else if (r.phase === 'swing') {
      const n = Math.max(1, Math.ceil(dt / 0.005)), h = dt / n, A = amp();
      if (!last() && r.t > 4) r.chain.length = r.i + 1;   // can't make the next vine after a few swings: drop off this one instead
      const want = gripR(vine(), d);   // caught high: slide down the vine, hand under hand, to a full-length grip
      if (r.len < want) { const L0 = Lc(); r.len = Math.min(want, r.len + 28 * o.s * dt); r.w *= L0 / Lc(); }   // (angular momentum kept)
      for (let k = 0; k < n && r.phase === 'swing'; k++) {
        const L = Lc(), e = 0.5 * L * L * r.w * r.w + g * L * (1 - Math.cos(r.phi)), eWant = g * L * (1 - Math.cos(A));
        const pump = Math.max(-6, Math.min(6, (eWant - e) / (g * L) * 9)) * Math.sign(r.w || 1);
        const prevW = r.w;
        r.w += (-(g / L) * Math.sin(r.phi) + pump - 0.05 * r.w) * h; r.phi += r.w * h;
        if (r.w <= 0 || r.phi < 0.12 || r.t < 0.25) continue;   // let go only on a forward, rising swing
        const C = chest(), P = [C[0] - dir * Math.sin(-r.phi) * d.tl * 0.5, C[1] + Math.cos(r.phi) * d.tl * 0.5], V = [dir * L * r.w * Math.cos(r.phi), -L * r.w * Math.sin(r.phi)];
        if (!last()) { const w = VINES[r.chain[r.i + 1]], c = predictCatch(P, V, w, o.sway.st[w.id].ang, d); if (c) { letGo(c); break; } }
        else if ((e > eWant * 0.9 || r.t > 3) && r.phi >= 0.8 * Math.acos(Math.max(-1, 1 - e / (g * L)))) {   // the last vine: wait for a full swing, let go at the best angle for big air, land ahead
          const l = predictLand(P, V, lane, d); if (l && l.x > 26 && l.x < 934) { letGo({ ...l, land: true }); break; }
        }
      }
      if (r.phase === 'swing') { const s = hold(); s.ang = r.phi * dir; s.w = r.w * dir; }
    }
    const tgt = r.phase === 'fly' ? 1 : r.phase === 'swing' ? (r.phi * r.w > 0 ? 0.9 : 0.1) : 0.4;   // legs tuck rising, stretch falling
    if (!r.turns || r.phase !== 'fly') r.tuck += (tgt * (r.phase === 'fly' ? 0.25 : 1) - r.tuck) * Math.min(1, dt * 7);
    return r.events[0] || null;
  };
  r.done = () => r.phase === 'done';
  r.lane = lane;
  /** Where the body's middle is (for the camera and drawing order). */
  r.mid = () => { if (r.phase !== 'swing') return r.P.slice(); const C = chest(); return [C[0] + dir * Math.sin(r.phi) * d.tl * 0.5, C[1] + Math.cos(r.phi) * d.tl * 0.5]; };
  r.hand = () => r.phase === 'swing' ? handAt() : null;

  /** The pose (fk conventions, facing dir) and pelvis to draw. */
  r.pose = () => {
    const sp = d.sp, s = o.s;
    if (r.phase === 'crouch') { const k = r.t / 0.14; return { q: { torso: 0.35 + 0.3 * k, plant: 'feet', head: -0.5, sh: [1.2 + 1.4 * k, 1.0 + 1.4 * k], el: [-0.3, -0.3], hip: [0.9 + 0.6 * k, 0.7 + 0.6 * k], kn: [-1.4 - 0.6 * k, -1.3 - 0.6 * k], tail: 0.8, lift: 0 }, ground: true }; }
    if (r.phase === 'done') return { q: { torso: 0.4, plant: 'feet', head: -0.3, sh: [1.2, 0.9], el: [-0.4, -0.4], hip: [1.3, 1.1], kn: [-1.9, -1.8], tail: 1, lift: 0 }, ground: true };
    if (r.phase === 'swing') {
      const C = chest(), H = handAt(), torso = -r.phi * 0.85 - r.w * 0.04, up = [Math.sin(r.phi) * dir, -Math.cos(r.phi)];
      const hands = [[H[0] - up[0] * 1.2 * s, H[1] - up[1] * 1.2 * s], [H[0] + up[0] * 1.2 * s, H[1] + up[1] * 1.2 * s]];   // one hand just above the other
      const sh = [0, 0], el = [0, 0];
      for (const i of [0, 1]) { const a = reachArm(sp.ua, sp.la, (hands[i][0] - C[0]) * dir / s, (hands[i][1] - C[1]) / s); sh[i] = a[0]; el[i] = a[1]; }
      const tk = r.tuck, trail = Math.max(-0.5, Math.min(0.5, -r.w * 0.1));
      const q = { torso, head: -0.2 - torso * 0.5, sh, el, hip: [-torso * 0.9 + trail + 1.1 * tk, -torso * 0.9 + trail + 0.7 * tk], kn: [-0.2 - 1.3 * tk, -0.15 - 1.1 * tk], plant: 'none', tail: -0.6 - r.phi, lift: 0 };
      return { q, px: C[0] - dir * Math.sin(torso) * d.tl, py: C[1] + Math.cos(torso) * d.tl };
    }
    // in the air: jumping up to a vine, or flying (maybe somersaulting) to the next vine or the floor
    const t = r.ft / Math.max(0.01, r.T), late = smoothstep((t - 0.6) / 0.4), tk = r.phase === 'fly' ? Math.max(r.tuck, 0) : 0.3 * (1 - t);
    const base = r.phase === 'jump' ? 0.1 : r.tor, R = r.spin, torso = base + R;
    let sh, el, hip, kn;
    if (r.phase === 'jump' || (!r.landing && r.phase === 'fly')) {   // reaching up and ahead for the vine
      const reach = r.phase === 'jump' ? 2.9 : lerp(2.4, 2.75, late);
      sh = [lerp(1.0, reach, Math.max(late, r.phase === 'jump' ? 1 : 0)), lerp(0.9, reach - 0.3, late)]; el = [-0.2, -0.3];
      hip = [lerp(0.3, 0.15, late), lerp(0.1, -0.1, late)]; kn = [-0.4, -0.3];
    } else {                                                           // feet forward to land, arms out for balance
      sh = [lerp(2.6, 1.6, late), lerp(2.2, 1.1, late)]; el = [-0.3, -0.4];
      hip = [lerp(0.4, 1.1, late), lerp(0.2, 0.9, late)]; kn = [lerp(-0.5, -0.9, late), lerp(-0.4, -0.7, late)];
    }
    // the tuck: knees to the chest and arms hugging the shins, strongest while spinning fastest
    sh = sh.map((a, i) => lerp(a, 0.9 + i * 0.2, tk)); el = el.map(a => lerp(a, -1.7, tk));
    hip = hip.map((a, i) => lerp(a, 2.3 - i * 0.2, tk)); kn = kn.map(a => lerp(a, -2.4, tk));
    const q = { torso, head: -0.2 + R * 0.15, sh: sh.map(a => a + R + base), el, hip: hip.map(a => a + R + base * 0.5), kn, plant: 'none', tail: 0.4, roll: R, lift: 0 };
    const mx = r.P[0], my = r.P[1], ux = Math.sin(torso), uy = -Math.cos(torso);   // rotate about the body's middle
    return { q, px: mx - dir * ux * d.tl * 0.5, py: my - uy * d.tl * 0.5 };
  };
  return r;
}
const lerp = (a, b, t) => a + (b - a) * t;
