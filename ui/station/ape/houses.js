// MonkeyCraft ape village: the crew's houses, painted into the village layer (village revamp, phase 5).
//
// Every house keeps its place, door and windows (the crew's stations don't move); each gains the
// things its trade needs, so you can tell at a glance whose house is whose:
//   smithy      a stone forge under a lean-to (its mouth glows while the Smith works), bellows, anvil, quench barrel, tool rack
//   archive     scroll racks, and a ladder up to a loft in the roof
//   writer      a lantern-lit porch with a writing desk, and freshly written pages drying on a line
//   workshop    a rack of lenses and a test bench with a vice, glassware and a balance
//   bathhouse   stepping stones across the hot spring, a bamboo spout, a tub and towels
//   bell tower  carved and painted posts, crossed braces, a finial and a bell rope
//   lookout     a telescope on a tripod and a flag (the flag flutters in scene.js)
//   counting house  a hanging sign, window boxes and an abacus on the porch
//   the Chief's great lodge: a main hall with carved posts, banners and gourd lanterns, an upper chamber
//     with a balcony and his high seat, a gong, a lookout cupola, and rope walks out to the branches.
// Windows are listed in `lights` (lit in the crew member's colour while it works, see scene.js);
// `lamps` are always-on glows. Returns extra spots scene.js animates (forge, chimney, flag).

import { C } from './cast.js';
import { GROUND, hash, mat } from './fb.js';

export const LODGE = { x0: 486, x1: 540, upper: [494, 532], plat1: 566, gong: 552, balcony: [532, 548], bannerX: 562 };

