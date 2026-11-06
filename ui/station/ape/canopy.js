// MonkeyCraft ape village: the two canopy stories above the ground village (final-changes item 5).
//
// Each canopy story has one continuous walkway: a platform round each great trunk and a
// bough platform between each pair of trunks, all joined by sagging rope bridges. It is a
// lane like the ground path (a height at every x), so apes can roam up here with the same
// trip planner. The bough platforms are plots kept free for future crew members' tree houses.
// World y: the ground village is 0..180, Canopy 1 is −180..0 and Canopy 2 is −360..−180.

import { SUN, TOP, WORLD, bayer, hash, lerp, mat, mixc } from './fb.js';
import { C } from './cast.js';
import { GREENS, flower, foliage, trunk } from './scenery.js';

export const TRUNKS = [50, 232, 480, 664, 912];
export const BIG_TRUNK = 480;
export const STORY_Y = { 1: -64, 2: -244 };          // the walkway height of each canopy story
const PLOT_W = 42;

function buildWalk(s) {
  const base = STORY_Y[s], plats = [];
  TRUNKS.forEach((tx, i) => {
    const half = tx === BIG_TRUNK ? 40 : 24;
    plats.push({ kind: 'trunk', x0: Math.max(22, tx - half), x1: Math.min(WORLD - 22, tx + half), y: base + Math.round((hash(i, s, 301) - 0.5) * 6), tx });
    if (i < TRUNKS.length - 1) {
      const nx = TRUNKS[i + 1], mx = Math.round((tx + nx) / 2 + (hash(i, s, 302) - 0.5) * 16);
      plats.push({ kind: 'bough', x0: mx - PLOT_W / 2, x1: mx + PLOT_W / 2, y: base - 3 + Math.round((hash(i, s, 303) - 0.5) * 8), tx: Math.abs(mx - tx) < Math.abs(mx - nx) ? tx : nx });
    }
  });
  const segs = [];
  plats.forEach((p, i) => {
    segs.push(p);
    const q = plats[i + 1]; if (q) segs.push({ kind: 'bridge', x0: p.x1, x1: q.x0, y0: p.y, y1: q.y, sag: 2 + (q.x0 - p.x1) * 0.07 });
  });
  return segs;
}
export const WALK = { 1: buildWalk(1), 2: buildWalk(2) };
/** The walkway height of canopy story s at x. */
export function walkY(s, x) {
  const segs = WALK[s], first = segs[0], last = segs[segs.length - 1];
  if (x <= first.x0) return first.y; if (x >= last.x1) return last.y;
  for (const g of segs) if (x >= g.x0 && x <= g.x1) {
    if (g.kind !== 'bridge') return g.y;
    const f = (x - g.x0) / (g.x1 - g.x0); return lerp(g.y0, g.y1, f) + g.sag * Math.sin(Math.PI * f);
  }
  return last.y;
}
/** Plots kept free for future crew members' tree houses: the bough platforms, four on each canopy story. */
export const PLOTS = [1, 2].flatMap(s => WALK[s].filter(g => g.kind === 'bough').map((g, i) => ({ id: `c${s}-${'abcd'[i]}`, story: s, x: (g.x0 + g.x1) / 2, y: g.y, w: g.x1 - g.x0 })));
/** Rope ladders between Canopy 1 and Canopy 2, beside two of the trunks. */
export const LADDERS = [232 + 13, 664 - 13].map(x => ({ x, from: 1, to: 2 }));

// the trunk's radius at height y: it tapers from its ground size up to about half at the top of the world
export const trunkR = (tx, y) => (tx === BIG_TRUNK ? 8.2 : 4.1) * lerp(1, 0.55, Math.max(0, Math.min(1, (14 - y) / (14 - TOP))));

