// MonkeyCraft — the ape village: the app's main screen (a 2D side-scroller).
//
// Look: a tiny 320×180 frame scaled up, no outlines, soft shading in a few flat
// tones with a sunlit rim (after "Beatrice"); a lush tropical village on an
// earth bank above a reflecting lagoon, with layered hazy jungle behind and a
// frame of foliage in front (after Kingdom Two Crowns).
//
// Truthful station: each crew member's mode comes ONLY from modeOf(id, now),
// which the app derives from the event stream (see ../state.js):
//   idle    → wanders the ground and the canopy (walk, climb, swing)
//   ready / talking / error / asking → hurries home and waits at its door (… ! ? plates)
//   working → goes inside; its windows glow in its colour
//   asleep  → sleeps on its doorstep (Z plate)
// The background monkeys on the far branch are villagers: scenery, never crew.

import { makeToucan, drawToucan } from './toucan.js';
import { FB, GROUND, H, STORIES, SUN, TOP, W, WORLD, hash, mat, mixc } from './fb.js';
import { AGILE, CREW, LIGHT, P, SPECIES, TAU, blendPose, bodyLen, drawApe, placeApe, pos } from './cast.js';
import { noise1 } from './scenery.js';
import { DOORS, PERCH_Y, TRUNKS, WATER, branchY, buildLayers, groundY } from './world.js';
import { makeVillagers, stepVillager, villagerPose } from './villagers.js';
import { buildFrame, drawVines } from './frame.js';
import { makeBrachiator, stepPose, brachiatePose } from './swing.js';
import { makeChatter } from './chatter.js';
import { LADDER_X, makeChiefIdle } from './chief.js';
import { climbLevel, hangs, holdY, pickWander, route, surfaceY } from './lanes.js';
import { FOLK } from './villagers.js';
import { DELIVERIES, RING, TRADES, gourd, makeGatherings } from './culture.js';
import { walkY } from './canopy.js';


// ---------- 5×5 plate glyphs ----------
export const GLYPH = { '?': ['01110', '10001', '00110', '00000', '00100'], '!': ['00100', '00100', '00100', '00000', '00100'], '…': ['00000', '00000', '00000', '00000', '10101'], 'Z': ['11111', '00010', '00100', '01000', '11111'] };
export const PLATE = { asking: ['?', [242, 197, 49]], error: ['!', [255, 90, 90]], talking: ['…', [232, 227, 240]], asleep: ['Z', [143, 180, 255]] };


/**
 * The village scene. modeOf(key, now) → 'idle' | 'asleep' | 'ready' | 'talking' | 'error' | 'asking' | 'working'.
 */
export const CREW_IDS = CREW;
export const SCENE_W = W, SCENE_H = H;