export function paintHouses(mid, { PERCH_Y, branchY, PLOTS, HOMES, lights, lamps }) {
  const W = mat(C.wood), DARK = C.dark;
  const hut = (x0, x1, base, wallTop, roofTop, opts = {}) => {
    const wall = mat(opts.wall || C.wood), roof = mat(opts.roof || C.thatch);
    if (opts.stilts) for (const sx of [x0 + 2, x1 - 3, (x0 + x1) / 2]) mid.cap(sx, base, sx, GROUND + 1, 1, 1, W);
    mid.rect(x0, wallTop, x1, base, wall.b);
    if (opts.stone) {   // dressed stone: courses of blocks with staggered joints, lit along their tops
      for (let y = wallTop; y < base; y += 4) {
        mid.rect(x0, y, x1, y + 1, wall.s);
        for (let x = x0 + ((y / 4) & 1 ? 3 : 0); x < x1; x += 6 + Math.floor(hash(x, y, 36) * 3)) mid.rect(x, y, x + 1, y + 4, wall.s);
        for (let x = Math.ceil(x0); x < x1; x++) if (hash(x, y, 37) < 0.3) mid.put(x, y + 1, wall.l);
      }
    } else {
      for (let x = Math.ceil(x0); x < x1; x += 4) mid.rect(x, wallTop, x + 1, base, wall.s);
      for (let y = wallTop + 3; y < base; y += 5) for (let x = Math.ceil(x0); x < x1; x++) if (hash(x, y, 34) < 0.25) mid.put(x, y, wall.l);
    }
    mid.rect(x0, base - 1, x1, base + 1, wall.s);
    const ov = opts.overhang ?? 5;
    mid.poly([[x0 - ov, wallTop + 2], [(x0 + x1) / 2, roofTop], [x1 + ov, wallTop + 2]], roof.b);
    mid.poly([[(x0 + x1) / 2, roofTop], [x1 + ov, wallTop + 2], [(x0 + x1) / 2 + 2, wallTop + 2]], roof.s);
    for (let k = 1; k < 6; k++) { const yy = roofTop + (wallTop + 2 - roofTop) * k / 6, half = (x1 - x0 + 2 * ov) / 2 * k / 6; for (let x = (x0 + x1) / 2 - half; x < (x0 + x1) / 2 + half; x++) if (hash(x | 0, k, 33) < 0.45) mid.put(x, yy, hash(x | 0, k, 35) < 0.5 ? roof.l : roof.s); }
    for (let x = x0 - ov; x < x1 + ov; x++) if (hash(x, 31) < 0.7) mid.rect(x, wallTop + 2, x + 1, wallTop + 3 + hash(x, 32) * 3, roof.s); // fringe
    if (opts.upturn) for (const [ex, d] of [[x0 - ov, -1], [x1 + ov, 1]]) { mid.cap(ex, wallTop + 2, ex + d * 3, wallTop - 1, 0.9, 0.6, roof); }   // the lodge's upswept eaves
  };
  const door = (x, base, h = 9) => { mid.rect(x - 3, base - h, x + 3, base, DARK); mid.rect(x - 3, base - h - 1, x + 3, base - h, W.s); };
  const windowAt = (key, x0, y0, x1, y1) => { mid.rect(x0 - 1, y1, x1 + 1, y1 + 1, W.s); mid.rect(x0, y0, x1, y1, [44, 32, 26]); lights.push({ key, x0, y0, x1, y1 }); };
  const lamp = (x, y, foot = GROUND) => { mid.rect(x, y, x + 1, foot, W.s); mid.rect(x - 1, y - 3, x + 2, y, [255, 200, 110]); lamps.push([x, y - 2]); };
  const gourd = (x, y) => { mid.rect(x, y - 3, x + 1, y - 1, [96, 76, 56]); mid.ell(x + 0.5, y + 1, 1.6, 2, { s: [220, 120, 50], b: [255, 180, 80], l: [255, 226, 150], r: [255, 240, 190] }); lamps.push([x + 0.5, y + 1]); };
  const post = (x, y0, y1, r = 1.3, carve = null) => {   // a post; carved ones get painted bands and notches
    mid.cap(x, y0, x, y1, r, r, W);
    if (carve) for (let y = y0 + 3, i = 0; y < y1 - 2; y += 5, i++) { mid.rect(x - r, y, x + r, y + 1, carve[i % carve.length]); mid.put(x - mid.ox, y + 2, W.s); }
  };
  const rail = (x0, x1, y, h = 4) => { mid.rect(x0, y - h, x1, y - h + 1, W.b); for (let x = x0; x <= x1; x += 4) mid.rect(x, y - h, x + 1, y, W.s); };
  const RED = [178, 52, 42], OCHRE = [214, 150, 60], INDIGO = [70, 76, 150], GOLD = C.gold;

  // ---------- smithy (chimpanzee): stone house, and a forge under a lean-to on its right ----------
  hut(140, 194, GROUND, 90, 70, { wall: C.stone, stone: true }); door(166, GROUND); windowAt('smith', 146, 95, 154, 101); windowAt('smith', 178, 95, 186, 101);
  mid.rect(184, 58, 191, 86, mat(C.stone).b); mid.rect(189, 58, 191, 86, mat(C.stone).s); for (let y = 60; y < 86; y += 4) mid.rect(184, y, 189, y + 1, mat(C.stone).s);
  lights.push({ key: 'smith', x0: 185, y0: 57, x1: 190, y1: 59, chimney: true });
  mid.poly([[192, 90], [219, 95], [219, 97], [192, 93]], mat([120, 96, 70]).b); mid.rect(192, 96, 219, 97, mat([120, 96, 70]).s);   // the lean-to's roof
  post(217, 96, GROUND, 1);
  mid.rect(195, 99, 205, GROUND, mat([132, 84, 66]).b); for (let y = 100; y < GROUND; y += 3) mid.rect(195, y, 205, y + 1, mat([132, 84, 66]).s);   // the brick forge
  mid.rect(197, 102, 203, 106, [40, 22, 18]); lights.push({ key: 'smith', x0: 197, y0: 102, x1: 203, y1: 106, forge: true });   // its mouth
  mid.poly([[205, 104], [212, 101], [212, 107]], mat([110, 72, 44]).b); mid.rect(205, 103, 207, 105, [80, 84, 92]);   // bellows, nozzle into the forge
  mid.rect(207, GROUND - 5, 216, GROUND - 3, [100, 104, 112]); mid.poly([[216, GROUND - 5], [219, GROUND - 4.5], [216, GROUND - 3.5]], [100, 104, 112]); mid.rect(210, GROUND - 3, 214, GROUND, [80, 84, 92]);   // anvil with its horn
  mid.rect(220, GROUND - 6, 226, GROUND, mat([110, 78, 50]).b); mid.rect(220, GROUND - 4, 226, GROUND - 3, [60, 60, 66]); mid.rect(221, GROUND - 6, 225, GROUND - 5, [60, 96, 110]);   // the quench barrel
  for (const [x, t] of [[196, 'h'], [200, 't'], [204, 'h'], [208, 't']]) {   // tools hung under the lean-to: hammers and tongs
    mid.rect(x, 93, x + 1, 98, W.s);
    if (t === 'h') mid.rect(x - 1, 92, x + 2, 94, [110, 114, 122]); else { mid.put(x - 1, 98, [110, 114, 122]); mid.put(x + 1, 98, [110, 114, 122]); }
  }

  // ---------- archive (orangutan): on stilts, with scroll racks and a ladder to the loft ----------
  hut(276, 328, GROUND - 4, 72, 52, { stilts: true }); mid.rect(276, 90, 328, 92, W.s); door(302, GROUND - 4, 10);
  for (const [x, y] of [[282, 76], [316, 76], [282, 94], [316, 94]]) windowAt('archivist', x, y, x + 6, y + 6);
  mid.rect(298, 58, 306, 66, DARK); mid.rect(297, 66, 307, 67, W.s); lights.push({ key: 'archivist', x0: 299, y0: 59, x1: 305, y1: 65 });   // the loft door in the gable
  for (let i = 0; i < 12; i++) { const f = i / 11, x = 286 + f * 12, y = GROUND - 4 - f * 38; mid.rect(x - 2, y, x + 3, y + 1, W.b); }   // the ladder up to it
  mid.cap(284, GROUND - 4, 296, 66, 0.6, 0.6, W); mid.cap(289, GROUND - 4, 301, 66, 0.6, 0.6, W);
  const rack = (x0, y0, cols, rows) => {   // a rack of pigeonholes with rolled scrolls
    mid.rect(x0, y0, x0 + cols * 4 + 1, y0 + rows * 4 + 1, W.s);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = x0 + 1 + c * 4, y = y0 + 1 + r * 4; mid.rect(x, y, x + 3, y + 3, [40, 28, 22]); if (hash(c, r, x0) < 0.8) { mid.ell(x + 1.5, y + 1.5, 1.3, 1.3, mat(C.paper)); mid.put(x + 1 - mid.ox, y + 1, hash(c, r, 9) < 0.3 ? RED : [150, 130, 100]); } }
  };
  rack(330, 78, 2, 7); rack(260, 86, 3, 5);
  mid.rect(330, 78, 331, GROUND - 4, C.wood); mid.rect(338, 78, 339, GROUND - 4, C.wood); post(259, 86, GROUND, 0.8); post(273, 86, GROUND, 0.8);

  // ---------- writer's hut (bonobo): lantern porch, desk, pages drying on a line ----------
  hut(380, 416, GROUND, 92, 72, { overhang: 7 }); door(398, GROUND); windowAt('writer', 384, 97, 390, 103); windowAt('writer', 406, 97, 412, 103);
  for (let i = 0; i < 4; i++) { const x = 376 + i * 14, y = 86 + Math.sin(i) * 2; mid.ell(x, y, 2, 2.5, mat([236, 140, 160])); lamps.push([x, y]); }
  mid.rect(362, GROUND - 2, 380, GROUND, W.s); post(363, 90, GROUND - 2, 0.8); mid.poly([[360, 90], [380, 92], [380, 94], [360, 92]], mat(C.thatch).s);   // the porch, its post and awning
  mid.rect(366, 102, 377, 104, W.b); post(367, 104, GROUND - 2, 0.6); post(376, 104, GROUND - 2, 0.6);   // the writing desk
  mid.rect(369, 101, 374, 102, C.paper); mid.rect(375, 100, 377, 102, [30, 30, 50]); mid.cap(376, 100, 378, 96, 0.4, 0.3, mat([236, 232, 222]));   // paper, inkpot, quill
  mid.ell(372, 104.5, 2.5, 1.5, mat([216, 150, 120]));   // a cushion on the stool
  for (let x = 417; x <= 438; x++) mid.put(x, 94 + Math.sin((x - 417) / 21 * Math.PI) * 3, [150, 130, 100]);   // the drying line to a post
  post(438, 93, GROUND, 0.7);
  for (const x of [420, 425, 430, 434]) { const y = 94 + Math.sin((x - 417) / 21 * Math.PI) * 3; mid.rect(x, y, x + 3, y + 5, mat(C.paper).b); mid.rect(x, y + 1, x + 3, y + 2, [120, 110, 100]); mid.put(x + 1, y + 3, [120, 110, 100]); }

  // ---------- the Chief's great lodge in the great tree ----------
  {
    const P = PERCH_Y, L = LODGE;
    // the platform, now longer, on braces from the great trunk
    mid.rect(408, P, L.plat1, P + 3, W.b); mid.rect(408, P + 3, L.plat1, P + 4, W.s); for (let x = 410; x < L.plat1; x += 5) mid.put(x, P + 1, W.l);
    for (const x of [412, 528, 556]) mid.cap(x, P + 4, 480 + (x < 480 ? -10 : 10), P + 22 + (x > 540 ? 6 : 0), 1.2, 1.2, W);
    // rope walks out to the branches either side
    const ropeWalk = (x0, y0, x1, y1) => { const n = Math.abs(x1 - x0), sag = 4 + n * 0.08;
      for (let i = 0; i <= n; i++) { const f = i / n, x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f + sag * Math.sin(Math.PI * f); mid.put(x, y, i % 3 ? W.b : W.s); mid.put(x, y - 5 + Math.sin(Math.PI * f), C.rope); if (i % 6 === 0) mid.rect(x, y - 5 + Math.sin(Math.PI * f), x + 1, y, C.rope); } };
    ropeWalk(408, P + 1, 372, branchY(372) - 1); ropeWalk(L.plat1, P + 1, 600, branchY(600) - 1);
    // main hall: carved corner posts, three windows, banners and gourd lanterns
    hut(L.x0, L.x1, P, 10, -2, { overhang: 7, upturn: true, roof: [146, 112, 64] });
    door(507, P, 11); mid.rect(503, P - 13, 511, P - 11, mat(GOLD).b);   // a gilded lintel over the door
    windowAt('chief', 491, 16, 498, 23); windowAt('chief', 516, 16, 523, 23); windowAt('chief', 529, 16, 535, 23);
    for (const x of [L.x0, L.x1]) post(x, 9, P, 1.6, [RED, OCHRE, INDIGO]);
    for (const [x, c] of [[489, RED], [537, RED]]) { mid.rect(x - 1, 12, x + 2, 28, c); mid.rect(x - 1, 27, x + 2, 29, OCHRE); mid.put(x - mid.ox, 17, GOLD); mid.put(x + 1 - mid.ox, 17, GOLD); mid.put(x - mid.ox, 21, GOLD); }   // long banners
    gourd(L.x0 - 6, 12); gourd(L.x1 + 6, 12);
    // the upper chamber, with its balcony and the Chief's high seat
    const [u0, u1] = L.upper;
    mid.rect(u0 - 4, -4, u1 + 4, -2, W.s);   // its floor, over the hall's roof
    hut(u0, u1, -3, -20, -38, { overhang: 6, upturn: true, roof: [146, 112, 64] });
    windowAt('chief', 500, -16, 506, -10); windowAt('chief', 520, -16, 526, -10);
    for (const x of [u0, u1]) post(x, -19, -3, 1.2, [OCHRE, RED]);
    const [b0, b1] = L.balcony;
    mid.rect(b0, -3, b1, -1, W.b); mid.cap(b1 - 2, -1, u1, 8, 0.8, 0.8, W); rail(b0 + 2, b1, -3, 4);   // the balcony on a brace
    mid.rect(539, -12, 541, -3, W.s); mid.rect(538, -7, 545, -5, W.b); mid.rect(544, -8, 546, -3, W.s); mid.rect(539, -8, 544, -6, RED); mid.ell(540, -13, 1.5, 1.2, mat(GOLD));   // the high seat
    // the lookout cupola on the roof's peak, with a light of its own
    const cx = (u0 + u1) / 2;
    for (const x of [cx - 4, cx + 4]) post(x, -48, -37, 0.7);
    mid.poly([[cx - 7, -47], [cx, -55], [cx + 7, -47]], mat([146, 112, 64]).b); mid.cap(cx, -55, cx, -59, 0.6, 0.4, mat(GOLD));
    mid.rect(cx - 2, -45, cx + 2, -41, [44, 32, 26]); lights.push({ key: 'chief', x0: cx - 2, y0: -45, x1: cx + 2, y1: -41 });
    // the gong in its frame, at the platform's far end
    post(L.gong - 6, P - 16, P, 0.9); post(L.gong + 6, P - 16, P, 0.9); mid.cap(L.gong - 7, P - 16, L.gong + 7, P - 16, 0.9, 0.9, W);
    mid.rect(L.gong, P - 15, L.gong + 1, P - 12, C.rope); mid.ell(L.gong + 0.5, P - 7, 4.5, 4.5, mat([196, 150, 64], { rim: 0.9 })); mid.ell(L.gong + 0.5, P - 7, 1.6, 1.6, mat([150, 110, 50]));
    // the old flags and the ladder down to the village
    for (const [x, c] of [[418, C.red], [426, C.gold]]) { mid.rect(x, P - 16, x + 1, P, C.wood); mid.poly([[x + 1, P - 16], [x + 8, P - 13], [x + 1, P - 10]], c); }
    for (let y = P + 4; y < GROUND; y += 4) mid.rect(462, y, 470, y + 1, mat(C.rope).b); mid.rect(462, P + 4, 463, GROUND, C.rope); mid.rect(469, P + 4, 470, GROUND, C.rope);
    lamp(452, P - 6, P);
  }

  // ---------- inspector's workshop (mandrill): a lens rack and a test bench ----------
  hut(588, 626, GROUND, 88, 64, { overhang: 8 }); door(606, GROUND); windowAt('inspector', 592, 93, 598, 100); windowAt('inspector', 614, 93, 620, 100);
  mid.rect(628, 78, 642, 92, W.s); mid.rect(629, 79, 641, 91, [52, 40, 32]);   // the lens rack on the side wall
  for (const [x, y, r] of [[632, 82, 2], [638, 82, 1.6], [632, 88, 1.4], [638, 88, 2]]) { mid.ell(x, y, r, r, mat([180, 210, 220], { rim: 0.9 })); mid.put(x - 0.5 - mid.ox, y - 1, [240, 250, 255]); }
  mid.ell(648, 80, 3.5, 3.5, mat([180, 210, 220], { rim: 0.8 })); mid.rect(646, 83, 647, 92, C.wood);   // the big lens on its stand
  mid.rect(632, GROUND - 8, 652, GROUND - 6, W.b); post(634, GROUND - 6, GROUND, 0.7); post(650, GROUND - 6, GROUND, 0.7);   // the test bench
  mid.rect(633, GROUND - 11, 636, GROUND - 8, [90, 94, 104]); mid.rect(632, GROUND - 10, 633, GROUND - 9, [90, 94, 104]);   // a vice
  for (const [x, c] of [[640, [90, 170, 230]], [643, [120, 220, 140]], [646, [230, 200, 90]]]) { mid.rect(x, GROUND - 12, x + 2, GROUND - 8, [200, 220, 230]); mid.rect(x, GROUND - 10, x + 2, GROUND - 8, c); }   // glassware
  mid.rect(649, GROUND - 13, 650, GROUND - 8, [150, 120, 60]); mid.rect(647, GROUND - 13, 652, GROUND - 12, [150, 120, 60]); mid.put(647, GROUND - 11, GOLD); mid.put(651, GROUND - 11, GOLD);   // a balance

  // ---------- sage's bathhouse (snow monkey): the hot spring, stepping stones, a spout ----------
  hut(712, 756, GROUND, 94, 78, { roof: [120, 96, 70] }); door(734, GROUND); windowAt('sage', 716, 98, 722, 104); windowAt('sage', 746, 98, 752, 104);
  for (let x = 760; x < 792; x++) { const d = Math.abs(x - 776) / 16; mid.rect(x, GROUND - 1, x + 1, GROUND + 2 - d, d > 0.85 ? C.stone : [80, 130, 150]); }
  for (let x = 760; x < 792; x += 3) if (hash(x, 61) < 0.6) mid.put(x, GROUND - 1, [150, 196, 210]);   // light on the water
  for (const x of [765, 772, 779, 786]) mid.ell(x, GROUND - 0.5, 2.4, 1, mat(C.stone, { rim: 0.8 }));   // stepping stones
  for (const [x, y, r] of [[759, GROUND - 1, 2], [793, GROUND - 1, 2.4], [790, GROUND - 3, 1.6]]) mid.ell(x, y, r, r * 0.8, mat(C.stone));   // rocks round the rim
  post(796, 92, GROUND, 0.8); mid.cap(796, 93, 786, 95, 0.9, 0.9, mat([150, 170, 80])); for (let y = 96; y < GROUND - 1; y++) mid.put(786, y, y % 3 ? [170, 210, 225] : [120, 170, 190]);   // the bamboo spout and its trickle
  mid.rect(698, GROUND - 6, 708, GROUND, mat([132, 96, 60]).b); for (const x of [700, 706]) mid.rect(x, GROUND - 6, x + 1, GROUND, mat([132, 96, 60]).s); mid.rect(699, GROUND - 6, 707, GROUND - 5, [80, 130, 150]);   // a tub
  for (let x = 757; x <= 766; x++) mid.put(x, 90 + (x - 757) * 0.2, [150, 130, 100]);
  for (const [x, c] of [[759, [220, 220, 230]], [763, [150, 180, 230]]]) mid.rect(x, 91, x + 3, 97, c);   // towels on a line

  // ---------- bell tower (howler): carved, painted posts and crossed braces ----------
  const bellM = mat([150, 150, 70]);
  for (const x of [834, 862]) { mid.cap(x, 30, x, GROUND, 1.5, 1.6, bellM); for (let y = 38, i = 0; y < GROUND - 16; y += 9, i++) { mid.rect(x - 1.5, y, x + 1.6, y + 2, [RED, OCHRE, INDIGO][i % 3]); mid.put(x - mid.ox, y + 3, bellM.s); } }
  for (let y = 40; y < GROUND - 22; y += 16) { mid.cap(834, y, 862, y + 12, 0.8, 0.8, bellM); mid.cap(862, y, 834, y + 12, 0.8, 0.8, bellM); mid.ell(848, y + 6, 1.4, 1.4, mat(OCHRE)); }
  hut(830, 866, 32, 26, 12, { overhang: 4, roof: [120, 96, 70], upturn: true }); lights.push({ key: 'ringer', bell: true, x0: 844, y0: 22, x1: 852, y1: 30 });
  mid.cap(848, 12, 848, 6, 0.8, 0.5, mat(GOLD)); mid.ell(848, 5, 1.2, 1.2, mat(GOLD));   // finial
  mid.ell(848, 26, 4, 4.2, mat(C.gold)); mid.rect(848, 30, 849, 92, C.rope);   // the bell and its rope
  hut(836, 860, GROUND, 96, 86, { overhang: 3 }); door(848, GROUND); windowAt('ringer', 839, 99, 843, 103);

  // ---------- the Clerk's counting house (capuchin) on its Canopy 1 plot ----------
  {
    const p = PLOTS.find(q => q.id === HOMES.clerk.plot), base = p.y, cx = p.x;
    hut(cx - 12, cx + 12, base, base - 27, base - 41, { overhang: 3, wall: [150, 112, 72], roof: [78, 82, 100] });
    door(cx, base, 8);
    mid.rect(cx - 5, base - 11, cx + 5, base - 9, W.s); for (let x = cx - 4; x < cx + 4; x += 2) mid.put(x, base - 10, [168, 222, 84]);   // a sign over the door with a ledger rule
    for (const [x, y] of [[cx - 9, base - 20], [cx + 5, base - 20]]) { windowAt('clerk', x, y, x + 4, y + 5); mid.rect(x - 1, y + 5, x + 5, y + 7, W.s); mid.put(x - mid.ox, y + 4, [220, 90, 80]); mid.put(x + 2 - mid.ox, y + 4, [250, 220, 90]); mid.put(x + 4 - mid.ox, y + 4, [220, 90, 80]); }   // window boxes of flowers
    windowAt('clerk', cx + 7, base - 8, cx + 10, base - 3);
    mid.rect(cx - 2, base - 36, cx + 2, base - 32, [44, 32, 26]); lights.push({ key: 'clerk', x0: cx - 2, y0: base - 36, x1: cx + 2, y1: base - 32 });   // the attic window
    mid.rect(cx - 16, base - 22, cx - 13, base - 21, W.s); mid.rect(cx - 16, base - 21, cx - 15, base - 15, C.rope); mid.ell(cx - 15, base - 13, 2.3, 2.3, mat(GOLD)); mid.put(cx - 15 - mid.ox, base - 13, [150, 110, 40]);   // a hanging sign with a coin
    mid.rect(cx + 13, base - 7, cx + 21, base - 6, W.b); mid.rect(cx + 13, base - 7, cx + 14, base, W.s); mid.rect(cx + 20, base - 7, cx + 21, base, W.s);   // an abacus on the porch
    for (let r = 0; r < 3; r++) { mid.rect(cx + 14, base - 5 + r * 2, cx + 20, base - 4.5 + r * 2, [120, 100, 70]); for (let k = 0; k < 3; k++) mid.put(cx + 15 + ((k + r) % 4) * 1.5, base - 5 + r * 2, k === 1 ? [168, 222, 84] : [196, 140, 80]); }
    const pm = mat(C.paper);                                                                                    // stacks of paper and ledgers on the platform
    for (const [x, n] of [[cx - 18, 5], [cx - 15, 3]]) for (let i = 0; i < n; i++) mid.rect(x - 2 + (i % 2) * 0.5, base - 1 - i, x + 2 + (i % 2) * 0.5, base - i, i % 3 === 2 ? [96, 140, 92] : i % 2 ? pm.s : pm.b);
  }

  // ---------- scout's lookout (gibbon) on the canopy branch: a telescope on a tripod and a flag ----------
  const by = branchY(70);
  hut(58, 84, by - 1, by - 16, by - 30, { overhang: 4 }); door(70, by - 1, 8); windowAt('scout', 76, by - 13, 81, by - 8);
  mid.rect(84, by - 2, 97, by, W.b); rail(86, 97, by - 2, 4);   // a little deck round the side
  for (const dx of [-2, 0, 2]) mid.cap(92, by - 9, 92 + dx, by - 2, 0.4, 0.4, W);   // the tripod
  mid.cap(88, by - 9, 97, by - 13, 0.9, 0.7, mat(GOLD)); mid.ell(97.5, by - 13.2, 0.9, 0.9, mat([180, 210, 220], { rim: 0.9 }));   // the telescope, aimed at the sky
  mid.rect(71, by - 46, 72, by - 29, W.s);   // the flagpole on the roof (the flag itself is drawn live)
  return { flag: { x: 72, y: by - 46 }, chimney: { x: 187.5, y: 57 }, forge: { x: 200, y: 104 } };
}