// light changes with height: damper, cooler and hazier low down, warmer and sunlit near the top
const tone = (pal, s) => pal.map(c => s === 2 ? mixc(c, SUN, 0.12) : mixc(c, [40, 70, 80], 0.1));
const barkM = s => mat(s === 2 ? mixc(C.bark, SUN, 0.08) : C.bark, { rim: s === 2 ? 0.75 : 0.45 });
const vineM = mat([72, 106, 52]);

// a limb from (x0,y0) to (x1,y1), bowed, tapering r0 → r1
function limb(fb, x0, y0, x1, y1, r0, r1, m, bow = 0) {
  const n = Math.max(4, Math.round(Math.hypot(x1 - x0, y1 - y0) / 5));
  let px = x0, py = y0;
  for (let i = 1; i <= n; i++) { const f = i / n, x = lerp(x0, x1, f), y = lerp(y0, y1, f) - Math.sin(Math.PI * f) * bow; fb.cap(px, py, x, y, lerp(r0, r1, (i - 1) / n), lerp(r0, r1, f), m); px = x; py = y; }
}
// a hanging liana with alternate leaves; it may end in a flower
function liana(fb, x, y, len, seed, s) {
  let px = x, py = y; const sway = (hash(seed, 1) - 0.5) * 0.5;
  for (let k = 0; k < len; k++) {
    const nx = px + Math.sin(k * 0.12 + seed) * 0.35 + sway * 0.05, ny = py + 1;
    fb.put(nx - fb.ox, ny, k % 9 < 5 ? vineM.b : vineM.s);
    if (k % 5 === 3) { const d = (k / 5) & 1 ? 1 : -1, g = tone(GREENS.jungle, s); fb.put(nx + d - fb.ox, ny, g[2]); fb.put(nx + d * 2 - fb.ox, ny + 1, g[1]); }
    px = nx; py = ny;
  }
  const r = hash(seed, 2); if (r < 0.55) flower(fb, px, py + 1, r < 0.2 ? 'hibiscus' : r < 0.4 ? 'orchid' : 'plumeria');
}
// a looping liana slung between two points
function loop(fb, x0, y0, x1, y1, sag, s, seed) {
  const n = Math.ceil(Math.abs(x1 - x0)), g = tone(GREENS.jungle, s);
  for (let i = 0; i <= n; i++) { const f = i / n, x = lerp(x0, x1, f), y = lerp(y0, y1, f) + sag * Math.sin(Math.PI * f); fb.put(x - fb.ox, y, vineM.b); if (i % 6 === 2) fb.put(x - fb.ox, y + 1, g[2]); if (i % 11 === 7 && hash(i, seed) < 0.5) flower(fb, x, y + 2, 'orchid'); }
}
// a bromeliad: a little rosette of stiff leaves with a red-orange heart
function bromeliad(fb, x, y, seed) {
  const g = GREENS.jungle;
  for (let k = -3; k <= 3; k++) { const h = 3 - Math.abs(k) * 0.6; for (let j = 0; j < h; j++) fb.put(x + k * 0.8 - fb.ox, y - j - (Math.abs(k) < 2 ? 0.5 : 0), j > h - 1.5 ? g[2] : g[1]); }
  fb.put(x - fb.ox, y - 2, hash(seed, 3) < 0.5 ? [230, 60, 70] : [250, 120, 50]); fb.put(x + 1 - fb.ox, y - 3, [250, 150, 60]);
}

