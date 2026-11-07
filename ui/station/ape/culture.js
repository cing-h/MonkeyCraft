// MonkeyCraft ape village: the villagers' culture, a Civilization of Knowledge (see docs/culture.md).
//
// Painted once into the village layer: carved totems, pennant bunting, painted glyphs on the huts,
// gourd lanterns, idea-nets, masks and shields on the Chief's lodge, an offering shrine, the market
// stall, the painter's easel, the carver's unfinished totem, the weaver's loom and her rugs, and the
// Council Ring on the great tree's Canopy 1 platform. Also the gathering schedule (pure, injected rnd).
// Everything here is scenery: none of it claims that work is happening.

import { GROUND, hash, lerp, mat, mixc } from './fb.js';
import { C, LIGHT } from './cast.js';
import { WALK, walkY } from './canopy.js';
import { PERCH_Y } from './world.js';

// ---------- the glyph alphabet: eye (seeing), leaf (growing), spiral (learning), hand (sharing), scroll (keeping) ----------
export const GLYPHS = {
  eye: ['01110', '10001', '10101', '10001', '01110'],
  leaf: ['00100', '01110', '11111', '01110', '00100'],
  spiral: ['11111', '10001', '10111', '10101', '11101'],
  hand: ['10101', '10101', '11111', '11111', '01110'],
  scroll: ['11110', '10011', '10001', '11001', '01111']
};
const OCHRE = [214, 150, 60], CHALK = [232, 222, 196], RED = [178, 58, 42], INDIGO = [70, 80, 150];
export function glyph(fb, name, x, y, c = CHALK) { GLYPHS[name].forEach((row, r) => { for (let k = 0; k < 5; k++) if (row[k] === '1') fb.put(x + k - fb.ox, y + r, c); }); }

// ---------- the Council Ring: the wide platform round the great tree on Canopy 1 ----------
const ringSeg = () => WALK[1].find(g => g.kind === 'trunk' && g.tx === 480);
export const RING = (() => {
  const g = ringSeg(), y = g.y;
  const seats = [426, 437, 448, 459, 499, 510, 521].map((x, i) => ({ x, y, facing: x < 480 ? 1 : -1, drum: i === 6 }));
  return { x0: g.x0, x1: g.x1, y, seats, fire: { x: 480, y: y - 1 }, lanterns: Array.from({ length: 12 }, (_, i) => { const f = (i + 0.5) / 12, x = lerp(g.x0 + 4, g.x1 - 4, f); return { x, y: y - 30 + Math.sin(Math.PI * f) * 6 }; }) };
})();

// ---------- where the villagers ply their trades (scenery) ----------
// lane, where to stand, which way to face, and the work pose. Swingers climb onto the platform to work.
export const TRADES = {
  vendor: { lane: 'ground', x: 566, facing: -1, anim: 'talk', what: 'keeps the fruit stall' },
  painter: { lane: 'ground', x: 258, facing: 1, anim: 'paint', what: 'paints at the easel' },
  carver: { lane: 'ground', x: 672, facing: 1, anim: 'carve', what: 'carves the new totem' },
  weaver: { lane: 'c2', x: 912, facing: 1, anim: 'weave', what: 'weaves at the loom' },
  courier: { lane: 'ground', x: 550, facing: -1, anim: 'look', what: 'carries fruit up to the trees' }
};
/** Where each crew member sits at a council (the Chief nearest the great tree), and where the villagers stand to watch. */
export const COUNCIL_SEATS = { chief: 459, smith: 448, scout: 437, archivist: 426, writer: 499, inspector: 510, sage: 499, ringer: 510, clerk: 520 };
export const AUDIENCE = [404, 411, 538, 545];
/** Where the courier takes a basket: up to the Ring, or to the weaver's platform. */
export const DELIVERIES = [{ lane: 'c1', x: 432 }, { lane: 'c2', x: 900 }];

