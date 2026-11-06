// The village floor. Places the crew, walks them along the roads, and draws
// everything according to the mode the event stream gives each creature
// (see state.js):
//   idle    – wanders the roads (ambient life)
//   asleep  – dozes on its own doorstep, "Z"
//   ready / talking / error / asking – waits at its front door (… ! ? plates)
//   working – goes INSIDE its building; the building's windows light up
// Nothing but `working` lights a building, and nothing but an event sets `working`.

import { MAT, View, part, buildWyrm, buildArmor, buildSmith, buildGargoyle, buildScribe, buildSpider, buildSeer, buildBat, SP, CP } from './engine.js';
import { FX, FZ, groundRGB, buildVillage, NODES, ROAD_NODES, neighbours, nearestNode, route } from './village.js';

export const CREW_IDS = ['voidwyrm', 'armor', 'smith', 'gargoyle', 'scribe', 'spider', 'seer', 'bat'];
const PICK_ID = { voidwyrm: 1, armor: 2, smith: 3, gargoyle: 4, scribe: 5, spider: 6, seer: 7, bat: 8 };
const SITE_ID = { voidwyrm: 21, armor: 22, smith: 23, gargoyle: 24, scribe: 25, spider: 26, seer: 27, bat: 28 };
const BUILD = { voidwyrm: buildWyrm, armor: buildArmor, smith: buildSmith, gargoyle: buildGargoyle, scribe: buildScribe, spider: buildSpider, seer: buildSeer, bat: buildBat };
const KIND = {
  armor: { alt: 3, speed: 13, head: 31 }, smith: { speed: 11, head: 30 }, gargoyle: { speed: 12, head: 22 }, scribe: { speed: 9, head: 34 },
  spider: { speed: 15, head: 17 }, seer: { speed: 8, head: 30 }, bat: { alt: 20, fly: true, speed: 18, head: 25 }
};
const BAT_DOOR_ALT = 46;  // the bat "goes in" through the belfry, in front of the clock face
const snap8 = a => Math.round(a / (Math.PI / 4)) * (Math.PI / 4);

const GLYPH = {
  '?': ['01110', '10001', '00110', '00000', '00100'],
  '!': ['00100', '00100', '00100', '00000', '00100'],
  '…': ['00000', '00000', '00000', '00000', '10101'],
  'Z': ['11111', '00010', '00100', '01000', '11111']
};
const PLATE = { asking: ['?', '#f2c531'], error: ['!', '#ff5a5a'], talking: ['…', '#e8e3f0'], asleep: ['Z', '#8fb4ff'] };

export const SCENE_W = 640, SCENE_H = 424;