function platform(fb, x0, x1, y) {
  const w = mat(C.wood);
  fb.rect(x0, y, x1, y + 3, w.b);
  for (let x = Math.ceil(x0); x < x1; x += 5) fb.rect(x, y, x + 1, y + 3, w.s);
  fb.rect(x0, y, x1, y + 1, w.l); fb.rect(x0, y + 3, x1, y + 4, [44, 32, 26]);
}
function bridge(fb, g) {
  const rope = mat(C.rope), w = mat(C.wood), at = (f, lift) => [lerp(g.x0, g.x1, f), lerp(g.y0, g.y1, f) + g.sag * Math.sin(Math.PI * f) * (lift ? 0.55 : 1) - (lift || 0)];
  const n = Math.ceil(g.x1 - g.x0);
  for (let i = 0; i <= n; i++) {
    const f = i / n, [x, y] = at(f, 0);
    fb.rect(x, y, x + 1, y + 2, i % 3 === 2 ? w.s : w.b);           // slats
    const [rx, ry] = at(f, 7); fb.put(rx - fb.ox, ry, rope.b);      // hand rope
    if (i % 6 === 0) for (let yy = ry + 1; yy < y; yy++) fb.put(x - fb.ox, yy, rope.s);   // hangers
  }
  for (let i = 0; i <= n; i++) { const [x, y] = at(i / n, 0); fb.put(x - fb.ox, y + 2, rope.s); }
}
function ladder(fb, x, yTop, yBot) {
  const r = mat(C.rope);
  fb.rect(x - 4, yTop, x - 3, yBot, r.b); fb.rect(x + 3, yTop, x + 4, yBot, r.b);
  for (let y = yTop + 3; y < yBot; y += 4) fb.rect(x - 3, y, x + 3, y + 1, r.s);
}
function plotMarker(fb, p) {
  const stake = mat(C.wood), x0 = p.x - p.w / 2 + 4, x1 = p.x + p.w / 2 - 4, y = p.y;
  for (const x of [x0, x1]) fb.rect(x, y - 7, x + 1, y, stake.s);
  for (let x = x0; x <= x1; x++) fb.put(x - fb.ox, y - 6 + Math.sin((x - x0) / (x1 - x0) * Math.PI) * 1.2, [222, 210, 180]);   // a string between the stakes
  fb.rect(p.x - 0.5, y - 9, p.x + 0.5, y, stake.b); fb.rect(p.x - 4, y - 13, p.x + 4, y - 8, C.paper); fb.rect(p.x - 4, y - 8, p.x + 4, y - 7, mat(C.paper).s);   // a blank sign: this plot is free
}

/** The canopy's back layer (parallax 0.55, hazy): the far trees reaching up, with crowns at both stories. */
export function paintCanopyBack(back) {
  // first a deep wall of hazy leaves, so the canopy feels dense, with only small gaps of sky
  for (const s of [1, 2]) {
    const base = STORY_Y[s]; back.fog = s === 1 ? 0.58 : 0.46; back.fogc = s === 1 ? [52, 74, 84] : [96, 104, 120];
    const pal = tone(GREENS.jungle, s).map(c => c.map(v => v * 0.8));
    for (let row = 0; row < 5; row++) for (let i = 0; i < 26; i++) {
      if (hash(i, row, s, 90) < (row === 4 ? 0.3 : 0.1)) continue;                                   // a gap where the sky shows through
      const x = i * (back.w / 25) + (hash(i, row, s, 91) - 0.5) * 20 + (row & 1) * 12, y = base - 120 + row * 42 + (hash(i, row, s, 92) - 0.5) * 18;
      foliage(back, x, y, 18 + hash(i, row, s, 93) * 14, 13 + hash(i, row, s, 94) * 8, pal, 2000 + i * 7 + row * 131 + s * 977);
    }
  }
  back.fogc = [150, 140, 130];
  for (let i = 0; i < 12; i++) {
    const x = 20 + i * (back.w - 40) / 11 + (hash(i, 3) - 0.5) * 16;
    back.fog = 0.42; trunk(back, x, TOP, 24, 3, 2, [70, 58, 48], i + 50);
    for (const s of [1, 2]) {
      back.fog = s === 1 ? 0.42 : 0.3;
      const cy = STORY_Y[s] - 44 + hash(i, s, 4) * 14;
      foliageMass(back, x, cy, 70 + hash(i, s, 5) * 30, 34, tone(GREENS.canopy, s), 800 + i * 7 + s, 10);
      back.cap(x, STORY_Y[s] + 10 + hash(i, s, 6) * 10, x + (hash(i, s, 7) < 0.5 ? -30 : 30), STORY_Y[s] - 4 + hash(i, s, 8) * 8, 1.4, 0.8, mat([92, 74, 58]));
    }
    back.fog = 0.22; foliageMass(back, x + 10, TOP + 14 + hash(i, 9) * 18, 54, 26, tone(GREENS.canopy, 2), 900 + i, 8);   // the forest roof
  }
  back.fog = 0;
}
// dark clumps behind, lit clumps in front; `blooms` flowers tucked into the lit clumps
const BLOOMS = ['orchid', 'hibiscus', 'plumeria', 'orchid', 'heliconia', 'hibiscus'];
function foliageMass(fb, cx, cy, w, h, pal, seed, n = 12, blooms = 0) {
  const dark = pal.map(c => c.map(v => v * 0.7));
  for (let i = 0; i < n; i++) foliage(fb, cx + (hash(i, seed, 1) - 0.5) * w, cy + (hash(i, seed, 2) - 0.4) * h * 0.7, w * (0.15 + hash(i, seed, 3) * 0.1), h * (0.22 + hash(i, seed, 4) * 0.12), dark, seed + i);
  for (let i = 0; i < n; i++) foliage(fb, cx + (hash(i, seed, 5) - 0.5) * w * 0.85, cy + (hash(i, seed, 6) - 0.55) * h * 0.6, w * (0.12 + hash(i, seed, 7) * 0.08), h * (0.18 + hash(i, seed, 8) * 0.1), pal, seed + 40 + i);
  for (let i = 0; i < blooms; i++) flower(fb, cx + (hash(i, seed, 9) - 0.5) * w * 0.7, cy + (hash(i, seed, 10) - 0.2) * h * 0.4, BLOOMS[(seed + i) % BLOOMS.length], hash(i, seed, 11) < 0.35);
}

