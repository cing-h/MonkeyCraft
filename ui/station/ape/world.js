// MonkeyCraft ape village: the world layout and its pre-painted parallax layers.

import { FB, GROUND, H, TOP, W, WORLD, bayer, hash, mat, mixc } from './fb.js';
import { C } from './cast.js';
import { GREENS, banana, bush, canopy, fern, flower, foliage, palm, trunk } from './scenery.js';
import { TRUNKS, paintCanopy, paintCanopyBack, paintHighSky } from './canopy.js';
export { TRUNKS };

// ---------- the world ----------
export const branchY = x => 56 + Math.sin(x / 41) * 3 + Math.sin(x / 17) * 1.2;
export const groundY = x => GROUND + Math.sin(x / 29) * 0.8;
export const WATER = 122;
export const DOORS = {
  chief: { lane: 'perch', x: 446 }, scout: { lane: 'canopy', x: 70 }, smith: { lane: 'ground', x: 166 }, archivist: { lane: 'ground', x: 302 },
  writer: { lane: 'ground', x: 398 }, inspector: { lane: 'ground', x: 606 }, sage: { lane: 'ground', x: 734 }, ringer: { lane: 'ground', x: 848 }
};
export const PERCH_Y = 34;

export function buildLayers() {
  // tall layers cover all three stories (world y TOP..H); the others only the ground village
  const layer = (f, clear = true, tall = false) => { const b = new FB(Math.ceil(W + (WORLD - W) * f), tall ? H - TOP : H, tall ? TOP : 0); if (clear) b.d.fill(0); return b; };
  // sky: a tropical sunset, finely dithered, with a low sun on the left
  const sky = layer(0.05, false, true);
  const SK = [[34, 52, 78], [86, 92, 120], [196, 132, 120], [246, 186, 128], [252, 220, 160]];
  for (let y = 0; y < H; y++) for (let x = 0; x < sky.w; x++) {
    const u = Math.min(1, y / (WATER - 4)) * 4, i = Math.min(3, Math.floor(u)), f = u - i, d = bayer(x, y) * 0.9;
    const steps = 6, q = Math.floor(f * steps + d) / steps;
    let c = mixc(SK[i], SK[i + 1], Math.min(1, q));
    const sx = 64, sy = 78, dd = Math.hypot(x - sx, (y - sy) * 1.3);
    if (dd < 9) c = mixc([255, 236, 190], [255, 250, 230], 1 - dd / 9); else if (dd < 40) c = mixc(c, [255, 214, 150], (1 - dd / 40) * 0.5 * (bayer(x, y) < 0.8 ? 1 : 0.85));
    sky.put(x, y, c);
  }
  paintHighSky(sky, SK[0]);
  // clouds: big soft cumulus, lit on the sun side
  const clouds = layer(0.1);
  for (let i = 0; i < 9; i++) {
    const cx = i * 58 + hash(i, 51) * 30, cy = 18 + hash(i, 52) * 26, w = 40 + hash(i, 53) * 40;
    for (let k = 0; k < 7; k++) {
      const ex = cx + (hash(i, k, 54) - 0.5) * w, ey = cy + (hash(i, k, 55) - 0.5) * 8, rx = 8 + hash(i, k, 56) * 12, ry = 4 + hash(i, k, 57) * 5;
      for (let y = Math.floor(ey - ry); y <= ey + ry; y++) for (let x = Math.floor(ex - rx); x <= ex + rx; x++) {
        const u = (x - ex) / rx, v = (y - ey) / ry, d = u * u + v * v; if (d > 1) continue;
        if (d > 0.75 && bayer(x, y) < (d - 0.75) * 4) continue;                       // dithered soft edge
        const lit = -u * 0.6 - v * 0.5;
        clouds.put(x, y, lit > 0.35 ? [252, 210, 170] : lit > -0.1 ? [214, 150, 140] : [150, 108, 120]);
      }
    }
  }
  // far: a hazy volcano and ridges
  const far = layer(0.15);
  for (let x = 0; x < far.w; x++) {
    const vol = 40 + Math.abs(x - 300) * 0.55 + (Math.abs(x - 300) < 14 ? 6 - Math.abs(x - 300) * 0.43 : 0);
    const ridge = Math.min(vol, 74 + Math.sin(x / 19) * 6 + Math.sin(x / 7) * 2);
    for (let y = Math.floor(ridge); y < WATER; y++) far.put(x, y, mixc([120, 104, 140], [196, 150, 140], 0.5 - (y - ridge) / 120));
    const r2 = 88 + Math.sin(x / 13 + 1) * 4 + hash(x >> 2, 3) * 2;
    for (let y = Math.floor(r2); y < WATER; y++) far.put(x, y, mixc([98, 96, 120], [170, 130, 130], 0.4));
  }
  // far jungle: misty emergent trees, a cliff and a waterfall
  const jungle = layer(0.3); jungle.fog = 0.5; jungle.fogc = [176, 150, 140];
  for (let i = 0; i < 22; i++) { const x = i * 24 + hash(i, 61) * 14, y = 80 + hash(i, 62) * 10; jungle.cap(x, y, x, WATER, 1.3, 1.6, mat([70, 70, 60])); canopy(jungle, x, y - 4, 26 + hash(i, 63) * 14, 16 + hash(i, 64) * 6, GREENS.jungle, 100 + i, 5); }
  jungle.fog = 0.35;
  jungle.rect(392, 62, 430, WATER, [92, 86, 84]); for (let y = 62; y < WATER; y += 3) jungle.rect(392 + hash(y, 7) * 6, y, 430 - hash(y, 8) * 6, y + 1, [110, 102, 96]);
  canopy(jungle, 410, 62, 50, 14, GREENS.jungle, 300, 6);
  jungle.fog = 0;
  for (let i = 0; i < 9; i++) { const x = i * 56 + 20 + hash(i, 65) * 20; palm(jungle, x, WATER, 24 + hash(i, 66) * 10, (hash(i, 67) - 0.5) * 2, 200 + i, GREENS.palm.map(c => mixc(c, [176, 150, 140], 0.45)), 0.8); }
  // back trees (parallax 0.55): detailed but hazy, where the villagers swing
  const back = layer(0.55, true, true); paintCanopyBack(back); back.fog = 0.3; back.fogc = [150, 140, 130];
  for (let i = 0; i < 12; i++) {
    const x = 20 + i * (back.w - 40) / 11 + (hash(i, 3) - 0.5) * 16;
    trunk(back, x, 18, WATER, 4.5, 3, [92, 74, 58], i);
    canopy(back, x, 22, 64, 30, GREENS.canopy, 400 + i, 9);
    back.cap(x, 44 + hash(i, 8) * 8, x + 34, 46 + hash(i, 9) * 8, 1.4, 1.1, mat([92, 74, 58]));
    if (i % 2) palm(back, x + 26, WATER, 46, -1.2, 500 + i);
  }
  // the far branch the villagers travel along, with moss, short lianas and leafy tufts
  for (let x = 0; x < back.w; x += 2) back.cap(x, backBranchY(x), x + 2, backBranchY(x + 2), 1.2, 1.2, mat([92, 74, 58]));
  for (let i = 0; i < 26; i++) { const x = hash(i, 120) * back.w, y = backBranchY(x); back.cap(x, y, x + (hash(i, 121) - 0.5) * 3, y + 4 + hash(i, 122) * 9, 0.4, 0.4, mat([70, 104, 52])); }
  for (let i = 0; i < 18; i++) { const x = hash(i, 123) * back.w; foliage(back, x, backBranchY(x) - 1.5, 4 + hash(i, 124) * 3, 2, GREENS.canopy, 700 + i); }
  back.fog = 0;
  // the village (parallax 1)
  const mid = layer(1, true, true);
  paintCanopy(mid);
  // the bank: grass lip, then a cut-away of earth and stones down to the water
  for (let x = 0; x < WORLD; x++) {
    const top = groundY(x);
    for (let y = Math.floor(top); y < WATER; y++) {
      const d = y - top, h = hash(x, y, 5);
      let c;
      if (d < 2) c = h < 0.35 ? [104, 150, 58] : [78, 120, 46];
      else {
        const row = Math.floor((y - top - 2) / 3), off = (row & 1) * 2, sx = Math.floor((x + off) / 5), mortar = ((x + off) % 5 === 0) || ((y - Math.floor(top) - 2) % 3 === 0);
        const st = hash(sx, row, 6);
        c = mortar ? [52, 38, 28] : mixc([128, 98, 64], [92, 70, 48], st);
        if (!mortar && h < 0.08) c = [146, 116, 76];
        if (d > 9) c = mixc(c, [40, 30, 22], 0.4);
      }
      mid.put(x, y, c);
    }
    if (hash(x, 70) < 0.25) for (let k = 0; k < 2 + hash(x, 71) * 4; k++) mid.put(x, Math.floor(top) + 2 + k, [70, 112, 44]);   // overhanging grass
    if (hash(x, 77) < 0.45) for (let k = 0; k < 2 + hash(x, 78) * 4; k++) mid.put(x, Math.floor(top) - k, hash(x, k, 79) < 0.5 ? [92, 140, 52] : [64, 108, 42]); // tufts
    if (hash(x >> 3, 72) < 0.18 && x % 8 === 3) for (let k = 0; k < 7; k++) mid.put(x + Math.sin(k) * 1.2, Math.floor(top) + 3 + k, [96, 72, 44]); // roots
  }
  // giant rainforest trees with buttress roots and the canopy highway
  for (const tx of TRUNKS) {
    const big = tx === 480, r = big ? 11 : 5.5;
    trunk(mid, tx, 8, GROUND + 1, r, r * 0.75, C.bark, tx);
    for (const s of [-1, 1]) for (let k = 0; k < (big ? 3 : 2); k++) mid.poly([[tx + s * r * 0.4, GROUND - 14 - k * 4], [tx + s * (r + 5 + k * 3), GROUND + 1], [tx + s * (r - 1), GROUND + 1]], k & 1 ? mat(C.bark).s : mat(C.bark).b);
    canopy(mid, tx, 14, big ? 150 : 86, big ? 40 : 32, GREENS.canopy, tx * 3, big ? 18 : 12);
    for (let k = 0; k < 4; k++) { const vx = tx + (hash(tx, k, 81) - 0.5) * (big ? 90 : 50); mid.cap(vx, 22, vx + (hash(tx, k, 82) - 0.5) * 4, 40 + hash(tx, k, 83) * 30, 0.5, 0.5, mat([72, 106, 52])); flower(mid, vx, 40 + hash(tx, k, 83) * 30 - 2, 'orchid'); } // lianas with orchids
  }
  for (let x = 24; x < WORLD - 20; x += 2) mid.cap(x, branchY(x), x + 2, branchY(x + 2), 1.8, 1.8, mat(C.bark));
  for (let i = 0; i < 34; i++) { const x = 28 + i * 27 + hash(i, 11) * 10, y = branchY(x); mid.cap(x, y, x + (hash(i, 12) - 0.5) * 6, y + 8 + hash(i, 13) * 20, 0.5, 0.5, mat([72, 106, 52])); if (hash(i, 14) < 0.5) flower(mid, x, y + 8 + hash(i, 13) * 20, 'orchid'); }
  for (let i = 0; i < 16; i++) { const x = 40 + i * 58 + hash(i, 15) * 20, y = branchY(x) - 2; foliage(mid, x, y, 3.5, 2, GREENS.jungle, 600 + i); mid.put(x - mid.ox, y - 1, [230, 60, 70]); mid.put(x + 1 - mid.ox, y - 2, [250, 120, 60]); } // bromeliads on the branch
  // ---- buildings ----
  const hut = (x0, x1, base, wallTop, roofTop, opts = {}) => {
    const wall = mat(opts.wall || C.wood), roof = mat(opts.roof || C.thatch);
    if (opts.stilts) for (const sx of [x0 + 2, x1 - 3, (x0 + x1) / 2]) mid.cap(sx, base, sx, GROUND + 1, 1, 1, mat(C.wood));
    mid.rect(x0, wallTop, x1, base, wall.b);
    for (let x = Math.ceil(x0); x < x1; x += 4) mid.rect(x, wallTop, x + 1, base, wall.s);
    for (let y = wallTop + 3; y < base; y += 5) for (let x = Math.ceil(x0); x < x1; x++) if (hash(x, y, 34) < 0.25) mid.put(x, y, wall.l);
    mid.rect(x0, base - 1, x1, base + 1, wall.s);
    const ov = opts.overhang ?? 5;
    mid.poly([[x0 - ov, wallTop + 2], [(x0 + x1) / 2, roofTop], [x1 + ov, wallTop + 2]], roof.b);
    mid.poly([[(x0 + x1) / 2, roofTop], [x1 + ov, wallTop + 2], [(x0 + x1) / 2 + 2, wallTop + 2]], roof.s);
    for (let k = 1; k < 6; k++) { const yy = roofTop + (wallTop + 2 - roofTop) * k / 6, half = (x1 - x0 + 2 * ov) / 2 * k / 6; for (let x = (x0 + x1) / 2 - half; x < (x0 + x1) / 2 + half; x++) if (hash(x | 0, k, 33) < 0.45) mid.put(x, yy, hash(x | 0, k, 35) < 0.5 ? roof.l : roof.s); }
    for (let x = x0 - ov; x < x1 + ov; x++) if (hash(x, 31) < 0.7) mid.rect(x, wallTop + 2, x + 1, wallTop + 3 + hash(x, 32) * 3, roof.s); // fringe
  };
  const door = (x, base, h = 9) => { mid.rect(x - 3, base - h, x + 3, base, C.dark); mid.rect(x - 3, base - h - 1, x + 3, base - h, mat(C.wood).s); };
  const lights = [], lamps = [];
  const windowAt = (key, x0, y0, x1, y1) => { mid.rect(x0, y0, x1, y1, [44, 32, 26]); lights.push({ key, x0, y0, x1, y1 }); };
  const lamp = (x, y, foot = GROUND) => { mid.rect(x, y, x + 1, foot, mat(C.wood).s); mid.rect(x - 1, y - 3, x + 2, y, [255, 200, 110]); lamps.push([x, y - 2]); };
  // smithy (chimpanzee)
  hut(140, 194, GROUND, 90, 70, { wall: C.stone }); door(166, GROUND); windowAt('smith', 146, 95, 154, 101); windowAt('smith', 178, 95, 186, 101);
  mid.rect(184, 58, 191, 86, mat(C.stone).b); mid.rect(189, 58, 191, 86, mat(C.stone).s); lights.push({ key: 'smith', x0: 185, y0: 57, x1: 190, y1: 59, chimney: true });
  mid.rect(200, GROUND - 5, 210, GROUND - 3, [100, 104, 112]); mid.rect(203, GROUND - 3, 207, GROUND, [80, 84, 92]);
  // archive (orangutan)
  hut(276, 328, GROUND - 4, 72, 52, { stilts: true }); mid.rect(276, 90, 328, 92, mat(C.wood).s); door(302, GROUND - 4, 10);
  for (const [x, y] of [[282, 76], [316, 76], [282, 94], [316, 94]]) windowAt('archivist', x, y, x + 6, y + 6);
  for (let i = 0; i < 4; i++) mid.cap(331, 82 + i * 6, 338, 82 + i * 6, 1.3, 1.3, mat(C.paper));
  mid.rect(330, 78, 331, GROUND - 4, C.wood); mid.rect(338, 78, 339, GROUND - 4, C.wood);
  // writer's hut (bonobo)
  hut(380, 416, GROUND, 92, 72, { overhang: 7 }); door(398, GROUND); windowAt('writer', 384, 97, 390, 103); windowAt('writer', 406, 97, 412, 103);
  for (let i = 0; i < 4; i++) { const x = 376 + i * 14, y = 86 + Math.sin(i) * 2; mid.ell(x, y, 2, 2.5, mat([236, 140, 160])); lamps.push([x, y]); }
  // the Chief's lodge in the great tree
  mid.rect(408, PERCH_Y, 532, PERCH_Y + 3, mat(C.wood).b); mid.rect(408, PERCH_Y + 3, 532, PERCH_Y + 4, mat(C.wood).s);
  for (const x of [412, 528]) mid.cap(x, PERCH_Y + 4, 480 + (x < 480 ? -10 : 10), PERCH_Y + 22, 1.2, 1.2, mat(C.wood));
  hut(486, 528, PERCH_Y, 12, -6, { overhang: 6 }); door(507, PERCH_Y, 10); windowAt('chief', 491, 18, 498, 25); windowAt('chief', 516, 18, 523, 25);
  for (const [x, c] of [[418, C.red], [426, C.gold]]) { mid.rect(x, PERCH_Y - 16, x + 1, PERCH_Y, C.wood); mid.poly([[x + 1, PERCH_Y - 16], [x + 8, PERCH_Y - 13], [x + 1, PERCH_Y - 10]], c); }
  for (let y = PERCH_Y + 4; y < GROUND; y += 4) mid.rect(462, y, 470, y + 1, mat(C.rope).b); mid.rect(462, PERCH_Y + 4, 463, GROUND, C.rope); mid.rect(469, PERCH_Y + 4, 470, GROUND, C.rope);
  lamp(452, PERCH_Y - 6, PERCH_Y);
  // inspector's workshop (mandrill)
  hut(588, 626, GROUND, 88, 64, { overhang: 8 }); door(606, GROUND); windowAt('inspector', 592, 93, 598, 100); windowAt('inspector', 614, 93, 620, 100);
  mid.ell(632, 80, 3.5, 3.5, mat([180, 210, 220], { rim: 0.8 })); mid.rect(630, 83, 631, 90, C.wood);
  mid.rect(634, GROUND - 7, 642, GROUND, mat(C.wood).b); mid.rect(642, GROUND - 5, 648, GROUND, mat(C.wood).s);
  // sage's bathhouse (snow monkey) and hot spring
  hut(712, 756, GROUND, 94, 78, { roof: [120, 96, 70] }); door(734, GROUND); windowAt('sage', 716, 98, 722, 104); windowAt('sage', 746, 98, 752, 104);
  for (let x = 760; x < 792; x++) { const d = Math.abs(x - 776) / 16; mid.rect(x, GROUND - 1, x + 1, GROUND + 2 - d, d > 0.85 ? C.stone : [80, 130, 150]); }
  // bell tower (howler)
  for (const x of [834, 862]) mid.cap(x, 30, x, GROUND, 1.3, 1.3, mat([150, 150, 70]));
  for (let y = 40; y < GROUND - 14; y += 12) mid.cap(834, y, 862, y + 6, 0.8, 0.8, mat([150, 150, 70]));
  hut(830, 866, 32, 26, 12, { overhang: 4, roof: [120, 96, 70] }); lights.push({ key: 'ringer', bell: true, x0: 844, y0: 22, x1: 852, y1: 30 });
  mid.ell(848, 26, 4, 4.2, mat(C.gold));
  hut(836, 860, GROUND, 96, 86, { overhang: 3 }); door(848, GROUND); windowAt('ringer', 839, 99, 843, 103);
  // scout's lookout (gibbon) on the canopy branch
  const by = branchY(70);
  hut(58, 84, by - 1, by - 16, by - 30, { overhang: 4 }); door(70, by - 1, 8); windowAt('scout', 76, by - 13, 81, by - 8);
  mid.cap(84, by - 18, 94, by - 22, 0.9, 0.7, mat(C.gold));
  // lush planting: palms, bananas, ferns, flowering bushes, lanterns along the path
  for (const [x, h, b] of [[112, 52, 0.8], [248, 60, -0.6], [352, 48, 0.5], [556, 58, -0.8], [690, 50, 0.6], [796, 62, -0.5], [940, 54, 0.7]]) palm(mid, x, GROUND, h, b, x);
  for (const x of [128, 214, 342, 432, 572, 652, 704, 812, 884]) banana(mid, x, GROUND, x, 1);
  for (const x of [20, 104, 222, 262, 366, 430, 540, 584, 648, 678, 772, 804, 878, 932]) bush(mid, x, GROUND, 10 + hash(x, 90) * 8, x);
  for (const x of [8, 96, 236, 344, 528, 566, 668, 790, 900, 950]) fern(mid, x, GROUND, x);
  for (let i = 0; i < 70; i++) { const x = hash(i, 91) * WORLD, kinds = ['hibiscus', 'plumeria', 'orchid', 'heliconia', 'bird']; flower(mid, x, groundY(x) - 1 - hash(i, 92) * 3, kinds[i % 5]); }
  for (const x of [120, 226, 362, 582, 700, 818]) lamp(x, GROUND - 12);
  // foreground (parallax 1.3): reeds and lily pads in the water, fronds hanging from the top
  const fore = layer(1.3);
  for (let i = 0; i < 60; i++) {
    const x = hash(i, 40) * fore.w, y = H - 1 - hash(i, 41) * 30, n = 3 + Math.floor(hash(i, 42) * 4);
    if (y < 150) { fore.ell(x, y, 4 + hash(i, 43) * 4, 1.2, mat([40, 86, 44], { rim: 0.6 })); if (hash(i, 44) < 0.3) flower(fore, x + 1, y - 1, 'plumeria'); continue; }  // lily pads
    for (let k = 0; k < n; k++) { const len = 14 + hash(i, k, 2) * 20; fore.cap(x + k * 1.5, H + 2, x + k * 1.5 + (hash(i, k) - 0.5) * 6, H - len, 0.9, 0.5, mat([20, 34, 24], { rim: 0.35 })); }
  }
  for (const x of [fore.w * 0.12, fore.w * 0.47, fore.w * 0.8]) for (let k = 0; k < 6; k++) {
    let a = Math.PI / 2 + (k - 2.5) * 0.35, fx = x, fy = -2; const len = 22 + hash(k, x | 0) * 14;
    for (let s = 0; s < len; s++) { a += (k < 3 ? 1 : -1) * 0.02; fx += Math.cos(a); fy += Math.sin(a); for (let w = -2; w <= 2; w++) fore.put(fx + w * Math.sin(a) * 0.8 - fore.ox, fy - w * Math.cos(a) * 0.3 + Math.abs(w) * 0.6, Math.abs(w) > 1 ? [20, 30, 22] : [28, 44, 28]); }
  }
  return { sky, clouds, far, jungle, back, mid, fore, lights, lamps };
}


// the far branch the background villagers travel along (back-layer coordinates)
export const backBranchY = x => 68 + Math.sin(x / 37) * 3 + Math.sin(x / 13 + 2);
