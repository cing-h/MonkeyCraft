// MonkeyCraft ape village: the playground (village revamp, phase 6).
//
// By the river at the village's west end: a vine swing out over the water (let go, maybe somersault,
// splash in, swim back and climb out), a springy net for bounces and flips, and a climbing frame with
// a bark slide. At the east end, a fruit-toss ring: throw the fruit through the hoop, fetch it, throw it
// back. Villagers also play chase-and-tag here, and swingers ride the Canopy 2 vine course (scene.js).
// One ape at a time on each thing; the others wait their turn beside it.
//
// The crew's rule (the user's): a crew member plays only while NO job is running or waiting anywhere;
// scene.js stops their play and sends them back to their stations the moment one starts. Villagers play
// whenever they like. Pure: no clock, no randomness of its own (rnd is injected).

import { P, SPECIES, climbSpeed } from './cast.js';
import { C } from './cast.js';
import { GROUND, hash, mat } from './fb.js';
import { WATER, groundY } from './world.js';
import { VINES, VINE_G, VINE_STYLE, airPose, makeVineRider, spinAt, turnsThatFit } from './vines.js';
import { smoothstep } from './swing.js';

const lerp = (a, b, t) => a + (b - a) * t;
export const RIVER_VINE = () => VINES.find(v => v.lane === 'river');
export const NET = { x0: 66, x1: 92, y: 103 };
export const FRAME = { x: 102, top: 84, x1: 112 };
export const SLIDE = { x0: 112, y0: 84, x1: 138, y1: GROUND - 1 };
export const RING = { post: 912, x: 912, y: 86, r: 4 };
export const BANK_X = 54;
/** Where each game is played from, and who may play it. */
export const GAMES = {
  swing: { x: 20, ok: k => !!VINE_STYLE[k] },
  net: { x: 62, ok: k => k !== 'chief' },
  slide: { x: 97, ok: k => k !== 'chief' },
  toss: { x: 894, ok: () => true },
  course: { ok: k => !!VINE_STYLE[k] },   // the Canopy 2 vine course: a trip, run by scene.js
  tag: { x: 70, ok: () => true, folkOnly: true }
};
/** How fast each species can somersault on the net (rad/s; 0 never). */
const spinOf = k => k === 'chief' || k === 'archivist' ? 0 : VINE_STYLE[k]?.spin ?? 16;

/** The fixed things, painted once into the village layer. */
export function paintPlayground(mid) {
  const W = mat(C.wood), post = (x, y0, y1, r = 0.9) => mid.cap(x, y0, x, y1, r, r, W);
  // the springy net's posts (the net itself is drawn live, sagging under whoever bounces)
  post(NET.x0, NET.y - 6, GROUND); post(NET.x1, NET.y - 6, GROUND);
  // the climbing frame: a ladder up to a little platform, and the bark slide down from it
  post(FRAME.x - 2, FRAME.top, GROUND); post(FRAME.x + 2, FRAME.top, GROUND); post(FRAME.x1, FRAME.top, GROUND);
  for (let y = FRAME.top + 3; y < GROUND; y += 4) mid.rect(FRAME.x - 2, y, FRAME.x + 3, y + 1, W.b);
  mid.rect(FRAME.x - 3, FRAME.top - 1, FRAME.x1 + 1, FRAME.top + 1, W.b); for (const x of [FRAME.x - 3, FRAME.x1]) mid.rect(x, FRAME.top - 5, x + 1, FRAME.top, W.s);
  mid.rect(FRAME.x - 3, FRAME.top - 5, FRAME.x1 + 1, FRAME.top - 4, W.s);
  const bark = mat([132, 98, 62], { rim: 0.8 }), n = SLIDE.x1 - SLIDE.x0;
  for (let i = 0; i <= n; i++) { const x = SLIDE.x0 + i, y = slideY(x); mid.rect(x, y, x + 1, y + 2, i % 5 ? bark.b : bark.s); mid.put(x, y - 1, bark.r); }
  post(126, slideY(126) + 2, GROUND, 0.7);
  // the fruit-toss ring on its post, and a basket of fruit
  post(RING.post, RING.y + RING.r, GROUND, 0.8);
  for (let a = 0; a < 24; a++) { const t = a / 24 * Math.PI * 2; mid.put(RING.x + Math.cos(t) * RING.r * 0.45, RING.y + Math.sin(t) * RING.r, [214, 150, 60]); }
  mid.ell(RING.x - 26, GROUND - 1.5, 3, 1.8, mat([150, 110, 60])); mid.ell(RING.x - 27, GROUND - 3, 1, 1, mat([236, 200, 60])); mid.ell(RING.x - 25, GROUND - 3.2, 1, 1, mat([236, 120, 40]));
  // a mossy stone at the water's edge where swimmers climb out
  mid.ell(BANK_X, GROUND + 2, 4, 2, mat(C.stone));
}
export const slideY = x => SLIDE.y0 + (SLIDE.y1 - SLIDE.y0) * smoothstep((x - SLIDE.x0) / (SLIDE.x1 - SLIDE.x0)) * 0.6 + (SLIDE.y1 - SLIDE.y0) * 0.4 * ((x - SLIDE.x0) / (SLIDE.x1 - SLIDE.x0));