export function makeStation(canvas, { modeOf, reduced = false }) {
  const view = new View(canvas, SCENE_W, SCENE_H, 2, 320, 264);
  const models = Object.fromEntries(CREW_IDS.map(k => [k, BUILD[k]()]));
  models.voidwyrm = { ...models.voidwyrm, parts: models.voidwyrm.parts.filter(p => p.name !== 'island') }; // perched on the tower, not an island
  const village = buildVillage();
  const staticObjs = [
    ...Object.entries(village.sites).map(([k, s]) => ({ obj: { model: { parts: [part('b', s.vox, [0, 0, 0])] }, pos: [0, 0, 0] }, id: SITE_ID[k] })),
    { obj: { model: { parts: [part('props', village.props, [0, 0, 0])] }, pos: [0, 0, 0] }, id: 10 },
    { obj: { model: { parts: [part('rim', village.rim, [0, 0, 0], true)] }, pos: [0, 0, 0] }, id: 11 }
  ];
  // light layers only show faces that aren't buried in their building
  const lightObjs = Object.fromEntries(Object.entries(village.sites).map(([k, s]) => [k, { model: { parts: [{ name: 'l', pivot: [0, 0, 0], faces: s.lights.faces(false, s.vox) }] }, pos: [0, 0, 0] }]));
  const ctx = canvas.getContext('2d');
  let t = 0, yawStep = 0, seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const sparks = [];
  const wyrm = { pos: [...village.sites.voidwyrm.perch] };

  const doorOf = k => NODES[k];
  const actors = {};
  for (const [k, kind] of Object.entries(KIND)) {
    const [x, z] = doorOf(k);
    actors[k] = { ...kind, key: k, pos: [x, 0, z], facing: 0, phase: 0, wait: 1 + rnd() * 3, path: [], node: k, inside: false, atDoor: true, moving: false, lastSpark: -9, lastBubble: -9, mode: 'idle' };
  }

  function bake() {
    const { W, H, S, cx0, cy0 } = view, c = Math.cos(view.yaw), s = Math.sin(view.yaw);
    view.clear();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, o = i * 4, c0 = (x + 0.5 - cx0) / S, c2 = ((y + 0.5 - cy0) / S) / SP;
      const wx = c0 * c + c2 * s, wz = -c0 * s + c2 * c;
      if (wx >= -FX && wx < FX && wz >= -FZ && wz < FZ) { view.col.set([...groundRGB(wx, wz), 255], o); view.dep[i] = c2 * CP; view.id[i] = 0; }
      else { const st = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1, g = 8 + (y / H) * 7; view.col.set(st > 0.996 ? [130, 115, 160, 255] : [g * 0.8, g * 0.8, g * 1.6, 255], o); }
    }
    for (const { obj, id } of staticObjs) view.draw(obj, id, null, 0);
    view.snapshot();
  }
  bake();

  // ---------- movement ----------
  const near = (a, n) => Math.hypot(NODES[n][0] - a.pos[0], NODES[n][1] - a.pos[2]) < 1;
  function goTo(a, target) {
    const from = a.node && near(a, a.node) ? a.node : nearestNode(a.pos[0], a.pos[2]);
    a.path = route(from, target);
    if (!near(a, from)) a.path.unshift(from);
  }
  function update(dt, now) {
    for (const [k, a] of Object.entries(actors)) {
      const mode = modeOf(k, now); a.mode = mode;
      if (mode === 'asleep') { const [x, z] = doorOf(k); a.pos = [x, 0, z]; a.facing = 0; a.moving = false; a.path = []; a.node = k; a.inside = false; continue; }
      const wantDoor = mode !== 'idle';
      if (wantDoor && a.node !== k && a.path[a.path.length - 1] !== k) { if (a.fly) a.path = [k]; else goTo(a, k); }
      if (!wantDoor && a.path.length && a.path[a.path.length - 1] === k && a.node !== k) a.path = []; // job ended on the way: stop heading home
      if (!wantDoor && !a.path.length) {
        a.wait -= dt;
        if (a.wait <= 0) {
          if (a.fly) a.path = [ROAD_NODES[Math.floor(rnd() * ROAD_NODES.length)]];
          else {
            const here = a.node && ROAD_NODES.includes(a.node) ? a.node : nearestNode(a.pos[0], a.pos[2], ROAD_NODES);
            const opts = neighbours(here).filter(n => ROAD_NODES.includes(n));
            const next = opts[Math.floor(rnd() * opts.length)];
            a.path = near(a, here) ? [next] : [here, next];
          }
          a.wait = 1.5 + rnd() * 3;
        }
      }
      if (a.path.length) {
        const [tx, tz] = NODES[a.path[0]], dx = tx - a.pos[0], dz = tz - a.pos[2], dist = Math.hypot(dx, dz);
        const step = a.speed * dt * (wantDoor ? 1.4 : 0.75);
        if (dist > step) { a.pos[0] += dx / dist * step; a.pos[2] += dz / dist * step; a.facing = snap8(Math.atan2(dx, dz)); a.moving = true; a.phase += dt * 10; a.node = null; }
        else { a.pos[0] = tx; a.pos[2] = tz; a.node = a.path.shift(); if (!a.path.length) a.moving = false; }
      } else a.moving = false;
      a.atDoor = a.node === k && !a.path.length;
      if (a.atDoor && wantDoor) a.facing = 0;
      a.inside = mode === 'working' && a.atDoor;
      const targetAlt = a.fly ? (a.atDoor && wantDoor ? BAT_DOOR_ALT : a.alt) : (a.alt || 0);
      a.curAlt = a.curAlt === undefined ? targetAlt : a.curAlt + Math.max(-12 * dt, Math.min(12 * dt, targetAlt - a.curAlt));
      a.pos[1] = a.curAlt ? a.curAlt + Math.sin(t * 1.2) * 0.8 : 0;
      // signs of work coming out of the building
      if (a.inside && k === 'smith' && t - a.lastSpark > 0.15) {
        a.lastSpark = t; const e = village.sites.smith.ember;
        sparks.push({ p: [e[0] + (rnd() - 0.5) * 3, e[1], e[2] + (rnd() - 0.5) * 3], v: [(rnd() - 0.5) * 3, 8 + rnd() * 6, (rnd() - 0.5) * 3], life: 1 + rnd() * 0.6, c: 'lava', g: 2 });
      }
      if (a.inside && k === 'seer' && t - a.lastBubble > 0.25) {
        a.lastBubble = t; const [px, pz] = village.sites.seer.pond;
        sparks.push({ p: [px + (rnd() - 0.5) * 18, 1.2, pz + (rnd() - 0.5) * 14], v: [0, 5 + rnd() * 3, 0], life: 0.9 + rnd() * 0.4, c: 'tide', g: 0 });
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.life -= dt; s.v[1] -= s.g * dt;
      s.p[0] += s.v[0] * dt; s.p[1] += s.v[1] * dt; s.p[2] += s.v[2] * dt;
      if (s.life <= 0 || s.p[1] < 0) sparks.splice(i, 1);
    }
  }

  const poseOf = a => a.mode === 'asleep' ? { t: 0, moving: false, phase: 0, work: false, on: false } : { t, moving: a.moving, phase: a.phase, work: false, on: false };
  const headOf = k => k === 'voidwyrm' ? [wyrm.pos[0], wyrm.pos[1] + 30, wyrm.pos[2] + 10] : [actors[k].pos[0], actors[k].pos[1] + actors[k].head, actors[k].pos[2]];

  function draw(now) {
    view.restore();
    const wm = modeOf('voidwyrm', now);
    // building lights: lit only while their creature works inside
    for (const k of CREW_IDS) view.draw(lightObjs[k], SITE_ID[k], k === 'voidwyrm' ? wm === 'working' : actors[k].inside, t, 0.3, 2); // lit a step below full brightness so each building keeps its creature's colour
    for (const a of Object.values(actors)) if (!a.inside) view.shadow(a.pos[0], a.pos[2], models[a.key].shadowR * (a.pos[1] > 1 ? 0.85 : 1), a.pos[1] > 1 ? 0.7 : 0.55);
    view.draw({ model: models.voidwyrm, pos: wyrm.pos, facing: 0, pose: models.voidwyrm.pose({ t: wm === 'asleep' ? 0 : t, on: wm === 'working' }) }, PICK_ID.voidwyrm, wm === 'working', t);
    for (const a of Object.values(actors)) if (!a.inside) view.draw({ model: models[a.key], pos: a.pos, facing: a.facing, pose: models[a.key].pose(poseOf(a)) }, PICK_ID[a.key], false, t);
    for (const s of sparks) view.spark(s.p, MAT[s.c].rgb[s.life > 0.3 ? 4 : 3]);
    view.present();
    plate('voidwyrm', wm, headOf('voidwyrm'));
    for (const a of Object.values(actors)) if (!a.inside) plate(a.key, a.mode, headOf(a.key));
  }

  function plate(k, mode, world) {
    const p = PLATE[mode]; if (!p) return;
    let [x, y] = view.project(world); x = Math.round(x) - 5; y = Math.round(y) - 12;
    if (mode === 'asleep') y -= reduced ? 0 : Math.floor((t * 4 + PICK_ID[k] * 3) % 8);
    else if (mode === 'asking') y -= Math.round(Math.abs(Math.sin(t * 3)) * 2);
    if (mode !== 'asleep') { ctx.fillStyle = '#0a080e'; ctx.fillRect(x - 1, y - 1, 11, 11); ctx.fillStyle = p[1]; ctx.fillRect(x, y, 9, 9); ctx.fillStyle = '#0a080e'; ctx.fillRect(x + 1, y + 1, 7, 7); }
    ctx.fillStyle = p[1];
    GLYPH[p[0]].forEach((row, r) => { for (let c = 0; c < 5; c++) if (row[c] === '1') ctx.fillRect(x + 2 + c, y + 2 + r, 1, 1); });
  }

  return {
    /** For tests: the renderer (its `em` buffer marks pixels lit by working creatures) and the actors. */
    _view: view,
    _actors: actors,
    /** Advance the world one step (≈0.1 s) and draw it. `now` is the event-clock time in ms. */
    step(now, dt = 0.1) { t += dt; update(dt, now); draw(now); },
    redraw(now) { draw(now); },
    rotate(d) { yawStep = (yawStep + d + 8) % 8; view.setYaw(yawStep * Math.PI / 4); bake(); return yawStep * 45; },
    /** Which creature is at canvas-relative CSS coordinates? Clicking a building picks its owner. */
    pick(cssX, cssY) {
      const r = canvas.getBoundingClientRect();
      const x = Math.floor(cssX / r.width * view.W), y = Math.floor(cssY / r.height * view.H);
      if (x < 0 || y < 0 || x >= view.W || y >= view.H) return null;
      const id = view.id[y * view.W + x];
      return CREW_IDS.find(k => PICK_ID[k] === id || SITE_ID[k] === id) || null;
    },
    /** Where a creature's head is, in CSS px relative to the canvas (for the question bubble). */
    anchor(k) {
      const r = canvas.getBoundingClientRect();
      const [x, y] = view.project(headOf(k));
      return [x / view.W * r.width, y / view.H * r.height];
    }
  };
}