// ---------- painters ----------
function totem(fb, x, base, faces, unfinished = false) {
  const w = mat([132, 96, 62], { rim: 0.6 }), h = faces.length * 9 + 4;
  fb.rect(x - 4, base - h, x + 4, base, w.b); fb.rect(x + 2, base - h, x + 4, base, w.s); fb.rect(x - 4, base - h, x - 3, base, w.l);
  faces.forEach((key, i) => {
    const y = base - 4 - (i + 1) * 9, c = LIGHT[key] || OCHRE, dark = [44, 28, 20];
    if (unfinished && i === faces.length - 1) { for (let k = 0; k < 6; k++) fb.put(x - 3 + k - fb.ox, y + 3 + (k & 1), w.s); return; }   // the top face is still rough wood
    fb.rect(x - 4, y, x + 4, y + 1, mixc(c, dark, 0.3));                             // brow
    fb.put(x - 2 - fb.ox, y + 3, c); fb.put(x + 1 - fb.ox, y + 3, c); fb.put(x - 2 - fb.ox, y + 2, dark); fb.put(x + 1 - fb.ox, y + 2, dark);   // eyes
    fb.rect(x - 2, y + 6, x + 2, y + 7, RED); fb.put(x - fb.ox, y + 5, mixc(c, dark, 0.5));   // nose and mouth
  });
  if (!unfinished) for (const s of [-1, 1]) fb.poly([[x + s * 4, base - h + 2], [x + s * 12, base - h - 3], [x + s * 4, base - h + 6]], s < 0 ? OCHRE : RED);   // wings at the top
  for (let i = 0; i < 4; i++) fb.put(x - 4 + i * 3 - fb.ox, base - 1, [60, 44, 30]);
}
function bunting(fb, x0, y0, x1, y1, sag, seed, every = 5) {
  const cols = [LIGHT.chief, LIGHT.scout, LIGHT.smith, LIGHT.archivist, LIGHT.writer, LIGHT.ringer, OCHRE, RED].map(c => mixc(c, [120, 90, 70], 0.3));
  const n = Math.ceil(Math.abs(x1 - x0)), at = f => [lerp(x0, x1, f), lerp(y0, y1, f) + sag * Math.sin(Math.PI * f)];
  for (let i = 0; i <= n; i++) { const [x, y] = at(i / n); fb.put(x - fb.ox, y, [96, 76, 56]); }
  for (let i = 2; i < n - 2; i += every) { const [x, y] = at(i / n), c = cols[(i / every + seed) % cols.length | 0]; fb.poly([[x - 1.5, y], [x + 1.5, y], [x, y + 4]], c); }
}
export function gourd(fb, x, y) { fb.put(x - fb.ox, y - 3, [96, 76, 56]); fb.ell(x, y, 1.6, 2, mat([210, 140, 60])); }   // a hanging gourd lantern (its glow is drawn each frame)
function ideaNet(fb, x, y, r = 4) {
  const c = [196, 170, 120];
  for (let a = 0; a < 40; a++) { const t = a / 40 * Math.PI * 2; fb.put(x + Math.cos(t) * r - fb.ox, y + Math.sin(t) * r, [120, 86, 52]); }
  for (let k = -r + 1; k < r; k += 2) { fb.put(x + k - fb.ox, y, c); fb.put(x - fb.ox, y + k, c); }
  for (const dx of [-2, 0, 2]) for (let k = 1; k < 5; k++) fb.put(x + dx - fb.ox, y + r + k, k > 2 ? [230, 230, 220] : c);   // feathers
}
function mask(fb, x, y, c) { fb.ell(x, y, 2.6, 3.4, mat(c)); fb.put(x - 1 - fb.ox, y - 1, [30, 20, 16]); fb.put(x + 1 - fb.ox, y - 1, [30, 20, 16]); fb.rect(x - 1, y + 1.5, x + 1, y + 2.5, RED); }
function shield(fb, x, y, c) { fb.ell(x, y, 3.2, 3.2, mat(c)); fb.ell(x, y, 1.2, 1.2, mat(CHALK)); }
function shrine(fb, x) {
  const st = mat(C.stone), y = GROUND;
  fb.rect(x - 7, y - 4, x + 7, y, st.b); fb.rect(x - 7, y - 4, x + 7, y - 3, st.l);
  fb.rect(x - 6, y - 14, x - 5, y - 4, C.wood); fb.rect(x + 5, y - 14, x + 6, y - 4, C.wood);
  fb.poly([[x - 9, y - 13], [x, y - 19], [x + 9, y - 13]], mat(C.thatch).b);
  for (let i = 0; i < 3; i++) fb.ell(x - 3 + i * 2, y - 6, 1.2, 0.8, mat([236, 200, 60]));   // bananas
  fb.ell(x + 3, y - 6, 1.3, 1.3, mat([236, 120, 40]));                                    // a mango
  fb.cap(x - 4, y - 9, x + 2, y - 9, 0.9, 0.9, mat(C.paper));                              // a scroll
  glyph(fb, 'spiral', x - 2, y - 17, OCHRE);
}
function stall(fb, x0, x1) {
  const y = GROUND, w = mat(C.wood);
  for (const x of [x0, x1]) fb.rect(x, y - 18, x + 1, y, w.s);
  for (let x = x0 - 2; x < x1 + 3; x++) { const red = ((x - x0) >> 2) & 1; fb.rect(x, y - 21, x + 1, y - 17 + (x & 1), red ? [196, 70, 52] : [232, 214, 170]); }   // a striped awning
  fb.rect(x0, y - 7, x1 + 1, y - 5, w.b); fb.rect(x0, y - 5, x1 + 1, y, w.s);              // the counter
  const fruit = [[236, 200, 60], [236, 120, 40], [200, 60, 60], [120, 180, 70]];
  for (let i = 0; i < 4; i++) { const bx = x0 + 3 + i * ((x1 - x0 - 4) / 4); fb.ell(bx + 2, y - 7, 2.6, 1.4, mat([150, 110, 60])); for (let k = 0; k < 3; k++) fb.ell(bx + 1 + k, y - 9 + (k & 1) * 0.5, 1, 1, mat(fruit[i])); }   // baskets of fruit
  for (let i = 0; i < 3; i++) fb.ell(x1 + 5, y - 2 - i * 2.2, 2.2, 1.1, mat([150, 110, 60]));   // baskets stacked to take up the trees
}
function easel(fb, x) {
  const y = GROUND, w = mat(C.wood);
  fb.cap(x - 3, y, x, y - 18, 0.6, 0.6, w); fb.cap(x + 3, y, x, y - 18, 0.6, 0.6, w);
  fb.rect(x - 6, y - 19, x + 6, y - 9, [236, 226, 200]);                                    // the board
  fb.rect(x - 6, y - 19, x + 6, y - 15, [240, 170, 110]); fb.ell(x - 2, y - 16, 1.6, 1.6, mat([255, 230, 150]));   // a painted sunset
  fb.rect(x - 6, y - 12, x + 6, y - 9, [70, 120, 60]); fb.rect(x + 2, y - 15, x + 3, y - 11, [60, 40, 30]); fb.ell(x + 2.5, y - 15.5, 2, 1.3, mat([60, 110, 50]));   // jungle, and a tree
  for (const [dx, c] of [[-8, RED], [-10, OCHRE], [-12, INDIGO]]) fb.ell(x + dx + 20, y - 1, 1.2, 0.8, mat(c));   // pots of paint
}
function loom(fb, x, y) {
  const w = mat(C.wood);
  fb.rect(x - 6, y - 14, x - 5, y, w.s); fb.rect(x + 5, y - 14, x + 6, y, w.s); fb.rect(x - 6, y - 15, x + 6, y - 14, w.b);
  const cols = [RED, OCHRE, INDIGO, CHALK];
  for (let r = 0; r < 9; r++) for (let k = -4; k <= 4; k++) fb.put(x + k - fb.ox, y - 12 + r, cols[(r >> 1) % 4]);   // the half-woven cloth
  for (let k = -4; k <= 4; k += 2) fb.rect(x + k, y - 3, x + k + 0.6, y - 1, [210, 200, 170]);   // the warp threads below it
}
function rug(fb, x, y, seed) { const cols = [RED, OCHRE, INDIGO, CHALK, [90, 140, 80]]; for (let r = 0; r < 9; r++) for (let k = 0; k < 7; k++) fb.put(x + k - fb.ox, y + r, cols[(r + (k === 0 || k === 6 ? 2 : 0) + seed) % 5]); }