const dims = (key, s) => { const sp = SPECIES[key]; return { sp, tl: sp.tl * s, leg: (sp.ul + sp.ll) * s * 0.92, foot: (sp.ul + sp.ll) * 0.88 * s }; };

/**
 * One go at a game. o: { key, s, x (where it stands), rnd, sway, reduced, game (tag only) }.
 * step(dt) → null | 'splash' | 'bounce' | 'throw' | 'hoop' | 'tag' | 'done'. pose() → { q, at, facing }.
 * stop(): finish as soon as it safely can (a job has started).
 */
export function makePlay(kind, o) {
  const d = dims(o.key, o.s), sp = d.sp, g = VINE_G;
  const p = { kind, key: o.key, x: o.x, facing: 1, phase: 'approach', t: 0, ph: 0, stopping: false, flips: 0, events: [], fruit: null, netSag: 0, ripples: [] };
  const ev = e => p.events.push(e);
  const to = ph => { p.phase = ph; p.t = 0; };
  const startX = { swing: RIVER_VINE().x - 14, net: NET.x0 - 4, slide: FRAME.x - 4, toss: RING.x - 16, tag: o.x }[kind];
  p.stop = () => { p.stopping = true; };
  let rider = null, air = null, bounces = 0, plan = [], rounds = 0;

  function walkTo(x, dt, speed = sp.walk) {   // true when there
    const dx = x - p.x; p.facing = Math.sign(dx) || p.facing;
    const step = speed * dt; if (Math.abs(dx) <= step) { p.x = x; return true; }
    p.x += Math.sign(dx) * step; p.ph += step / ((sp.ul + sp.ll) * 2.4) * Math.PI * 2; return false;
  }
  // a hop or bounce: the body's middle from `from` to `to` in T seconds, with n somersaults (sign = direction)
  function launch(from, toPt, T, n) { air = { P0: from, V: [(toPt[0] - from[0]) / T, (toPt[1] - from[1] - 0.5 * g * T * T) / T], T, t: 0, n }; }
  const airMid = () => { const t = air.t; return [air.P0[0] + air.V[0] * t, air.P0[1] + air.V[1] * t + 0.5 * g * t * t]; };
  const standMid = (x, floor) => [x, floor - d.foot - d.tl * 0.5];

  p.step = dt => {
    p.events.length = 0; p.t += dt;
    for (const r of p.ripples) r.t += dt; p.ripples = p.ripples.filter(r => r.t < 1.6);
    if (p.phase === 'approach') { if (walkTo(startX, dt)) { if (p.stopping && kind !== 'tag') to('done'); else start(); } }
    else play(dt);
    if (p.phase === 'done' && !p.events.includes('done')) ev('done');
    return p.events[0] || null;
  };
  function start() {
    if (kind === 'swing') { rider = makeVineRider({ key: o.key, s: o.s, chain: [RIVER_VINE().id], x: p.x, dir: 1, sway: o.sway, rnd: o.rnd, flips: !o.reduced, landY: () => WATER + 12 }); to('ride'); }
    else if (kind === 'net') { p.facing = 1; launch(standMid(p.x, groundY(p.x)), standMid((NET.x0 + NET.x1) / 2, NET.y), 0.4, 0); to('hop'); plan = o.reduced ? [5, 8, 6] : [6, 11, 16, 21, 24, 14].slice(0, 4 + Math.floor(o.rnd() * 3)); }
    else if (kind === 'slide') { p.facing = 1; p.climbY = groundY(p.x) - d.leg; to('climb'); }
    else if (kind === 'toss') { p.facing = 1; rounds = 2 + Math.floor(o.rnd() * 2); to('wind'); }
    else if (kind === 'tag') to('tag');
  }
  function play(dt) {
    switch (p.phase) {
      // ---- the river swing ----
      case 'ride': {
        const e = rider.step(dt); p.x = rider.mid()[0]; p.facing = rider.dir;
        if (e === 'release') p.flips += rider.turns ? 1 : 0;
        if (rider.done()) { ev('splash'); p.ripples.push({ x: p.x, t: 0 }); p.swimY = WATER + 3; to('swim'); }
        break;
      }
      case 'swim': if (walkTo(BANK_X, dt, (p.stopping ? 1.6 : 1) * 9)) to('climbout'); if (p.t % 0.8 < dt) p.ripples.push({ x: p.x, t: 0, small: true }); break;
      case 'climbout': p.ph += dt * sp.cl.freq; if (p.t >= 0.8) to('shake'); break;
      case 'shake': if (p.t >= (p.stopping ? 0.2 : 1.1)) to('done'); break;
      // ---- the springy net ----
      case 'hop': case 'air': {
        air.t = Math.min(air.T, air.t + dt); p.x = airMid()[0];
        if (air.t >= air.T) {
          if (p.phase === 'air' && air.out) { to('land'); break; }
          ev('bounce'); p.netSag = 3 + (plan[bounces - 1] || 5) * 0.25; to('squash');
        }
        break;
      }
      case 'squash': {   // sink into the net, then it throws the ape back up
        if (p.t < 0.12) break;
        const h = p.stopping ? null : plan[bounces++];
        const cx = (NET.x0 + NET.x1) / 2, from = standMid(p.x, NET.y);
        if (h === undefined || h === null) { launch(from, standMid(NET.x1 + 6, groundY(NET.x1 + 6)), 0.45, 0); air.out = true; to('air'); break; }
        const vy = Math.sqrt(2 * g * h), T = 2 * vy / g, n = o.reduced ? 0 : turnsThatFit(T, spinOf(o.key), o.rnd, o.key === 'scout' ? 0.3 : 0);
        launch(from, standMid(cx + (o.rnd() - 0.5) * 4, NET.y), T, n * (o.rnd() < 0.5 ? -1 : 1)); if (n) p.flips++;
        to('air'); break;
      }
      case 'land': if (p.t >= 0.28) to('done'); break;
      // ---- the climbing frame and the bark slide ----
      case 'climb': { const top = FRAME.top - d.leg; p.ph += dt * sp.cl.freq; p.climbY -= climbSpeed(sp) * dt; p.x = FRAME.x - 4; if (p.climbY <= top) { p.climbY = undefined; p.x = FRAME.x; to('top'); } break; }
      case 'top': if (walkTo(SLIDE.x0 - 1, dt, sp.walk * 0.6) && p.t > 0.5) { p.v = 0; to('slide'); } break;
      case 'slide': { const k = (SLIDE.y1 - SLIDE.y0) / (SLIDE.x1 - SLIDE.x0); p.v = Math.min(60, p.v + g * 0.25 * k * dt); p.x += p.v * dt; if (p.x >= SLIDE.x1) { p.x = SLIDE.x1; to('land'); } break; }
      // ---- the fruit-toss ring ----
      case 'wind': if (p.t >= 0.3) { throwFruit(); to('follow'); } break;
      case 'follow': {   // watch it go, then fetch it
        const f = p.fruit; flyFruit(dt);
        if (f.rest && walkTo(f.x - p.facing * 3, dt, sp.walk * 1.3)) to('pick');
        break;
      }
      case 'pick': if (p.t >= 0.4) { p.fruit = null; if (--rounds <= 0 || p.stopping) to('done'); else { p.facing = -p.facing; to('wind'); } } break;
      // ---- chase-and-tag (villagers): `game` is shared by everyone playing ----
      case 'tag': {
        const gm = o.game; if (!gm || gm.over || p.stopping) { to('done'); break; }
        if (p.freeze > 0) { p.freeze -= dt; break; }
        if (!gm.it) break;   // waiting for someone to play with
        if (gm.it === p) {
          const prey = gm.players.filter(q => q !== p && !(q.freeze > 0)).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
          if (!prey) break;
          walkTo(prey.x, dt, sp.run * 0.95);
          if (Math.abs(prey.x - p.x) < 3) { gm.it = prey; prey.freeze = 0.8; ev('tag'); }
        } else {
          if (p.goal === undefined || Math.abs(p.goal - p.x) < 2 || Math.abs(gm.it.x - p.x) < 14 && Math.sign(p.goal - p.x) === Math.sign(gm.it.x - p.x)) p.goal = gm.it.x < p.x ? Math.min(140, p.x + 20 + o.rnd() * 40) : Math.max(20, p.x - 20 - o.rnd() * 40);
          walkTo(p.goal, dt, sp.run * (Math.abs(gm.it.x - p.x) < 20 ? 1 : 0.4));
        }
        break;
      }
    }
  }
  function throwFruit() {   // through the hoop at the top of its arc
    const hx = p.x + p.facing * 3, hy = groundY(p.x) - d.leg - d.tl * 1.1, vy = -Math.sqrt(2 * g * Math.max(4, hy - RING.y)), ta = -vy / g;
    p.fruit = { x: hx, y: hy, vx: (RING.x - hx) / ta, vy, c: o.rnd() < 0.5 ? [236, 200, 60] : [236, 120, 40], hoop: false, bounced: false, rest: false };
    ev('throw');
  }
  function flyFruit(dt) {
    const f = p.fruit; if (f.rest) return;
    const px = f.x; f.vy += g * dt; f.x += f.vx * dt; f.y += f.vy * dt;
    if (!f.hoop && (px - RING.x) * (f.x - RING.x) <= 0) { f.hoop = true; ev('hoop'); }
    const gy = groundY(f.x) - 1;
    if (f.y >= gy) { f.y = gy; if (!f.bounced) { f.bounced = true; f.vy *= -0.35; f.vx *= 0.5; } else f.rest = true; }
  }

  /** The pose and where to draw it. */
  p.pose = () => {
    const t = p.t;
    switch (p.phase) {
      case 'approach': case 'top': return { q: p.phase === 'top' && p.x >= SLIDE.x0 - 1.5 ? P.sit(sp, t) : P.walk(sp, p.ph), at: { mode: 'ground', x: p.x, y: p.phase === 'top' ? FRAME.top : groundY(p.x) } };
      case 'ride': { const r = rider.pose(); return r.ground ? { q: r.q, at: { mode: 'ground', x: p.x, y: groundY(p.x) } } : { q: r.q, at: { mode: 'pelvis', x: r.px, y: r.py } }; }
      case 'swim': { const s = t * 5; return { q: { torso: 1.0, plant: 'none', head: -0.9, sh: [2.2 + Math.sin(s) * 0.9, 2.2 - Math.sin(s) * 0.9], el: [-0.6, -0.6], hip: [-0.2 + Math.sin(s) * 0.3, -0.2 - Math.sin(s) * 0.3], kn: [-0.4, -0.4], tail: -0.3, lift: 0 }, at: { mode: 'pelvis', x: p.x, y: p.swimY + Math.sin(t * 3) * 0.6 } }; }
      case 'climbout': { const k = smoothstep(t / 0.8); return { q: P.climb(sp, p.ph, false), at: { mode: 'pelvis', x: p.x, y: lerp(p.swimY, groundY(p.x) - d.leg, k) } }; }
      case 'shake': { const q = P.stand(sp, t); q.torso += Math.sin(t * 40) * 0.12 * (1 - t / 1.1); q.head = Math.sin(t * 40 + 1) * 0.4 * (1 - t / 1.1); return { q, at: { mode: 'ground', x: p.x, y: groundY(p.x) } }; }
      case 'hop': case 'air': {
        const u = air.t / air.T, n = air.n || 0, R = (n < 0 ? 1 : -1) * spinAt(air.t, air.T, Math.abs(n));
        const tk = n ? Math.sin(Math.PI * Math.max(0, Math.min(1, (air.t - 0.06) / Math.max(0.01, air.T - 0.2)))) : 0.15;
        const r = airPose({ reach: 'land', late: smoothstep((u - 0.55) / 0.45), tuck: tk, base: 0.1, spin: R % (Math.PI * 2), mid: airMid(), dir: p.facing, tl: d.tl });
        return { q: r.q, at: { mode: 'pelvis', x: r.px, y: r.py } };
      }
      case 'squash': return { q: P.land(sp, 1 - t / 0.12), at: { mode: 'ground', x: p.x, y: NET.y + p.netSag * (1 - t / 0.12) } };
      case 'land': return { q: P.land(sp, Math.max(0, 1 - t / 0.28)), at: { mode: 'ground', x: p.x, y: groundY(p.x) } };
      case 'climb': return { q: P.climb(sp, p.ph, false), at: { mode: 'pelvis', x: p.x, y: p.climbY } };
      case 'slide': { const q = P.sit(sp, t); q.sh = [2.6, 2.4]; q.el = [-0.3, -0.3]; q.hip = [1.3, 1.2]; q.kn = [-0.3, -0.2]; q.torso = -0.15; return { q, at: { mode: 'ground', x: p.x, y: slideY(p.x) } }; }
      case 'wind': { const k = t / 0.3, q = P.stand(sp, t); q.sh = [lerp(1.0, 3.0, k), 0.5]; q.el = [-0.6, -0.3]; return { q, at: { mode: 'ground', x: p.x, y: groundY(p.x) } }; }
      case 'follow': { const q = p.fruit.rest ? P.walk(sp, p.ph) : P.look(sp, t); if (!p.fruit.rest && t < 0.3) { q.sh = [lerp(3.0, 0.8, t / 0.3), 0.5]; q.el = [-0.2, -0.3]; } return { q, at: { mode: 'ground', x: p.x, y: groundY(p.x) } }; }
      case 'pick': return { q: P.land(sp, 0.6), at: { mode: 'ground', x: p.x, y: groundY(p.x) } };
      case 'tag': return { q: p.freeze > 0 ? P.wave(sp, t) : o.game?.it ? P.run(sp, p.ph) : P.look(sp, t), at: { mode: 'ground', x: p.x, y: groundY(p.x) } };
      default: return { q: P.stand(sp, t), at: { mode: 'ground', x: p.x, y: groundY(p.x) } };
    }
  };
  /** Is the body on screen at world height y (for the camera)? */
  p.y = () => p.phase === 'ride' ? rider.mid()[1] : p.phase === 'climb' ? p.climbY : groundY(p.x) - 10;
  p.done = () => p.phase === 'done';
  p.rider = () => rider;
  return p;
}

