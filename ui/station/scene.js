// The station floor: places the crew, moves them, and draws them according to
// the mode the event stream gives each one (see state.js). Idle creatures
// wander as ambient life; everything else (walking to a station, working,
// lights, sparks, plates) happens only because an event said so.

import {
  MAT, View, mv, buildWyrm, buildArmor, buildSmith, buildGargoyle, buildScribe, buildSpider, buildSeer, buildBat, buildProps, buildBase
} from './engine.js';

export const CREW_IDS = ['voidwyrm', 'armor', 'smith', 'gargoyle', 'scribe', 'spider', 'seer', 'bat'];
const PICK_ID = { voidwyrm: 1, armor: 2, smith: 3, gargoyle: 4, scribe: 5, spider: 6, seer: 7, bat: 8 };
const BUILD = { voidwyrm: buildWyrm, armor: buildArmor, smith: buildSmith, gargoyle: buildGargoyle, scribe: buildScribe, spider: buildSpider, seer: buildSeer, bat: buildBat };
// station spot, facing while there, hover height, walk speed, plate height above the creature
const SPOTS = {
  armor:    { station: [44, 0, 0], alt: 3, speed: 13, head: 31 },
  smith:    { station: [-40, 0, 10], speed: 11, head: 30 },
  gargoyle: { station: [0, 0, 22], speed: 12, head: 22 },
  scribe:   { station: [-34, 0, -26], speed: 9, head: 34 },
  spider:   { station: [31, 0, -24], face: Math.PI, speed: 15, head: 17 },
  seer:     { station: [-26, 0, 32], speed: 8, head: 30 },
  bat:      { station: [60, 0, 32], alt: 7, speed: 17, head: 25 }
};
const WAY = [[-20, -6], [18, -4], [-28, 20], [24, 24], [-6, 8], [12, 40], [-50, -22], [50, -26], [-30, -36], [32, -38], [-14, 30], [30, 6]];
const snap8 = a => Math.round(a / (Math.PI / 4)) * (Math.PI / 4);

// 5×5 plate glyphs
const GLYPH = {
  '?': ['01110', '10001', '00110', '00000', '00100'],
  '!': ['00100', '00100', '00100', '00000', '00100'],
  '…': ['00000', '00000', '00000', '00000', '10101'],
  'Z': ['11111', '00010', '00100', '01000', '11111']
};
const PLATE = { asking: ['?', '#f2c531'], error: ['!', '#ff5a5a'], talking: ['…', '#e8e3f0'], asleep: ['Z', '#8fb4ff'] };