function ring(fb) {
  const y = RING.y, wood = mat(C.wood);
  // woven mats round the great tree, log stools, and the council drum
  for (const [a, b, c] of [[RING.x0 + 2, 468, RED], [492, RING.x1 - 2, INDIGO]]) for (let x = a; x < b; x++) fb.put(x - fb.ox, y - 1, ((x >> 1) & 1) ? c : OCHRE);
  for (const s of RING.seats) if (!s.drum) fb.ell(s.x, y - 1.5, 2.4, 1.3, mat([110, 78, 50]));
  const d = RING.seats.find(s => s.drum); fb.ell(d.x - 6, y - 4, 2.6, 3.6, mat([150, 96, 60])); fb.ell(d.x - 6, y - 7.4, 2.6, 0.9, mat(CHALK)); glyph(fb, 'hand', d.x - 8, y - 5, RED);
  // the great trunk is the talking-totem: three carved faces
  for (let i = 0; i < 3; i++) { const fy = y - 14 - i * 12; fb.rect(476, fy, 484, fy + 1, [60, 40, 30]); fb.put(477 - fb.ox, fy + 3, OCHRE); fb.put(482 - fb.ox, fy + 3, OCHRE); fb.rect(477, fy + 6, 483, fy + 7, RED); glyph(fb, ['eye', 'spiral', 'hand'][i], 478, fy - 5, CHALK); }
  // the fire bowl in front of the tree (its flames are drawn each frame)
  fb.ell(RING.fire.x, y - 2, 5, 2, mat(C.stone)); fb.rect(RING.fire.x - 4, y - 3, RING.fire.x + 4, y - 2, [40, 30, 26]);
  // banners hanging from the boughs above, and the lantern string (lanterns are lit one per job finished today)
  for (const [x, g] of [[430, 'eye'], [452, 'leaf'], [508, 'spiral'], [526, 'scroll']]) { fb.rect(x - 3, y - 48, x + 3, y - 33, [150, 52, 40]); for (let k = -3; k < 3; k += 2) fb.put(x + k - fb.ox, y - 32, OCHRE); glyph(fb, g, x - 2, y - 44, CHALK); fb.rect(x - 4, y - 49, x + 4, y - 48, wood.s); }
  const L = RING.lanterns;
  for (let i = 0; i + 1 < L.length; i++) for (let k = 0; k <= 8; k++) { const f = k / 8; fb.put(lerp(L[i].x, L[i + 1].x, f) - fb.ox, lerp(L[i].y, L[i + 1].y, f) - 3 + Math.sin(Math.PI * f), [96, 76, 56]); }
  ideaNet(fb, 466, y - 40); ideaNet(fb, 496, y - 36, 3);
}