/** A game of tag among some villagers: whoever is `it` chases the nearest; a tag passes it on. */
export function makeTag(seconds = 18) { return { players: [], it: null, t: seconds, wait: 25, over: false }; }
/** The game starts once two players have arrived; it ends after its time, or if nobody turns up to play. */
export function stepTag(gm, dt) {
  if (gm.over) return;
  gm.players = gm.players.filter(q => !q.done());
  if (gm.players.length >= 2) { gm.t -= dt; if (!gm.players.includes(gm.it)) gm.it = gm.players[0]; }
  else if (gm.it) gm.over = true; else if ((gm.wait -= dt) <= 0) gm.over = true;
  if (gm.t <= 0) gm.over = true;
}

/** Live drawing: the net (before the apes), and fruit (after them). fb.ox must be the camera. */
export function drawNet(fb, plays, cam) {
  const user = plays.find(p => p.kind === 'net' && p.phase !== 'approach' && p.phase !== 'done');
  const sag = user ? (user.phase === 'squash' ? user.netSag * (1 - user.t / 0.12) : 0) : 0, ux = user ? user.x : 0;
  for (let x = NET.x0; x <= NET.x1; x++) {
    const f = (x - NET.x0) / (NET.x1 - NET.x0), y = NET.y + Math.sin(Math.PI * f) * (0.8 + sag * Math.exp(-((x - ux) ** 2) / 60));
    fb.put(x - cam, y, x % 2 ? [190, 170, 120] : [150, 128, 88]);
    if (x % 3 === 0) fb.put(x - cam, y + 1, [120, 100, 70]);
  }
}
export function drawFruit(fb, plays, cam) {
  for (const p of plays) if (p.fruit) { fb.put(p.fruit.x - cam, p.fruit.y, p.fruit.c); fb.put(p.fruit.x - cam + 1, p.fruit.y, p.fruit.c); fb.put(p.fruit.x - cam, p.fruit.y - 1, [80, 140, 60]); }
}
/** Rings spreading on the water where a swimmer went in (after the lagoon is drawn). */
export function drawRipples(fb, plays, cam) {
  for (const p of plays) for (const r of p.ripples) {
    const rad = 2 + r.t * (r.small ? 4 : 9), a = (1 - r.t / 1.6) * (r.small ? 0.25 : 0.5);
    for (let k = -rad; k <= rad; k++) { const y = WATER + 1 + Math.round(Math.sqrt(Math.max(0, 1 - (k / rad) ** 2)) * rad * 0.18); fb.add(r.x + k - cam, y, [200, 220, 230], a * (hash(k | 0, 3) < 0.7 ? 1 : 0.3)); }
  }
}