export function makeStation(canvas, { modeOf, reduced = false }) {
  const view = new View(canvas, 360, 240, 2, 180, 134);
  const models = Object.fromEntries(CREW_IDS.map(k => [k, BUILD[k]()]));
  const props = buildProps();
  buildBase(view, props);
  const ctx = canvas.getContext('2d');
  let t = 0, yawStep = 0, seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const sparks = [];
  const wyrm = { pos: [0, 28, -36], facing: 0 };
  const actors = {};
  for (const [k, s] of Object.entries(SPOTS)) actors[k] = { ...s, pos: [...s.station], facing: s.face || 0, phase: 0, wait: rnd() * 3, target: null, moving: false, atStation: true, lastSpark: -9, lastBubble: -9 };

  function update(dt, now) {
    for (const [k, a] of Object.entries(actors)) {
      const mode = modeOf(k, now);
      a.mode = mode;
      if (mode === 'asleep') { a.moving = false; a.pos = [...a.station]; a.facing = a.face || 0; a.atStation = true; a.pos[1] = 0; continue; }
      let dest;
      if (mode === 'idle') {
        if (a.atStation && !a.target) { a.atStation = false; }
        dest = a.target;
        if (!dest) { a.wait -= dt; if (a.wait <= 0) { const w = WAY[Math.floor(rnd() * WAY.length)]; a.target = dest = [w[0], 0, w[1]]; } }
      } else { dest = a.station; a.target = null; }
      if (dest) {
        const dx = dest[0] - a.pos[0], dz = dest[2] - a.pos[2], dist = Math.hypot(dx, dz);
        if (dist > 0.9) {
          const step = Math.min(dist, a.speed * dt * (mode === 'idle' ? 0.7 : 1.3));
          a.pos[0] += dx / dist * step; a.pos[2] += dz / dist * step;
          a.facing = snap8(Math.atan2(dx, dz)); a.moving = true; a.phase += dt * 10; a.atStation = false;
        } else {
          a.moving = false; a.pos[0] = dest[0]; a.pos[2] = dest[2];
          if (mode === 'idle') { a.target = null; a.wait = 2 + rnd() * 3; }
          else { a.atStation = true; a.facing = a.face || 0; }
        }
      } else a.moving = false;
      a.pos[1] = a.alt ? a.alt + Math.sin(t * 1.2) * 0.8 : 0;
      const working = mode === 'working' && a.atStation;
      if (k === 'smith' && working && 0.5 + 0.5 * Math.sin(t * 5) > 0.93 && t - a.lastSpark > 0.6) {
        a.lastSpark = t;
        for (let i = 0; i < 9; i++) sparks.push({ p: [-40 + (rnd() - 0.5) * 3, 8, 18], v: [(rnd() - 0.5) * 22, 10 + rnd() * 14, (rnd() - 0.5) * 18], life: 0.5 + rnd() * 0.4, c: 'lava', g: 40 });
      }
      if (k === 'seer' && working && t - a.lastBubble > 0.25) {
        a.lastBubble = t;
        sparks.push({ p: [-26 + (rnd() - 0.5) * 9, 1.2, 42 + (rnd() - 0.5) * 9], v: [0, 5 + rnd() * 3, 0], life: 0.9 + rnd() * 0.4, c: 'tide', g: 0 });
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.life -= dt; s.v[1] -= s.g * dt;
      s.p[0] += s.v[0] * dt; s.p[1] += s.v[1] * dt; s.p[2] += s.v[2] * dt;
      if (s.life <= 0 || s.p[1] < 0) sparks.splice(i, 1);
    }
  }

  function poseOf(k, a, now) {
    if (k === 'voidwyrm') { const m = modeOf(k, now); return { t: m === 'asleep' ? 0 : t, on: m === 'working' }; }
    if (a.mode === 'asleep') return { t: 0, moving: false, phase: 0, work: false, on: false };
    const working = a.mode === 'working' && a.atStation;
    return { t, moving: a.moving, phase: a.phase, work: working, on: working };
  }

  function draw(now) {
    view.restore();
    const wm = modeOf('voidwyrm', now);
    wyrm.pos[1] = 28 + (wm === 'asleep' ? 0 : Math.sin(t * 0.6) * 1.5);
    view.shadow(wyrm.pos[0], wyrm.pos[2], 15, 0.55);
    for (const [k, a] of Object.entries(actors)) view.shadow(a.pos[0], a.pos[2], models[k].shadowR * (a.pos[1] > 1 ? 0.85 : 1), a.pos[1] > 1 ? 0.68 : 0.55);
    view.draw({ model: models.voidwyrm, pos: wyrm.pos, facing: 0, pose: models.voidwyrm.pose(poseOf('voidwyrm', null, now)) }, PICK_ID.voidwyrm, wm === 'working', t);
    for (const [k, a] of Object.entries(actors)) {
      const st = poseOf(k, a, now);
      view.draw({ model: models[k], pos: a.pos, facing: a.facing, pose: models[k].pose(st) }, PICK_ID[k], st.on, t);
    }
    for (const s of sparks) view.spark(s.p, MAT[s.c].rgb[s.life > 0.3 ? 4 : 3]);
    view.present();
    // plates over heads (drawn on top, crisp pixels)
    plate('voidwyrm', wm, [wyrm.pos[0], wyrm.pos[1] + 30, wyrm.pos[2] + 10]);
    for (const [k, a] of Object.entries(actors)) plate(k, a.mode, [a.pos[0], a.pos[1] + a.head, a.pos[2]]);
  }

  function plate(k, mode, world) {
    const p = PLATE[mode]; if (!p) return;
    let [x, y] = view.project(world); x = Math.round(x) - 5; y = Math.round(y) - 12;
    if (mode === 'asleep') { y -= Math.floor((t * 4 + PICK_ID[k] * 3) % 8); if (reduced) y = Math.round(y); }
    else if (mode === 'asking') y -= Math.round(Math.abs(Math.sin(t * 3)) * 2);
    if (mode !== 'asleep') { ctx.fillStyle = '#0a080e'; ctx.fillRect(x - 1, y - 1, 11, 11); ctx.fillStyle = p[1]; ctx.fillRect(x, y, 9, 9); ctx.fillStyle = '#0a080e'; ctx.fillRect(x + 1, y + 1, 7, 7); }
    ctx.fillStyle = p[1];
    GLYPH[p[0]].forEach((row, r) => { for (let c = 0; c < 5; c++) if (row[c] === '1') ctx.fillRect(x + 2 + c, y + 2 + r, 1, 1); });
  }

  return {
    /** For tests: the renderer (its `em` buffer marks pixels lit by working creatures). */
    _view: view,
    /** Advance the world one step (≈0.1 s) and draw it. `now` is the event-clock time in ms. */
    step(now, dt = 0.1) { t += dt; update(dt, now); draw(now); },
    redraw(now) { draw(now); },
    rotate(d) { yawStep = (yawStep + d + 8) % 8; view.setYaw(yawStep * Math.PI / 4); buildBase(view, props); return yawStep * 45; },
    /** Which creature is at canvas-relative CSS coordinates? */
    pick(cssX, cssY) {
      const r = canvas.getBoundingClientRect();
      const x = Math.floor(cssX / r.width * view.W), y = Math.floor(cssY / r.height * view.H);
      if (x < 0 || y < 0 || x >= view.W || y >= view.H) return null;
      const id = view.id[y * view.W + x];
      return CREW_IDS.find(k => PICK_ID[k] === id) || null;
    },
    /** Where a creature's head is, in CSS px relative to the canvas (for overlay cards). */
    anchor(k) {
      const r = canvas.getBoundingClientRect(), a = actors[k];
      const w = k === 'voidwyrm' ? [wyrm.pos[0], wyrm.pos[1] + 30, wyrm.pos[2] + 10] : [a.pos[0], a.pos[1] + a.head, a.pos[2]];
      const [x, y] = view.project(w);
      return [x / view.W * r.width, y / view.H * r.height];
    }
  };
}