export function makeStation(canvas, { modeOf, reduced = false }) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(W, H), fb = new FB(W, H);
  const L = buildLayers(), frame = buildFrame(), villagers = makeVillagers(L.back.w);
  let t = 0, cam = 330, camY = 0, goalY = null, seed = 11;   // camY: the world y at the top of the screen (0 = the ground village)
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const sparks = [];
  const chatter = makeChatter({ rnd: () => rnd() }), vheads = [];   // vheads: villagers' heads on screen, from the last frame
  let chat = [];
  const leaves = [];   // leaves shaken loose by a catch: { x, y, vx, vy, life, par (parallax of their layer), c }
  const shake = (x, y, par, n) => { for (let i = 0; i < n; i++) leaves.push({ x: x + (rnd() - 0.5) * 6, y: y - rnd() * 2, vx: (rnd() - 0.5) * 8, vy: -4 - rnd() * 6, life: 1.4 + rnd() * 0.8, par, ph: rnd() * 6, c: rnd() < 0.5 ? [86, 140, 62] : [124, 170, 78] }); };
  // a swing along the low branch or under a canopy walkway (see swing.js)
  const crewBrachiator = (a, sp) => { const g = AGILE[sp.canopy], lane = a.lane; return makeBrachiator({ R: (sp.ua + sp.la) * 0.9 * a.s, halfPeriod: g.T * Math.sqrt(a.s), amp: g.amp, ricochet: sp.canopy === 'brachiate-fast', branchY: x => holdY(lane, x), x0: a.x, lo: 30, hi: WORLD - 30, dir: a.facing || 1 }); };
  const toucan = makeToucan();
  const flies = Array.from({ length: 5 }, (_, i) => ({ x: 100 + i * 180, y: 90, c: [[255, 170, 40], [90, 160, 255], [255, 110, 200], [250, 230, 80], [120, 220, 160]][i], ph: i * 1.7 }));
  const ID = Object.fromEntries(CREW.map((k, i) => [k, i + 1]));
  const actors = {};
  const newActor = (key, lane, x, extra = {}) => ({ key, lane, x, legs: [], facing: -1, phase: rnd() * 6, spd: 0, anim: 'stand', prev: null, q: null, blend: 1, wait: 1 + rnd() * 3, inside: false, atDoor: true, mode: 'idle', tailA: 0.5, tailV: 0, idle: 'stand', idleT: 2 + rnd() * 3, s: 1, ...extra });
  for (const k of CREW) actors[k] = newActor(k, DOORS[k].lane, DOORS[k].x);
  // free-roaming villagers: scenery that lives in the village layer and travels all three stories like the crew.
  // Smaller, with no glow, no tools and no plates, so they're never mistaken for the crew.
  const folk = FOLK.map((f, i) => { const x = 60 + hash(i, 17) * 840; return newActor(f.key, f.home, x, { folk: true, s: 0.8, home: { lane: f.home, x }, trade: f.trade, wait: 2 + i * 1.5 }); });
  const everyone = [...Object.values(actors), ...folk];
  const strideOf = sp => (sp.posture === 'biped' ? 2.6 : 2.2) * (sp.ul + sp.ll);
  // Plan a trip as legs: walk/swing along a lane, climb a trunk or the lodge ladder, or drop from the canopy.
  // top: a swinger climbs up onto the walkway at the end (to sit at the Ring, say), instead of hanging under it
  const topY = (lane, x) => walkY(lane === 'c1' ? 1 : 2, x) - 5;
  const mount = (a, lane, x, up) => { const sp = SPECIES[a.key], hang = climbLevel(lane, x, sp), top = topY(lane, x); return { k: 'climb', x, dx: 0, from: lane, to: lane, y0: up ? hang : top, y1: up ? top : hang, top: up }; };
  function plan(a, lane, x, { top = false } = {}) {
    const cl = a.climbY !== undefined && a.legs[0] && a.legs[0].k === 'climb' ? a.legs[0] : null;
    const legs = [], sp = SPECIES[a.key];
    let from = a.lane, at = a.x;
    if (cl && cl.y0 !== undefined) legs.push({ ...cl, y0: cl.y1, y1: cl.y0, top: !cl.top });   // caught climbing onto or off a walkway: undo it
    else if (cl) {   // caught mid-climb: carry on, or turn round if the new trip goes back where the climb started
      const back = lane === cl.from;
      legs.push(back ? { ...cl, from: cl.to, to: cl.from } : cl); from = back ? cl.from : cl.to; at = cl.x - (cl.dx || 0);
    } else if (a.top) legs.push(mount(a, a.lane, a.x, false));   // up on a walkway: climb back down under it first
    const trip = route(from, at, lane, x);
    if (top && hangs(lane, sp)) trip.push(mount(a, lane, x, true));
    a.legs = [...legs, ...trip];
  }
  function setAnim(a, anim, blendT = 0.22) { if (a.anim !== anim) { a.prev = a.q; a.blend = 0; a.anim = anim; a.blendT = blendT; } }

  // The Chief's free time (chief.js): rest poses on the lodge platform, and now and then a stroll through the village.
  const chiefIdle = makeChiefIdle({ rnd: () => rnd(), reduced });
  function chiefFree(a, dt) {
    if (a.lane !== 'perch') {                      // on a stroll: have a look round, then climb back up to the lodge
      if ((a.linger -= dt) > 0) return;
      plan(a, 'perch', LADDER_X - 8); a.rest = null; chiefIdle.interrupt(); return;
    }
    const act = chiefIdle.step(dt); if (!act) return;
    if (act.kind === 'rest') { a.rest = act; a.legs = [{ k: 'move', x: act.x }]; }
    else { a.rest = null; a.linger = act.linger; plan(a, act.lane || 'ground', act.x); }
  }

  // ---------- the villagers' trades and the gatherings at the Ring (scenery, see culture.js) ----------
  // A task: go to (lane, x), then hold a pose there for t seconds. `top`: sit on the walkway, not under it.
  function tradeTasks(a) {
    const tr = TRADES[a.trade];
    if (a.trade === 'courier') { const to = DELIVERIES[Math.floor(rnd() * DELIVERIES.length)]; return [{ lane: tr.lane, x: tr.x, anim: 'look', facing: tr.facing, t: 2.5, carry: true }, { lane: to.lane, x: to.x, anim: 'look', facing: 1, t: 2, carry: false, top: true }]; }
    return [{ lane: tr.lane, x: tr.x, anim: tr.anim, facing: tr.facing, t: 20 + rnd() * 25, top: true }];
  }
  function doTask(a, dt) {
    const k = a.tasks[0];
    if (!k.arrived) {
      const there = a.lane === k.lane && Math.abs(a.x - k.x) < 1 && (!k.top || a.top || !hangs(k.lane, SPECIES[a.key]));
      if (there) k.arrived = true; else { plan(a, k.lane, k.x, { top: k.top }); return; }
    }
    if ((k.t -= dt) > 0) return;
    if ('carry' in k) a.carry = k.carry;
    a.tasks.shift(); if (!a.tasks.length) { a.tasks = null; a.wait = 2 + rnd() * 3; if (a.key === 'chief') a.linger = 0; }
  }
  const gatherings = makeGatherings({ rnd: () => rnd(), reduced });
  let gathering = false;
  function startGathering() {
    const seats = [...RING.seats].sort(() => rnd() - 0.5), drum = seats.find(s => s.drum), rest = seats.filter(s => !s.drum);
    const crew = CREW.map(k => actors[k]).filter(a => a.mode === 'idle' && rnd() < (a.key === 'chief' ? 0.5 : 0.45)).slice(0, 3);   // free crew may join; busy crew never do
    const sit = (a, seat, anim) => { a.tasks = [{ gather: true, lane: 'c1', x: seat.x, anim, facing: seat.facing, t: Infinity, top: true }]; a.rest = null; };
    crew.forEach(a => sit(a, rest.shift(), 'sit'));
    folk.forEach((a, i) => { const seat = i === 0 ? drum : rest.shift(); if (seat) sit(a, seat, seat.drum ? 'drum' : 'sit'); a.carry = false; });
  }
  function endGathering() { for (const a of everyone) if (a.tasks?.[0]?.gather) { a.tasks = null; a.wait = 1 + rnd() * 4; if (a.key === 'chief') a.linger = 0; } }
  let lanternsLit = 0; const flares = [];

  function update(dt, now) {
    const g = gatherings.step(dt); if (g && !gathering) startGathering(); if (!g && gathering) endGathering(); gathering = g;
    for (const a of everyone) {
      const sp = SPECIES[a.key], mode = a.folk ? 'idle' : modeOf(a.key, now), d = a.folk ? a.home : DOORS[a.key];
      a.mode = mode; a.blend = Math.min(1, a.blend + dt / (a.blendT || 0.22));
      if (mode !== 'working') a.inside = false;
      if (mode === 'asleep') { Object.assign(a, { lane: d.lane, x: d.x, legs: [], sw: null, air: null, atDoor: true, climbY: undefined, rest: null, top: false, tasks: null }); setAnim(a, 'sleep'); continue; }
      const home = mode !== 'idle';
      if (a.key === 'chief' && home && !a.called) { a.called = true; a.rest = null; chiefIdle.interrupt(); }   // a job sends him straight back to his station
      if (!home) a.called = false; else if (a.tasks) a.tasks = null;   // a job comes before any gathering
      const last = a.legs[a.legs.length - 1], goingHome = last && last.home;
      if (home && !goingHome && !(a.atDoor && a.lane === d.lane)) { plan(a, d.lane, d.x); a.legs[a.legs.length - 1].home = true; }
      if (!home && goingHome && !a.air && !(a.br && a.br.mode === 'flight') && a.anim !== 'climb') a.legs = [];
      if (!home && !a.legs.length && !a.air && a.tasks?.length) doTask(a, dt);
      else if (!home && !a.legs.length && !a.air && a.key === 'chief' && !a.folk) chiefFree(a, dt);
      else if (!home && !a.legs.length && !a.air) {
        a.wait -= dt;
        if (a.wait <= 0) {
          if (a.folk && rnd() < 0.5) a.tasks = tradeTasks(a);   // villagers ply their trades
          else { const go = pickWander(sp, a.lane, rnd, a.folk ? a.home.lane : null); plan(a, go.lane, go.x); }
          a.wait = (a.folk ? 4 : 2) + rnd() * 4;
        }
      }
      const leg = a.legs[0];
      if (a.land > 0) { a.land -= dt; setAnim(a, 'land'); }
      else if (a.air) {                                     // a leap down from the canopy
        const r = a.air; r.vy += 170 * dt; r.x += r.vx * dt; r.y += r.vy * dt; a.x = r.x; setAnim(a, 'leap');
        if (r.y >= groundY(a.x)) { a.lane = 'ground'; a.air = null; a.land = 0.28; a.spd *= 0.4; a.legs.shift(); }
      } else if (leg && leg.k === 'drop') {
        if (a.br) {                                        // let go of the branch: the swing's own speed carries into the fall
          const [cx, cy] = a.br.chest(), [vx, vy] = a.br.velocity();
          a.air = { x: cx, y: cy + sp.tl, vx: Math.max(-40, Math.min(40, vx || a.facing * 10)), vy: Math.min(20, vy) }; a.facing = Math.sign(a.air.vx) || a.facing; a.br = null; setAnim(a, 'leap');
        } else {                                           // a branch-walker crouches, then jumps down
          a.prepT = (a.prepT ?? 0.16) - dt; setAnim(a, 'land');
          if (a.prepT <= 0) { a.prepT = undefined; a.air = { x: a.x, y: branchY(a.x) - 2, vx: a.facing * (12 + sp.walk * 0.6), vy: -26 }; }
        }
      } else if (leg && leg.k === 'move') {
        a.atDoor = false;
        const dx = leg.x - a.x, dir = Math.sign(dx) || a.facing;
        if (hangs(a.lane, sp) && !a.top) {                           // swinging along a branch or under a walkway: a real pendulum (swing.js)
          if (!a.br) a.br = crewBrachiator(a, sp);
          if (a.br.target !== leg.x) a.br.travelTo(leg.x, home);
          if (a.br.step(dt, rnd) === 'catch') shake(a.br.hx, holdY(a.lane, a.br.hx), 1, a.br.ricochet ? 5 : 2);
          stepPose(a.br, sp, a.s, dt);
          a.x = a.br.chest()[0]; a.facing = a.br.dir; setAnim(a, 'brach');
          if (a.br.arrived()) { a.legs.shift(); if (leg.home) a.atDoor = true; if (!a.legs.length || a.legs[0].k !== 'move') a.br.travelTo(null); }
        } else {
          const run = home, target = (a.lane === 'canopy' ? (run ? sp.run * 0.9 : sp.walk * 1.1) : (run ? sp.run : sp.walk));
          const brake = Math.sqrt(2 * 50 * Math.abs(dx));
          a.spd = Math.min(brake + 2, a.spd + Math.sign(target - a.spd) * Math.min(Math.abs(target - a.spd), 55 * dt));
          const step = a.spd * dt;
          a.facing = dir;
          setAnim(a, a.spd > (sp.walk + sp.run) * 0.5 ? 'run' : a.spd > 0.5 ? 'walk' : 'stand');
          a.phase += step / strideOf(sp) * TAU * (a.anim === 'run' ? 0.8 : 1);
          if (Math.abs(dx) <= Math.max(step, 0.3)) { a.x = leg.x; a.legs.shift(); if (!a.legs.length) a.spd = 0; if (leg.home) a.atDoor = true; } else a.x += dir * step;   // the last leg of a trip home ends at the door
        }
      } else if (leg && leg.k === 'climb') {
        a.br = null; a.x = leg.x - (leg.dx || 0); a.facing = 1; setAnim(a, 'climb');
        const y0 = leg.y0 ?? climbLevel(leg.from || 'ground', leg.x, sp), y1 = leg.y1 ?? climbLevel(leg.to || 'canopy', leg.x, sp), dir = Math.sign(y1 - y0) || -1;
        a.climbY = a.climbY ?? y0;
        const surge = 0.3 + 0.7 * pos(Math.sin(a.phase + Math.PI)), step = (home ? 30 : 14) * (dir > 0 ? 1.25 : 1) * surge * dt;   // a little quicker going down, and hurrying home
        a.phase += dt * (home ? 7 : 5);
        if ((y1 - a.climbY) * dir <= step) { a.lane = leg.to || 'canopy'; a.top = !!leg.top; a.climbY = undefined; a.legs.shift(); a.spd = 0; } else a.climbY += dir * step;
      } else {
        // standing still: hold a hang, or idle on the ground / branch
        if (hangs(a.lane, sp) && !a.top) {
          if (!a.br) a.br = crewBrachiator(a, sp);                // hang and settle, swaying gently
          if (a.br.target !== null) a.br.travelTo(null);
          a.br.step(dt, rnd); stepPose(a.br, sp, a.s, dt);
          a.x = a.br.chest()[0]; setAnim(a, 'brach');
        } else {
          a.spd = 0;
          if (a.lane === d.lane && Math.abs(a.x - d.x) < 0.5) a.atDoor = true;
          if (home && a.atDoor) a.facing = a.key === 'chief' ? 1 : -1;
          const job = a.tasks?.[0];
          if (job?.arrived && !home) { a.facing = job.facing; setAnim(a, job.anim, 0.35); }
          else if (a.key === 'chief' && !a.folk) {        // on his platform or out on a stroll; he keeps his dignity when asking
            if (!home && a.rest && a.lane === 'perch') { a.facing = a.rest.facing; setAnim(a, a.rest.pose, chiefIdle.timing.blend); }
            else setAnim(a, home ? (mode === 'talking' ? 'talk' : 'stand') : a.lane === 'ground' ? 'look' : 'stand');
          } else {
            a.idleT -= dt; if (a.idleT <= 0) { a.idle = ['stand', 'look', 'sit', 'scratch', 'stand'][Math.floor(rnd() * 5)]; a.idleT = 2.5 + rnd() * 3; }
            setAnim(a, home ? (mode === 'asking' ? 'wave' : mode === 'error' ? 'slump' : mode === 'talking' ? 'talk' : 'stand') : (a.lane === 'canopy' ? 'stand' : a.idle));
          }
        }
      }
      a.inside = mode === 'working' && a.atDoor;
      if (a.inside && a.key === 'smith' && t - (a.ls || 0) > 0.1) { a.ls = t; sparks.push({ x: 187.5 + (rnd() - 0.5) * 3, y: 57, vx: (rnd() - 0.5) * 6, vy: -10 - rnd() * 8, life: 1.2, c: [255, 150, 60], g: -2 }); }
      if (a.inside && a.key === 'sage' && t - (a.ls || 0) > 0.15) { a.ls = t; sparks.push({ x: 762 + rnd() * 28, y: GROUND - 2, vx: (rnd() - 0.5) * 2, vy: -6 - rnd() * 4, life: 1.6, c: [210, 220, 230], g: 0, steam: true }); }
      // the tail follows its pose like a spring: it swings and settles on its own
      const want = a.q ? (a.q.tail ?? 0.5) : 0.5; a.tailV += ((want - a.tailA) * 60 - a.tailV * 9) * dt; a.tailA += a.tailV * dt;
    }
    // chatter: who is where on screen, and what mode each crew member is in (scenery only, see chatter.js)
    const speakers = [];
    for (const k of CREW) { const h = heads[k], a = actors[k]; if (h && !a.inside) speakers.push({ ref: `crew:${k}`, kind: 'crew', species: k, mode: a.mode, x: h.headX - cam, y: h.headY }); }
    villagers.forEach((v, i) => { if (vheads[i]) speakers.push({ ref: `v:${i}`, kind: 'villager', species: v.key, mode: 'idle', x: vheads[i].x, y: vheads[i].y }); });
    folk.forEach((a, i) => { const h = fheads[i]; if (h) speakers.push({ ref: `f:${i}`, kind: 'villager', species: a.key, mode: 'idle', x: h.headX - cam, y: h.headY }); });
    chat = reduced ? [] : chatter.step(dt, { speakers });
    for (const v of villagers) if (stepVillager(v, dt, rnd) === 'catch') shake(v.b.hx, v.b.branchY(v.b.hx), 0.55, v.fast ? 3 : 1);
    for (let i = leaves.length - 1; i >= 0; i--) { const l = leaves[i]; l.life -= dt; l.ph += dt * 5; l.vy = Math.min(9, l.vy + 18 * dt); l.vx *= 0.97; l.x += (l.vx + Math.sin(l.ph) * 6) * dt; l.y += l.vy * dt; if (l.life <= 0 || l.y > WATER) leaves.splice(i, 1); }
    toucan.update(dt);
    for (const f of flies) { f.ph += dt; f.x += Math.sin(f.ph * 0.7) * 10 * dt + 4 * dt; f.y = 92 + Math.sin(f.ph * 1.3) * 8 + Math.sin(f.ph * 5) * 1.5; if (f.x > WORLD) f.x = 0; }
    for (let i = flares.length - 1; i >= 0; i--) if ((flares[i].life -= dt) <= 0) flares.splice(i, 1);
    for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.life -= dt; s.vy += s.g * dt; s.x += s.vx * dt; s.y += s.vy * dt; if (s.life <= 0) sparks.splice(i, 1); }
  }

  function poseFor(a) {
    const sp = SPECIES[a.key];
    switch (a.anim) {
      case 'walk': return P.walk(sp, a.phase);
      case 'run': return P.run(sp, a.phase);
      case 'climb': return P.climb(sp, a.phase);
      case 'brach': return brachiatePose(sp, a.br, a.s, { fast: sp.canopy === 'brachiate-fast' }).q;
      case 'leap': return P.leap(sp, a.air ? a.air.vy : 0);
      case 'land': return P.land(sp, Math.max(0, a.land / 0.28));
      default: return (P[a.anim] || P.stand)(sp, t);
    }
  }

  const heads = {}, fheads = [];
  // A soft glowing outline round each crew member, so the agents stand out from the scenery.
  // Pixels just outside an ape are eased toward a warm light tinted with its own colour:
  // strongest one pixel out, fading by two. Background villagers never glow, so they read as scenery.
  const GLOW_RING = [[1, 0, 0.62], [-1, 0, 0.62], [0, 1, 0.62], [0, -1, 0.62], [1, 1, 0.42], [-1, 1, 0.42], [1, -1, 0.42], [-1, -1, 0.42],
    [2, 0, 0.24], [-2, 0, 0.24], [0, 2, 0.24], [0, -2, 0.24], [2, 1, 0.15], [-2, 1, 0.15], [2, -1, 0.15], [-2, -1, 0.15], [1, 2, 0.15], [-1, 2, 0.15], [1, -2, 0.15], [-1, -2, 0.15]];
  const GLOW_C = CREW.map(k => mixc([255, 238, 200], LIGHT[k], 0.35));
  const glowW = new Float32Array(W * H), glowWho = new Uint8Array(W * H), glowHit = [];
  function glowOutline() {
    const id = fb.id, d = fb.d;
    // stamp the ring round every crew pixel, keeping the strongest weight each neighbour gets
    for (let i = 0; i < id.length; i++) {
      const n = id[i]; if (n <= 0) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy, k] of GLOW_RING) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx; if (id[j] > 0 || k <= glowW[j]) continue;
        if (!glowW[j]) glowHit.push(j);
        glowW[j] = k; glowWho[j] = n;
      }
    }
    for (const j of glowHit) {
      const w = glowW[j], c = GLOW_C[glowWho[j] - 1], o = j * 4;
      d[o] += (c[0] - d[o]) * w; d[o + 1] += (c[1] - d[o + 1]) * w; d[o + 2] += (c[2] - d[o + 2]) * w;
      glowW[j] = 0;
    }
    glowHit.length = 0;
  }

  // copy the on-screen part of a pre-painted layer; `fixed` layers stay put on the screen (the foliage frame)
  const blit = (src, f, fixed = false) => {
    const off = Math.round(cam * f), top = fixed ? 0 : fb.oy;
    for (let y = 0; y < H; y++) {
      const sy = y + top - src.oy; if (sy < 0 || sy >= src.h) continue;
      for (let x = 0; x < W; x++) {
        const sx = x + off; if (sx < 0 || sx >= src.w) continue;
        const so = (sy * src.w + sx) * 4; if (!src.d[so + 3]) continue;
        const o = (y * W + x) * 4; fb.d[o] = src.d[so]; fb.d[o + 1] = src.d[so + 1]; fb.d[o + 2] = src.d[so + 2]; fb.d[o + 3] = 255;
        fb.id[y * W + x] = src.id[sy * src.w + sx];
      }
    }
  };
  const onScreen = (y0, y1) => y1 > fb.oy && y0 < fb.oy + H;   // is any of world rows y0..y1 on screen?
  function draw(now) {
    fb.id.fill(-1); fb.pid = -1; fb.oy = Math.round(camY);
    const cy = fb.oy;
    blit(L.sky, 0.05);
    // clouds drift slowly on their own as well as with the camera
    const cl = L.clouds, coff = Math.round(cam * 0.1 + t * 0.6);
    for (let y = Math.max(0, cy); y < Math.min(70, cy + H); y++) for (let x = 0; x < W; x++) { const sx = ((x + coff) % cl.w + cl.w) % cl.w, so = (y * cl.w + sx) * 4; if (cl.d[so + 3]) { const o = ((y - cy) * W + x) * 4; fb.d[o] = cl.d[so]; fb.d[o + 1] = cl.d[so + 1]; fb.d[o + 2] = cl.d[so + 2]; } }
    blit(L.far, 0.15);
    blit(L.jungle, 0.3);
    // the distant waterfall falls
    if (onScreen(62, WATER)) { // streaks that flow downward, hazed like the rest of the far jungle, with spray at the foot
      const ox = Math.round(cam * 0.3), haze = [176, 150, 140];
      for (let x = 405; x < 417; x++) { const col = hash(x, 3), sp = 26 + col * 18;
        for (let y = 66; y < WATER; y++) { const b = hash(x, Math.floor((y - t * sp) / 3), 4); const c = b > 0.55 ? [226, 232, 234] : b > 0.2 ? [178, 198, 206] : [132, 150, 160]; fb.put(x - ox, y, mixc(c, haze, 0.4)); } }
      for (let i = 0; i < 18; i++) { const x = 403 + hash(i, 5) * 16, y = WATER - 2 - pos(Math.sin(t * 3 + i)) * 5; fb.add(x - ox, y, [200, 210, 214], 0.35); }
    }
    blit(L.back, 0.55);
    fb.ox = Math.round(cam * 0.55); fb.fog = 0.26; fb.fogc = [150, 140, 130];
    villagers.forEach((v, i) => { const { q, px, py } = villagerPose(v), h = drawApe(fb, v.key, q, { mode: 'pelvis', x: px, y: py }, v.b.dir, v.s, t); vheads[i] = { x: h.headX - fb.ox, y: h.headY }; });
    for (const l of leaves) if (l.par !== 1) fb.put(l.x - fb.ox, l.y, l.c);
    fb.fog = 0; fb.ox = 0;
    // low mist drifting through the trees behind the village
    if (onScreen(84, WATER)) for (let y = 84; y < WATER; y++) for (let x = 0; x < W; x++) { const n = noise1((x + cam * 0.7 + t * 4) / 23, 9) * 0.6 + noise1((x + cam * 0.7 - t * 2) / 9, 10) * 0.4, a = n * (1 - Math.abs(y - 104) / 20) * 0.5; if (a > 0.05) fb.add(x, y, [64, 54, 54], a * 0.45); }
    // light shafts from the low sun on the left
    // (they reach up through the canopy too, brighter the higher you go)
    for (let y = cy; y < Math.min(WATER, cy + H); y++) for (let x = 0; x < W; x++) {
      const u = (x + cam * 0.3) - y * 1.1, band = Math.sin(u / 43) * 0.6 + Math.sin(u / 17 + 1.3) * 0.25 + Math.sin(t * 0.2 + u / 90) * 0.15;
      if (band < 0.58) continue;
      const a = Math.min(1, (band - 0.58) * 2.2) * Math.min(1.15, 1 - y / WATER * 0.6);
      if (hash(x, y, Math.floor(t * 3)) < 0.45 + a * 0.45) fb.add(x, y, SUN, 0.04 + a * 0.16);
    }
    blit(L.mid, 1);
    fb.ox = cam;
    for (const [lx, ly] of L.lamps) for (let y = ly - 4; y <= ly + 4; y++) for (let x = lx - 4; x <= lx + 4; x++) { const dd = Math.hypot(x - lx, y - ly); if (dd > 0.5 && dd < 4.5) fb.add(x - cam, y, [255, 190, 110], 0.1 / dd * (0.85 + 0.15 * Math.sin(t * 7 + lx))); }
    // the Council Ring: the fire in its bowl (higher during a gathering), and one lantern lit for each job finished today
    if (onScreen(RING.y - 60, RING.y + 4)) {
      const fx = RING.fire.x, fy = RING.fire.y, big = gathering ? 1.6 : 1;
      for (let i = 0; i < 14 * big; i++) { const h = hash(i, Math.floor(t * 10), 41), x = fx - 3 + hash(i, 42) * 6, y = fy - 2 - h * 6 * big * (1 - Math.abs(x - fx) / 4); fb.put(x - cam, y, h > 0.7 ? [255, 236, 150] : h > 0.35 ? [255, 170, 60] : [220, 80, 40]); }
      for (let y = fy - 12; y <= fy + 2; y++) for (let x = fx - 9; x <= fx + 9; x++) { const dd = Math.hypot(x - fx, (y - fy + 3) * 1.4); if (dd > 1 && dd < 10) fb.add(x - cam, y, [255, 150, 70], (0.12 * big) / dd * (0.85 + 0.15 * Math.sin(t * 9))); }
      RING.lanterns.forEach((l, i) => {
        const lit = i < lanternsLit; fb.put(l.x - cam, l.y - 3, [96, 76, 56]); fb.ell(l.x, l.y, 1.6, 2, lit ? { s: [220, 120, 50], b: [255, 190, 90], l: [255, 230, 160], r: [255, 240, 190] } : { s: [60, 44, 30], b: [96, 70, 44], l: [120, 90, 56], r: [140, 110, 70] });
        if (lit) for (let y = l.y - 5; y <= l.y + 5; y++) for (let x = l.x - 5; x <= l.x + 5; x++) { const dd = Math.hypot(x - l.x, y - l.y); if (dd > 1 && dd < 5.5) fb.add(x - cam, y, [255, 180, 90], 0.09 / dd); }
      });
      for (const f of flares) for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + t * 3, r = (1 - f.life) * 7; fb.add(f.x + Math.cos(a) * r - cam, f.y + Math.sin(a) * r, [255, 220, 140], f.life * 0.8); }
    }
    for (const l of L.lights) {
      const a = actors[l.key], lit = a && a.inside;
      if (l.chimney) { if (lit) fb.rect(l.x0, l.y0, l.x1, l.y1, [255, 170, 80]); continue; }
      const c = lit ? LIGHT[l.key] : [70, 52, 36];
      if (l.bell) { if (lit) for (let y = l.y0 - 3; y < l.y1 + 3; y++) for (let x = l.x0 - 3; x < l.x1 + 3; x++) if (hash(x, y, Math.floor(t * 6)) < 0.14) fb.add(x - cam, y, LIGHT.ringer, 0.28); continue; }
      fb.rect(l.x0, l.y0, l.x1, l.y1, c);
      if (lit) for (let y = l.y0 - 3; y < l.y1 + 3; y++) for (let x = l.x0 - 3; x < l.x1 + 3; x++) { const dx = Math.max(l.x0 - x, 0, x - l.x1 + 1), dy = Math.max(l.y0 - y, 0, y - l.y1 + 1), dd = Math.hypot(dx, dy); if (dd > 0 && dd < 3.5) fb.add(x - cam, y, c, 0.14 / dd); }
    }
    const drawActor = a => {
      const sp = SPECIES[a.key], target = poseFor(a), q = blendPose(a.prev, target, a.blend * a.blend * (3 - 2 * a.blend)); q.tail = a.tailA; a.q = q;
      let at;
      if (a.anim === 'climb') at = { mode: 'pelvis', x: a.x, y: a.climbY };
      else if (a.anim === 'brach' && a.br) { const p = brachiatePose(sp, a.br, a.s, { fast: sp.canopy === 'brachiate-fast' }); at = { mode: 'pelvis', x: p.px, y: p.py }; if (a.blend >= 1) { Object.assign(q, p.q); q.tail = a.tailA; } }
      else if (a.anim === 'leap') at = { mode: 'pelvis', x: a.x, y: a.air ? a.air.y - 4 : groundY(a.x) - 6 };
      else at = { mode: 'ground', x: a.x, y: surfaceY(a.lane, a.x) - (a.lane === 'canopy' ? 1.5 : 0) };
      // When the way the body rests changes (stand up from lying down, start a climb, land), ease the
      // pelvis from where it was to where it now belongs instead of snapping, over about a tenth of a second.
      const [px, py] = placeApe(a.key, q, at, a.facing, a.s), dt = Math.min(0.1, t - (a.drawT ?? t)); a.drawT = t;
      if (a.anim !== a.drawAnim && a.drawn) { a.offX = (a.offX || 0) + a.drawn[0] - (px + (a.offX || 0)); a.offY = (a.offY || 0) + a.drawn[1] - (py + (a.offY || 0)); }
      a.drawAnim = a.anim;
      const k = Math.exp(-dt / 0.06); a.offX = (a.offX || 0) * k; a.offY = (a.offY || 0) * k;
      if (Math.abs(a.offX) < 0.05) a.offX = 0; if (Math.abs(a.offY) < 0.05) a.offY = 0;
      a.drawn = [px + a.offX, py + a.offY];
      // turning round is a quick flip over a few frames, not an instant mirror (the head sits well forward of the hips)
      a.face = a.face ?? a.facing; if (a.face !== a.facing) { const st = dt / (reduced ? 0.08 : 0.16) * 2; a.face = Math.abs(a.facing - a.face) <= st ? a.facing : a.face + Math.sign(a.facing - a.face) * st; }
      const f = Math.abs(a.face) < 0.25 ? Math.sign(a.face || a.facing) * 0.25 : a.face;
      const h = drawApe(fb, a.key, q, { mode: 'pelvis', x: a.drawn[0], y: a.drawn[1] }, f, a.s, t, a.folk);
      if (a.carry) {   // the courier's basket of fruit: on its head, or slung from its hips while it swings
        const [bx, by] = a.anim === 'brach' || a.anim === 'climb' ? [a.drawn[0], a.drawn[1] + 3] : [h.headX, h.headY - 1.5];
        fb.ell(bx, by, 2.6, 1.4, mat([150, 110, 60])); fb.ell(bx - 1, by - 1.4, 1, 1, mat([236, 200, 60])); fb.ell(bx + 1, by - 1.2, 1, 1, mat([236, 120, 40]));
      }
      return h;
    };
    fb.pid = -1; folk.forEach((a, i) => { fheads[i] = onScreen(a.climbY ?? surfaceY(a.lane, a.x), (a.climbY ?? surfaceY(a.lane, a.x)) + 40) ? drawActor(a) : null; });   // villagers first, behind the crew
    for (const k of CREW) { const a = actors[k]; if (a.inside) { heads[k] = null; continue; } fb.pid = ID[k]; heads[k] = drawActor(a); }
    fb.pid = -1;
    glowOutline();
    drawToucan(fb, toucan.pose());
    for (const l of leaves) if (l.par === 1) { fb.put(l.x - cam, l.y, l.c); if (Math.sin(l.ph) > 0) fb.put(l.x - cam + 1, l.y, l.c); }
    for (const s of sparks) { if (s.steam) { fb.add(Math.round(s.x - cam), Math.round(s.y), s.c, 0.35 * s.life); fb.add(Math.round(s.x - cam) + 1, Math.round(s.y), s.c, 0.2 * s.life); } else fb.put(s.x - cam, s.y, s.c); }
    for (const f of flies) { const x = Math.round(f.x - cam), y = Math.round(f.y), up = Math.sin(f.ph * 18) > 0; fb.put(x, y, [40, 30, 30]); fb.put(x - 1, y - (up ? 1 : 0), f.c); fb.put(x + 1, y - (up ? 1 : 0), f.c); }
    for (let i = 0; i < 14; i++) { const x = ((hash(i, 93) * WORLD + Math.sin(t * 0.3 + i) * 20) - cam), y = 70 + hash(i, 94) * 40 + Math.sin(t * 0.8 + i * 2) * 5; if (x > -2 && x < W + 2 && Math.sin(t * 2.3 + i * 1.7) > 0.3) fb.add(x, y, [200, 255, 140], 0.7); } // fireflies
    fb.ox = 0;
    // the lagoon: everything above mirrored, darkened, rippling, with bright ripple dashes
    for (let y = Math.max(WATER, cy); y < Math.min(H, cy + H); y++) {   // world rows of the lagoon that are on screen
      const depth = (y - WATER) / (H - WATER), wob = Math.round(Math.sin(y * 0.9 + t * 2.2) * (0.5 + depth * 1.6));
      const sy = 2 * WATER - y - 1 - Math.round(Math.sin(t * 1.3 + y * 0.35) * 0.6) - cy, ry = y - cy;   // source and target rows on screen
      for (let x = 0; x < W; x++) {
        const sx = Math.max(0, Math.min(W - 1, x + wob)), so = (Math.max(0, sy) * W + sx) * 4, o = (ry * W + x) * 4;
        const k = 0.55 - depth * 0.15;
        fb.d[o] = fb.d[so] * k + 18 * (1 - k); fb.d[o + 1] = fb.d[so + 1] * k + 34 * (1 - k); fb.d[o + 2] = fb.d[so + 2] * k + 44 * (1 - k); fb.d[o + 3] = 255; fb.id[ry * W + x] = -1;
      }
      for (let i = 0; i < 3; i++) {                          // ripple dashes
        const r = hash(y, i, 21), x0 = ((r * 1200 - cam * 1.0 + Math.sin(t * 0.5 + r * 6) * 8) % W + W) % W, len = 2 + Math.floor(hash(y, i, 22) * 5);
        if (Math.sin(t * 1.6 + r * 20) < 0.2) continue;
        for (let x = 0; x < len; x++) fb.add(x0 + x, y, [190, 200, 190], 0.32);   // (add takes world rows)
      }
    }
    blit(L.fore, 1.3);
    fb.oy = 0; blit(frame, 0, true); drawVines(fb, t); fb.oy = cy;   // the foliage frame is fixed to the screen
    // plates over heads
    for (const k of CREW) { const a = actors[k], h = heads[k]; if (!h) continue; const p = PLATE[a.mode]; if (!p) continue;
      let x = Math.round(h.headX - cam) - 4, y = Math.round(h.headY) - 11;
      if (a.mode === 'asleep') y -= reduced ? 0 : Math.floor((t * 4 + ID[k] * 3) % 7);
      else if (a.mode === 'asking') y -= Math.round(Math.abs(Math.sin(t * 3)) * 2);
      if (a.mode !== 'asleep') { fb.rect(x - 1, y - 1, x + 10, y + 10, [10, 8, 14]); fb.rect(x, y, x + 9, y + 9, p[1]); fb.rect(x + 1, y + 1, x + 8, y + 8, [10, 8, 14]); }
      GLYPH[p[0]].forEach((row, r) => { for (let c2 = 0; c2 < 5; c2++) if (row[c2] === '1') fb.put(x + 2 + c2, y + 2 + r, p[1]); });
    }
    img.data.set(fb.d); ctx.putImageData(img, 0, 0);
  }

  const clampCam = x => Math.max(0, Math.min(WORLD - W, x)), clampY = y => Math.max(TOP, Math.min(0, y));
  const storyOf = y => STORIES.reduce((b, s, i) => Math.abs(s.camY - y) < Math.abs(STORIES[b].camY - y) ? i : b, 0);
  const worldYOf = a => a.anim === 'climb' && a.climbY !== undefined ? a.climbY : a.air ? a.air.y : surfaceY(a.lane, a.x);
  return {
    _actors: actors, _villagers: villagers, _folk: folk, _gatherings: gatherings, _lanterns: () => lanternsLit, _heads: () => ({ ...heads, ...Object.fromEntries(fheads.map((h, i) => [`f:${i}`, h])) }), _chiefIdle: chiefIdle,
    step(now, dt = 0.05) {
      t += dt;
      if (goalY !== null) { camY += (goalY - camY) * Math.min(1, reduced ? 1 : dt * 6); if (Math.abs(goalY - camY) < 0.5) { camY = goalY; goalY = null; } }
      update(dt, now); draw(now);
    },
    redraw(now) { draw(now); },
    camera: () => cam,
    cameraY: () => camY,
    /** Centre the view on world x; with y, also bring that world height into view. */
    scrollTo(x, y) { cam = clampCam(x - W / 2); if (y !== undefined) { camY = clampY(y - H * 0.62); goalY = null; } },
    scrollBy(dx, dy = 0) { cam = clampCam(cam + dx); if (dy) { camY = clampY(camY + dy); goalY = null; } },
    /** Which story is in view (0 Ground, 1 Canopy 1, 2 Canopy 2), and glide to one. */
    story: () => storyOf(goalY ?? camY),
    toStory(i) { goalY = STORIES[Math.max(0, Math.min(STORIES.length - 1, i))].camY; },
    /** Bring a crew member into view, whichever story it is on. */
    focus(k) { const a = actors[k]; cam = clampCam(a.x - W / 2); goalY = clampY(worldYOf(a) - H * 0.62); if (reduced) { camY = goalY; goalY = null; } },
    pick(cssX, cssY) {
      const r = canvas.getBoundingClientRect(), x = Math.floor(cssX / r.width * W), y = Math.floor(cssY / r.height * H);
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      const id = fb.id[y * W + x]; if (id > 0) return CREW[id - 1];
      const wx = x + cam, wy = y + Math.round(camY); let best = null, bd = 30;
      for (const k of CREW) { const dd = Math.abs(DOORS[k].x - wx) + Math.abs(surfaceY(DOORS[k].lane, DOORS[k].x) - wy) * 0.5; if (dd < bd) { bd = dd; best = k; } }
      return best;
    },
    anchor(k) { const r = canvas.getBoundingClientRect(), h = heads[k] || { headX: DOORS[k].x, headY: surfaceY(DOORS[k].lane, DOORS[k].x) - 20 }; return [(h.headX - cam) / W * r.width, (h.headY - Math.round(camY)) / H * r.height]; },
    positionOf: k => actors[k].x,
    /** A real event the villagers may remark on (see chatter.js). */
    notify(fact) {
      chatter.notify(fact);
      if (fact.type === 'job_done' && lanternsLit < RING.lanterns.length) { const l = RING.lanterns[lanternsLit++]; flares.push({ x: l.x, y: l.y, life: 1 }); }   // the lantern ritual
    },
    /** How many jobs finished today (from the server): that many lanterns are lit at the Council Ring. */
    lanterns(n) { lanternsLit = Math.max(0, Math.min(RING.lanterns.length, n | 0)); },
    /** Is a gathering under way at the Ring? (scenery) */
    gathering: () => gathering,
    /** Is a request to Claude Code open? The toucan is away exactly while one is. `animate` false snaps (replayed history). */
    mail: (open, animate = true) => toucan.setAway(open, animate && !reduced),
    /** Chatter bubbles to show now, each with where its speaker's head is, in CSS px relative to the canvas. */
    chatter() {
      const r = canvas.getBoundingClientRect(), pos = new Map();
      const cy = Math.round(camY);   // only speakers whose heads are on screen get a bubble
      for (const k of CREW) if (heads[k]) pos.set(`crew:${k}`, [heads[k].headX - cam, heads[k].headY - cy]);
      vheads.forEach((h, i) => h && pos.set(`v:${i}`, [h.x, h.y - cy]));
      fheads.forEach((h, i) => h && pos.set(`f:${i}`, [h.headX - cam, h.headY - cy]));
      return chat.filter(b => pos.has(b.ref) && pos.get(b.ref)[1] > 4 && pos.get(b.ref)[1] < H).map(b => { const [x, y] = pos.get(b.ref); return { ...b, x: x / W * r.width, y: y / H * r.height }; });
    }
  };
}

/** A card preview: one creature cycling through its animations, with blending between them. */