/** Paint the culture into the village layer. Returns the extra lamp glows to add (gourd lanterns). */
export function paintCulture(mid) {
  const glows = [];
  // the ground village: totems, bunting between the trees, glyphs on the huts, the shrine, masks and shields on the lodge
  totem(mid, 438, GROUND, ['chief', 'scout', 'smith', 'writer']);
  totem(mid, 680, GROUND, ['inspector', 'sage', 'ringer'], true);                       // the new totem the carver is working on
  for (let i = 0; i < 6; i++) mid.put(684 + (hash(i, 7) - 0.5) * 8 - mid.ox, GROUND - 1, [196, 160, 110]);   // wood shavings
  bunting(mid, 232, 70, 480, 68, 9, 0); bunting(mid, 480, 68, 664, 72, 8, 3); bunting(mid, 50, 74, 232, 70, 7, 5); bunting(mid, 664, 72, 912, 74, 9, 2);
  for (const [x, y, g] of [[160, 96, 'spiral'], [298, 80, 'scroll'], [395, 98, 'leaf'], [604, 94, 'eye'], [731, 99, 'hand'], [846, 100, 'eye']]) glyph(mid, g, x, y, OCHRE);
  shrine(mid, 650);
  for (const [x, c] of [[501, OCHRE], [513, RED]]) mask(mid, x, 16, c);   // masks on the lodge wall, either side of the door
  for (const [x, c] of [[412, RED], [433, INDIGO], [444, OCHRE]]) shield(mid, x, PERCH_Y + 7, c);   // shields on the lodge platform's edge
  ideaNet(mid, 55, 40); ideaNet(mid, 917, 44, 3);
  // commerce and art
  stall(mid, 532, 558); easel(mid, 268); loom(mid, 926, walkY(2, 926));
  for (const g of WALK[2]) if (g.kind === 'bridge' && g.x1 - g.x0 > 40) for (let k = 0; k < 2; k++) { const x = lerp(g.x0, g.x1, 0.3 + k * 0.35), y = lerp(g.y0, g.y1, 0.3 + k * 0.35) + g.sag * Math.sin(Math.PI * (0.3 + k * 0.35)) * 0.55 - 7; rug(mid, x - 3, y, k + (g.x0 | 0)); }   // the weaver's rugs drying on the bridge ropes
  // the canopy: bunting along the bridge hand-ropes, and gourd lanterns hanging from the boughs
  for (const s of [1, 2]) for (const g of WALK[s]) if (g.kind === 'bridge') bunting(mid, g.x0, g.y0 - 8, g.x1, g.y1 - 8, g.sag * 0.55 + 1, (g.x0 | 0) + s, 6);
  for (const s of [1, 2]) for (let i = 0; i < 10; i++) { const x = 40 + i * 96 + hash(i, s, 33) * 30, y = walkY(s, x) - 22 - hash(i, s, 34) * 14; mid.rect(x, y - 8, x + 1, y - 3, [96, 76, 56]); gourd(mid, x, y); glows.push([x, y]); }
  ring(mid);
  return glows;
}

// ---------- gatherings at the Ring (scenery) ----------
export const GATHER = { first: [50, 110], every: [240, 420], lasts: [70, 100] };
/** Now and then the villagers (and any crew who are free) gather at the Ring to drum and talk. */
export function makeGatherings({ rnd, reduced = false }) {
  const span = ([a, b]) => a + rnd() * (b - a);
  let next = span(GATHER.first), left = 0, n = 0;
  return {
    step(dt) {
      if (left > 0) { left -= dt; if (left <= 0) next = span(GATHER.every) * (reduced ? 1.5 : 1); return left > 0; }
      next -= dt; if (next <= 0) { left = span(GATHER.lasts); n++; return true; }
      return false;
    },
    get active() { return left > 0; },
    get count() { return n; }
  };
}