/** The canopy stories in the village layer (parallax 1): trunks, boughs, leaves, lianas, flowers, walkways, ladders and plots. */
export function paintCanopy(mid) {
  // the great trunks carry on up through both stories
  for (const tx of TRUNKS) trunk(mid, tx, TOP, 16, trunkR(tx, 16), trunkR(tx, TOP), C.bark, tx + 7);
  for (const s of [1, 2]) {
    const base = STORY_Y[s], pal = tone(GREENS.canopy, s), bark = barkM(s);
    // leaf masses high in the story, behind everything else
    for (let i = 0; i < 13; i++) { const x = 20 + i * 76 + (hash(i, s, 10) - 0.5) * 30; foliageMass(mid, x, base - 88 + hash(i, s, 11) * 22, 66 + hash(i, s, 12) * 30, 30, pal.map(c => c.map(v => v * 0.82)), 1000 + i * 13 + s, 9, 2); }
    // boughs fork up and out of each trunk into the leaves
    TRUNKS.forEach((tx, i) => {
      for (const side of [-1, 1]) {
        const y0 = base - 16 - hash(i, s, side + 20) * 18, len = 40 + hash(i, s, side + 22) * 26, x1 = tx + side * len, y1 = y0 - 22 - hash(i, s, side + 24) * 16;
        limb(mid, tx + side * trunkR(tx, y0) * 0.5, y0, x1, y1, trunkR(tx, y0) * 0.55, 0.9, bark, -4);
        const fx = lerp(tx, x1, 0.55), fy = lerp(y0, y1, 0.55) + 2;                       // a fork part-way along
        limb(mid, fx, fy, fx + side * 18, fy - 4 + hash(i, s, side + 26) * 6, 1.4, 0.6, bark, 2);
        foliageMass(mid, x1, y1 - 4, 34, 18, pal, 1300 + i * 5 + s * 2 + side, 6, 3);
        foliage(mid, fx + side * 18, fy - 4, 7, 4, pal, 1400 + i * 5 + s + side);
        if (hash(i, s, side + 28) < 0.7) bromeliad(mid, lerp(tx, x1, 0.3), lerp(y0, y1, 0.3) - 1.5, i + s * 9 + side);
        for (let k = 0; k < 3; k++) { const f = 0.35 + k * 0.25; liana(mid, lerp(tx, x1, f), lerp(y0, y1, f) + 1, 14 + hash(i, s, k, 30) * 40, i * 31 + s * 7 + k + side * 3, s); }
      }
    });
    // the walkway: platforms held up by braces from the trunks, joined by rope bridges
    for (const g of WALK[s]) {
      if (g.kind === 'bridge') continue;
      if (g.kind === 'trunk') for (const ex of [g.x0 + 3, g.x1 - 3]) limb(mid, g.tx + Math.sign(ex - g.tx) * trunkR(g.tx, g.y + 18) * 0.6, g.y + 20, ex, g.y + 3, 1.8, 1.1, bark);
      else {   // a great bough grows out of the nearer trunk to carry the platform, and forks on up into the leaves
        const side = Math.sign((g.x0 + g.x1) / 2 - g.tx), ys = g.y + 34;
        limb(mid, g.tx + side * trunkR(g.tx, ys) * 0.5, ys, g.x0 + (g.x1 - g.x0) / 2 + side * 6, g.y + 3, trunkR(g.tx, ys) * 0.42, 1.4, bark, -6);
        limb(mid, (g.x0 + g.x1) / 2 + side * 6, g.y + 3, g.x1 - (side > 0 ? 0 : 42) + side * 14, g.y - 26, 1.6, 0.8, bark, 3);
        foliageMass(mid, g.x1 - (side > 0 ? 0 : 42) + side * 16, g.y - 30, 28, 14, pal, 1500 + g.x0, 5, 2);
      }
    }
    for (const g of WALK[s]) if (g.kind === 'bridge') bridge(mid, g); else platform(mid, g.x0, g.x1, g.y);
    // lianas looping between neighbouring boughs, and vines hanging below the walkway
    for (let i = 0; i < 9; i++) { const x = 40 + i * 104 + hash(i, s, 40) * 30; loop(mid, x, base - 40 - hash(i, s, 41) * 20, x + 30 + hash(i, s, 42) * 30, base - 36 - hash(i, s, 43) * 20, 8 + hash(i, s, 44) * 10, s, i + s * 20); }
    for (let i = 0; i < 26; i++) { const x = 30 + hash(i, s, 50) * (WORLD - 60), y = walkY(s, x) + 4; liana(mid, x, y, 8 + hash(i, s, 51) * 30, 500 + i + s * 40, s); }
    // flowers on the boughs and the platform edges
    for (let i = 0; i < 14; i++) { const x = 30 + hash(i, s, 63) * (WORLD - 60); bromeliad(mid, x, walkY(s, x) - 0.5, i + s * 50); }
  }
  for (const l of LADDERS) ladder(mid, l.x, walkY(2, l.x) + 2, walkY(1, l.x));
  for (const p of PLOTS) plotMarker(mid, p);
}

/** The sky above the ground village's sunset, deepening to evening blue at the top of the world, with high wisps. */
export function paintHighSky(sky, top0) {
  for (let y = TOP; y < 0; y++) for (let x = 0; x < sky.w; x++) {
    const f = (y - TOP) / -TOP, q = Math.floor(f * 8 + bayer(x, y) * 0.9) / 8;
    sky.put(x, y, mixc([18, 26, 54], top0, Math.min(1, q)));
  }
  for (let i = 0; i < 7; i++) {
    const cx = hash(i, 71) * sky.w, cy = TOP + 30 + hash(i, 72) * 200, w = 30 + hash(i, 73) * 50;
    for (let x = Math.floor(cx - w); x < cx + w; x++) { const d = Math.abs(x - cx) / w; if (bayer(x, cy | 0) < 1 - d) sky.put(x, cy + Math.sin(x / 9) * 1.5, mixc([120, 110, 150], [210, 150, 150], 1 - d)); }
  }
}
